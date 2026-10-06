import { createApp } from './app.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createGitHubBridge } from './github.js';
import {
  readConfiguredConnection,
  defaultConnectionFile,
  saveConfiguredAutomation,
} from './connection.js';
const port = Number(process.env.PORT || 4318);
const connectionFile =
  process.env.CONSOLE_CONNECTION_FILE || defaultConnectionFile();
const defaultConnection = await readConfiguredConnection(connectionFile);
const app = createApp({
  serveStatic: true,
  githubRequest: createGitHubBridge(),
  cursorStateFile: join(
    homedir(),
    'Library',
    'Application Support',
    'CLIProxy Console',
    'cursor-connection.json',
  ),
  defaultConnection,
  persistDefaultAutomation: defaultConnection
    ? (enabled) => saveConfiguredAutomation(connectionFile, enabled)
    : undefined,
  nativeStatusFile:
    process.env.CONSOLE_NATIVE_STATUS ||
    join(
      homedir(),
      'Library',
      'Application Support',
      'CLIProxy Native Auth',
      'status.json',
    ),
  expiryStateFile:
    process.env.CONSOLE_EXPIRY_STATE ||
    (process.platform === 'darwin'
      ? join(
          homedir(),
          'Library',
          'Application Support',
          'CLIProxy Console',
          'expiry-priorities.json',
        )
      : join(
          process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
          'cliproxy-console',
          'expiry-priorities.json',
        )),
});
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`AccountDeck is running at http://127.0.0.1:${port}`),
);
const maintain = () =>
  app.locals
    .maintain()
    .catch((error) =>
      console.error('Proxy maintenance failed:', error.message),
    );
void maintain();
const timer = setInterval(() => void maintain(), 60000);
timer.unref();
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    server.close();
    try {
      await app.locals.expiry.close();
    } catch (error) {
      console.error('Could not restore expiry priorities:', error.message);
    }
    process.exit(0);
  });
}
