import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readConfiguredConnection,
  saveConfiguredAutomation,
} from './connection.js';

async function file(t, data) {
  const directory = await mkdtemp(join(tmpdir(), 'cliproxy-connection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'connection.json');
  await writeFile(path, JSON.stringify(data), { mode: 0o600 });
  return path;
}

test('configured connections use only the management key and enable automatic priority by default', async (t) => {
  const path = await file(t, {
    baseUrl: 'http://127.0.0.1:8317',
    managementKey: 'management-secret',
    clientKey: 'client-secret',
  });
  assert.deepEqual(await readConfiguredConnection(path), {
    baseUrl: 'http://127.0.0.1:8317',
    key: 'management-secret',
    autoPrioritize: true,
  });
  assert.equal(await readConfiguredConnection('none'), null);
});

test('automation preferences survive restart while preserving keys and private file permissions', async (t) => {
  const path = await file(t, {
    baseUrl: 'http://127.0.0.1:8317',
    managementKey: 'management-secret',
    clientKey: 'client-secret',
  });
  await saveConfiguredAutomation(path, false);
  assert.equal((await readConfiguredConnection(path)).autoPrioritize, false);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.managementKey, 'management-secret');
  assert.equal(stored.clientKey, 'client-secret');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('invalid configured connections fail without exposing secret file contents', async (t) => {
  for (const settings of [
    null,
    { baseUrl: 'http://proxy', clientKey: 'client-secret' },
    { baseUrl: 'http://proxy', key: 'secret', autoPrioritize: 'yes' },
  ]) {
    const path = await file(t, settings);
    await assert.rejects(readConfiguredConnection(path));
  }
  const path = await file(t, {});
  await writeFile(path, 'management-secret invalid json');
  await assert.rejects(readConfiguredConnection(path), {
    message: 'Could not read the configured proxy connection file.',
  });
  await assert.rejects(saveConfiguredAutomation(path, true), {
    message: 'Could not save the configured automation preference.',
  });
});
