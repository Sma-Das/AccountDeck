import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Ask the installed CLI to refresh its own login. No model prompt is sent.
export function refreshNativeLogin(
  source,
  { spawnImpl = spawn, timeoutMs = 30000, cwd } = {},
) {
  const claude = source.kind === 'claude';
  const args = claude
    ? [
        '--print',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--no-session-persistence',
        '--permission-mode',
        'dontAsk',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--strict-mcp-config',
      ]
    : source.kind === 'codex'
      ? ['app-server']
      : ['models'];
  return new Promise((resolve, reject) => {
    const child = spawnImpl(source.binary, args, {
      cwd,
      env: {
        ...process.env,
        ...(source.kind === 'codex'
          ? { CODEX_HOME: source.home }
          : claude
            ? source.home === join(homedir(), '.claude')
              ? {}
              : { CLAUDE_CONFIG_DIR: source.home }
            : source.kind === 'grok'
              ? { GROK_HOME: source.home }
              : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      if (child.pid && child.exitCode === null) {
        const force = setTimeout(() => child.kill('SIGKILL'), 2000);
        force.unref();
        child.once('exit', () => clearTimeout(force));
      }
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `${source.label} did not refresh its login within 30 seconds.`,
          ),
        ),
      timeoutMs,
    );
    child.on('error', () =>
      finish(
        new Error(`Could not start ${source.label} to refresh its login.`),
      ),
    );
    child.on('exit', (code) => {
      if (['grok', 'antigravity'].includes(source.kind) && code === 0) finish();
      else finish(new Error(`${source.label} could not refresh its login.`));
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () =>
      finish(new Error(`${source.label} closed its login probe.`)),
    );
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (claude) {
        if (message.type !== 'control_response') return;
        const response = message.response;
        if (response?.subtype === 'error')
          return finish(
            new Error(`${source.label} could not refresh its login.`),
          );
        if (response?.request_id === 'init')
          send({
            type: 'control_request',
            request_id: 'usage',
            request: { subtype: 'get_usage' },
          });
        if (response?.request_id === 'usage') finish();
      } else if (source.kind === 'codex') {
        if (message.error)
          return finish(
            new Error(`${source.label} could not refresh its login.`),
          );
        if (message.id === 1) {
          send({ method: 'initialized' });
          send({
            id: 2,
            method: 'account/read',
            params: { refreshToken: true },
          });
        }
        if (message.id === 2) finish();
      }
    });
    if (claude)
      send({
        type: 'control_request',
        request_id: 'init',
        request: {
          subtype: 'initialize',
          hooks: {},
          mcpServers: {},
          agents: {},
        },
      });
    else if (source.kind === 'codex')
      send({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'cliproxy-native-auth', version: '0.1.0' },
        },
      });
  });
}
