import { execFileSync } from 'node:child_process';
import { mkdir, cp, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncNativeAuth, removeNativeAuth } from '../server/native-auth.js';

const label = 'com.cliproxy.native-auth';
const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = join(
  homedir(),
  'Library',
  'Application Support',
  'CLIProxy Native Auth',
);
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const stateFile = join(runtime, 'service.json');
const statusFile = join(runtime, 'status.json');
const domain = `gui/${process.getuid()}`;
const xml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const launch = (args, optional = false) => {
  try {
    return execFileSync('/bin/launchctl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (!optional) throw new Error(`launchctl ${args[0]} failed.`);
    return '';
  }
};
const state = async () => {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const action = process.argv[2] || 'status';
async function stop() {
  launch(['bootout', `${domain}/${label}`], true);
  for (let attempt = 0; attempt < 160; attempt++) {
    if (!launch(['print', `${domain}/${label}`], true)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The previous native-auth service has not stopped yet.');
}
async function main() {
  if (process.platform !== 'darwin' && !['sync', 'run'].includes(action))
    throw new Error('The native-auth service installer requires macOS.');
  const previous = await state();
  const authDir =
    process.env.CLIPROXY_NATIVE_AUTH_DIR ||
    previous?.authDir ||
    join(homedir(), '.cli-proxy-api');
  if (action === 'sync' || action === 'run') {
    let pending;
    let summary;
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const sync = () => {
      if (pending) return pending;
      pending = syncNativeAuth({ authDir, cwd: runtime })
        .then(async (result) => {
          await writeFile(
            `${statusFile}.tmp`,
            `${JSON.stringify(result, null, 2)}\n`,
            {
              mode: 0o600,
            },
          );
          await rename(`${statusFile}.tmp`, statusFile);
          const next = JSON.stringify({
            accounts: result.accounts.map((a) => ({
              provider: a.provider,
              source: a.source,
              expired: a.expired,
            })),
            errors: result.errors,
          });
          if (summary !== next) {
            console.log(next);
            summary = next;
          }
        })
        .catch(() =>
          console.error(
            'Native credential sync failed. Check source logins and credential-directory permissions.',
          ),
        )
        .finally(() => {
          pending = undefined;
        });
      return pending;
    };
    await sync();
    if (action === 'sync') return;
    const timer = setInterval(() => void sync(), 60000);
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.on(signal, async () => {
        clearInterval(timer);
        await pending;
        process.exit(0);
      });
    return;
  }
  if (action === 'install') {
    const node = execFileSync('/usr/bin/which', ['node'], {
      encoding: 'utf8',
    }).trim();
    const servicePath = process.env.PATH.split(':')
      .filter((path) => !path.includes('/node_modules/'))
      .join(':');
    const release = join(runtime, 'releases', String(Date.now()));
    await mkdir(join(release, 'server'), { recursive: true, mode: 0o700 });
    await mkdir(join(release, 'scripts'), { recursive: true, mode: 0o700 });
    for (const file of ['native-auth.js', 'native-cli.js'])
      await cp(join(root, 'server', file), join(release, 'server', file));
    await cp(
      fileURLToPath(import.meta.url),
      join(release, 'scripts', 'native-auth-service.mjs'),
    );
    await writeFile(join(release, 'package.json'), '{"type":"module"}\n', {
      mode: 0o600,
    });
    const document = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(join(release, 'scripts', 'native-auth-service.mjs'))}</string><string>run</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(servicePath)}</string><key>CLIPROXY_NATIVE_AUTH_DIR</key><string>${xml(authDir)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>35</integer>
<key>StandardOutPath</key><string>${xml(join(runtime, 'stdout.log'))}</string><key>StandardErrorPath</key><string>${xml(join(runtime, 'stderr.log'))}</string>
</dict></plist>
`;
    await mkdir(dirname(plist), { recursive: true });
    let oldPlist;
    try {
      oldPlist = await readFile(plist);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await stop();
    try {
      await writeFile(plist, document, { mode: 0o600 });
      launch(['enable', `${domain}/${label}`]);
      launch(['bootstrap', domain, plist]);
      await writeFile(
        stateFile,
        `${JSON.stringify({ release, authDir }, null, 2)}\n`,
        { mode: 0o600 },
      );
    } catch (error) {
      await stop();
      if (oldPlist) {
        await writeFile(plist, oldPlist);
        launch(['bootstrap', domain, plist]);
      } else await rm(plist, { force: true });
      throw error;
    }
    console.log(
      `Native sign-in sync installed. Credentials: ${authDir}. Status: ${statusFile}.`,
    );
  } else if (action === 'status') {
    console.log(
      previous
        ? launch(['print', `${domain}/${label}`], true) ||
            'Native sign-in sync is not running.'
        : 'Native sign-in sync is not installed.',
    );
    try {
      const result = JSON.parse(await readFile(statusFile, 'utf8'));
      console.log(
        `${result.accounts.length} native accounts. Last sync: ${result.checkedAt}.`,
      );
      for (const error of result.errors) console.log(error);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  } else if (action === 'uninstall') {
    await stop();
    await removeNativeAuth(authDir);
    await rm(plist, { force: true });
    await rm(stateFile, { force: true });
    console.log('Native sign-in sync and its exported credentials removed.');
  } else throw new Error('Choose install, status, sync, run, or uninstall.');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
