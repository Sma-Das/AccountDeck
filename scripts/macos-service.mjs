import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const label = 'com.cliproxy.console';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(
  homedir(),
  'Library',
  'Application Support',
  'CLIProxy Console',
);
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const stateFile = join(runtime, 'service.json');
const domain = `gui/${process.getuid()}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.optional)
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout || result.status}`,
    );
  return result.stdout?.trim() || '';
}
const json = (command, args) => JSON.parse(run(command, args));
const xml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (char) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[char],
  );
const port = (value, fallback) => {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < 1 || number > 65535)
    throw new Error('Service ports must be integers between 1 and 65535.');
  return number;
};
async function readState() {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function waitForServer(servicePort) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const page = await fetch(`http://127.0.0.1:${servicePort}/`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!page.ok || !(await page.text()).includes('id="root"'))
        throw new Error('The production dashboard is not ready.');
      const response = await fetch(
        `http://127.0.0.1:${servicePort}/api/session`,
        {
          headers: { 'X-Console-Request': '1' },
          signal: AbortSignal.timeout(1000),
        },
      );
      if (response.ok) return;
    } catch {
      /* launchd may still be starting the process */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `The console did not start. Inspect ${join(runtime, 'stderr.log')}.`,
  );
}
async function checkFreePort(servicePort) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(servicePort, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
async function waitForStopped(servicePort) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (
      !run('/bin/launchctl', ['print', `${domain}/${label}`], {
        optional: true,
      })
    ) {
      try {
        await checkFreePort(servicePort);
        return;
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The previous console service has not stopped yet.');
}
function serveTarget(config, state) {
  return config.Web?.[`${state.dnsName}:${state.httpsPort}`]?.Handlers?.['/']
    ?.Proxy;
}
function ensureOwnEndpoint(config, state) {
  const address = `${state.dnsName}:${state.httpsPort}`;
  if (config.AllowFunnel?.[address])
    throw new Error(
      `Port ${state.httpsPort} has Funnel enabled. Choose a different HTTPS port for tailnet-only access.`,
    );
  if (
    config.TCP?.[String(state.httpsPort)] &&
    (serveTarget(config, state) !== state.target ||
      Object.keys(config.Web?.[address]?.Handlers || {}).some(
        (path) => path !== '/',
      ))
  )
    throw new Error(
      `Tailscale port ${state.httpsPort} already serves another application. Set CLIPROXY_HTTPS_PORT to an unused port.`,
    );
}

async function install() {
  const node = run('/usr/bin/which', ['node']);
  const python = run('/usr/bin/which', ['python3']);
  const gh = run('/usr/bin/which', ['gh']);
  run(python, [
    '-c',
    'import sys; assert sys.version_info >= (3, 9), "AccountDeck requires Python 3.9 or newer"',
  ]);
  run(gh, ['--version']);
  const tailscale = run('/usr/bin/which', ['tailscale']);
  const status = json(tailscale, ['status', '--json']);
  if (status.BackendState !== 'Running' || !status.Self?.Online)
    throw new Error(
      'Connect this Mac to Tailscale before installing the service.',
    );
  if (!status.CurrentTailnet?.MagicDNSEnabled)
    throw new Error(
      'Enable MagicDNS in the Tailscale DNS settings before installing.',
    );
  const dnsName = status.Self.DNSName?.replace(/\.$/, '');
  if (!dnsName)
    throw new Error('Tailscale did not return a MagicDNS hostname.');
  const previous = await readState();
  const servicePort = port(
    process.env.CLIPROXY_SERVICE_PORT,
    previous?.servicePort || 4319,
  );
  const httpsPort = port(
    process.env.CLIPROXY_HTTPS_PORT,
    previous?.httpsPort || 8443,
  );
  if (
    previous &&
    (servicePort !== previous.servicePort ||
      httpsPort !== previous.httpsPort ||
      dnsName !== previous.dnsName)
  )
    throw new Error(
      'Uninstall the current service before changing its ports or MagicDNS hostname.',
    );
  const state = {
    label,
    servicePort,
    httpsPort,
    dnsName,
    tailscale,
    target: `http://127.0.0.1:${servicePort}`,
    origin: `https://${dnsName}${httpsPort === 443 ? '' : `:${httpsPort}`}`,
    connectionFile:
      process.env.CONSOLE_CONNECTION_FILE || previous?.connectionFile || null,
  };
  ensureOwnEndpoint(json(tailscale, ['serve', 'status', '--json']), state);
  const running = run('/bin/launchctl', ['print', `${domain}/${label}`], {
    optional: true,
  });
  if (!previous || !running) await checkFreePort(servicePort);

  // Prepare a complete release before changing a running service.
  run('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  const release = join(runtime, 'releases', String(Date.now()));
  await mkdir(release, { recursive: true, mode: 0o700 });
  for (const item of ['dist', 'server', 'package.json', 'package-lock.json'])
    await cp(join(root, item), join(release, item), { recursive: true });
  run('npm', ['ci', '--omit=dev'], { cwd: release, stdio: 'inherit' });
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(join(release, 'server', 'index.js'))}</string></array>
<key>WorkingDirectory</key><string>${xml(release)}</string>
<key>EnvironmentVariables</key><dict><key>NODE_ENV</key><string>production</string><key>PORT</key><string>${servicePort}</string><key>GHR_PYTHON</key><string>${xml(python)}</string><key>PATH</key><string>${xml(`${dirname(gh)}:${dirname(node)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string><key>CONSOLE_ORIGIN</key><string>${xml(state.origin)}</string>${state.connectionFile ? `<key>CONSOLE_CONNECTION_FILE</key><string>${xml(state.connectionFile)}</string>` : ''}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(runtime, 'stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(runtime, 'stderr.log'))}</string>
</dict></plist>
`;
  await mkdir(dirname(plist), { recursive: true });
  let oldDocument;
  try {
    oldDocument = await readFile(plist, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  run('/bin/launchctl', ['bootout', `${domain}/${label}`], { optional: true });
  try {
    await waitForStopped(servicePort);
    await writeFile(plist, document, { mode: 0o600 });
    run('/bin/launchctl', ['enable', `${domain}/${label}`]);
    run('/bin/launchctl', ['bootstrap', domain, plist]);
    await waitForServer(servicePort);
    run(tailscale, ['serve', '--bg', `--https=${httpsPort}`, state.target], {
      stdio: 'inherit',
    });
    await writeFile(
      stateFile,
      JSON.stringify({ ...state, release }, null, 2) + '\n',
      { mode: 0o600 },
    );
  } catch (error) {
    run('/bin/launchctl', ['bootout', `${domain}/${label}`], {
      optional: true,
    });
    await waitForStopped(servicePort);
    if (oldDocument) {
      await writeFile(plist, oldDocument);
      run('/bin/launchctl', ['bootstrap', domain, plist]);
    } else await rm(plist, { force: true });
    throw error;
  }
  console.log(
    `\nAccountDeck is available at ${state.origin}\nIt starts at login and restarts automatically. Each device must be connected to your Tailscale network.`,
  );
}
async function main() {
  if (process.platform !== 'darwin')
    throw new Error(
      'This installer supports macOS launch agents. See docs/tailscale.md for other systems.',
    );
  const action = process.argv[2] || 'status';
  if (action === 'install') return install();
  const state = await readState();
  if (!state) {
    console.log(
      'The AccountDeck service is not installed. Run npm run service:install.',
    );
    return;
  }
  if (action === 'status') {
    console.log(
      `URL: ${state.origin}\nLocal backend: ${state.target}\nRelease: ${state.release}\nLogs: ${runtime}`,
    );
    console.log(run('/bin/launchctl', ['print', `${domain}/${label}`]));
    console.log(run(state.tailscale, ['serve', 'status']));
  } else if (action === 'restart') {
    run('/bin/launchctl', ['kickstart', '-k', `${domain}/${label}`]);
    await waitForServer(state.servicePort);
    console.log(
      `Restarted ${state.origin}. Existing console sessions were cleared.`,
    );
  } else if (action === 'uninstall') {
    const config = json(state.tailscale, ['serve', 'status', '--json']);
    if (serveTarget(config, state) === state.target) {
      ensureOwnEndpoint(config, state);
      run(state.tailscale, [
        'serve',
        '--bg',
        `--https=${state.httpsPort}`,
        'off',
      ]);
    }
    run('/bin/launchctl', ['bootout', `${domain}/${label}`], {
      optional: true,
    });
    await rm(plist, { force: true });
    await rm(stateFile, { force: true });
    console.log(
      'Service uninstalled. Archived releases and logs were retained.',
    );
  } else throw new Error('Choose install, status, restart, or uninstall.');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
