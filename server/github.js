import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function createGitHubBridge({
  python = process.env.GHR_PYTHON || 'python3',
  env = process.env,
  timeoutMs = 120000,
} = {}) {
  const worker = fileURLToPath(new URL('./github/worker.py', import.meta.url));
  const childEnv = {
    ...env,
    PATH: `${env.PATH || '/usr/bin:/bin'}:/opt/homebrew/bin:/usr/local/bin`,
    PYTHONDONTWRITEBYTECODE: '1',
  };
  for (const key of [
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'GH_ENTERPRISE_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN',
    'GH_DEBUG',
    'DEBUG',
  ])
    delete childEnv[key];
  return (operation) =>
    new Promise((resolve, reject) => {
      const payload = JSON.stringify(operation);
      if (Buffer.byteLength(payload) > 8192) {
        reject(
          Object.assign(new Error('GitHub workspace request is too large.'), {
            status: 400,
          }),
        );
        return;
      }
      const child = spawn(python, [worker], {
        env: childEnv,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let settled = false;
      const stop = () => {
        try {
          process.platform === 'win32'
            ? child.kill('SIGKILL')
            : process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already stopped. */
        }
      };
      const finish = (error, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          stop();
          reject(error);
        } else resolve(data);
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              'GitHub workspace request timed out. Try a smaller scan or reconnect the selected computer.',
            ),
          ),
        timeoutMs,
      );
      child.on('error', () =>
        finish(
          new Error(
            'Could not start GitHub routing. Install Python 3.9 or newer and GitHub CLI.',
          ),
        ),
      );
      child.stdin.on('error', () =>
        finish(new Error('GitHub routing stopped before reading the request.')),
      );
      child.stderr.on('data', () => {});
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (Buffer.byteLength(output) > 2 * 1024 * 1024)
          finish(new Error('GitHub workspace returned too much metadata.'));
      });
      child.on('close', (code) => {
        if (settled) return;
        try {
          if (code !== 0) throw new Error();
          const result = JSON.parse(output);
          if (!result.ok)
            return finish(
              Object.assign(
                new Error(result.error || 'GitHub workspace request failed.'),
                { status: result.status || 502 },
              ),
            );
          finish(null, result.data);
        } catch {
          finish(new Error('Could not read the GitHub workspace response.'));
        }
      });
      child.stdin.end(payload);
    });
}
