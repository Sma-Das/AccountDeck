import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultConnectionFile() {
  return join(
    homedir(),
    'Library',
    'Application Support',
    'CLIProxyAPI',
    'connection.json',
  );
}

export async function readConfiguredConnection(
  file = process.env.CONSOLE_CONNECTION_FILE || defaultConnectionFile(),
) {
  if (file === 'none') return null;
  let settings;
  try {
    settings = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && file === defaultConnectionFile())
      return null;
    throw new Error('Could not read the configured proxy connection file.');
  }
  const key = settings?.managementKey ?? settings?.key;
  if (
    typeof settings?.baseUrl !== 'string' ||
    typeof key !== 'string' ||
    !key.trim()
  )
    throw new Error(
      'The configured proxy needs a base URL and management key.',
    );
  if (
    settings.autoPrioritize !== undefined &&
    typeof settings.autoPrioritize !== 'boolean'
  )
    throw new Error('The configured autoPrioritize flag must be a boolean.');
  return {
    baseUrl: settings.baseUrl,
    key: key.trim(),
    autoPrioritize: settings.autoPrioritize !== false,
  };
}

export async function saveConfiguredAutomation(file, enabled) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const settings = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(
      temporary,
      `${JSON.stringify({ ...settings, autoPrioritize: enabled }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(temporary, file);
  } catch {
    throw new Error('Could not save the configured automation preference.');
  } finally {
    await rm(temporary, { force: true });
  }
}
