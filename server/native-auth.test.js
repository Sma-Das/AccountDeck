import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nativeRecords,
  readNativeSource,
  syncNativeAuth,
  removeNativeAuth,
  discoverNativeSources,
} from './native-auth.js';

const token = (claims) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const source = { id: 'codex-home', kind: 'codex', label: 'Codex CLI' };
const access = token({
  exp: 2000000000,
  'https://api.openai.com/auth': {
    chatgpt_account_id: 'account-1',
    chatgpt_plan_type: 'plus',
  },
  'https://api.openai.com/profile': { email: 'user@example.com' },
});
const credentials = {
  auth_mode: 'chatgpt',
  tokens: {
    access_token: access,
    refresh_token: 'native-refresh-secret',
    account_id: 'account-1',
  },
};
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cliproxy-native-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('native Codex and OpenCode identities reuse access tokens without copying refresh credentials', () => {
  const [codex] = nativeRecords(source, credentials);
  assert.equal(codex.access_token, access);
  assert.equal(codex.refresh_token, '');
  assert.equal(codex.account_id, 'account-1');
  assert.equal(codex.email, 'user@example.com');
  assert.equal(codex.plan_type, 'plus');
  assert.ok(!JSON.stringify(codex).includes('native-refresh-secret'));
  const [openCode] = nativeRecords(
    { id: 'opencode-home', kind: 'opencode', label: 'OpenCode' },
    { openai: { type: 'oauth', access, refresh: 'other-refresh-secret' } },
  );
  assert.equal(openCode.account_id, codex.account_id);
  assert.equal(openCode.refresh_token, '');
  assert.deepEqual(nativeRecords(source, { OPENAI_API_KEY: 'api-key' }), []);
  assert.deepEqual(
    nativeRecords(
      { kind: 'opencode' },
      { openai: { type: 'api', key: 'api-key' } },
    ),
    [],
  );
});

test('Claude Keychain reads are scoped to the selected profile and never fall back to another account', async () => {
  const calls = [];
  const options = {
    home: '/Users/native',
    platform: 'darwin',
    execImpl: async (_, args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify({
          claudeAiOauth: {
            accessToken: 'native-access',
            refreshToken: 'native-refresh',
            expiresAt: 2000000000000,
          },
        }),
      };
    },
  };
  const profile = {
    id: 'claude-home',
    kind: 'claude',
    label: 'Claude Code',
    home: '/Users/native/.claude',
  };
  const [record] = await readNativeSource(profile, options);
  assert.equal(calls[0][2], 'Claude Code-credentials');
  assert.equal(record.refresh_token, '');
  await readNativeSource(
    { ...profile, home: '/Users/native/.claude-work' },
    options,
  );
  assert.match(calls[1][2], /^Claude Code-credentials-[a-f0-9]{8}$/);
  const missing = await readNativeSource(profile, {
    ...options,
    execImpl: async () => {
      throw Object.assign(new Error('missing'), { code: 44 });
    },
  });
  assert.deepEqual(missing, []);
});

test('sync follows native token changes, preserves proxy controls, and deduplicates the same account', async (t) => {
  const authDir = await directory(t);
  let data = credentials;
  const readSource = async (s) =>
    nativeRecords(
      s,
      s.kind === 'opencode' ? { openai: { type: 'oauth', access } } : data,
    );
  const options = {
    authDir,
    sources: [
      source,
      { id: 'opencode-home', kind: 'opencode', label: 'OpenCode' },
    ],
    readSource,
    now: () => 1800000000000,
  };
  const first = await syncNativeAuth(options);
  assert.equal(first.accounts.length, 1);
  assert.equal(first.accounts[0].source, 'Codex CLI');
  const [name] = await readdir(authDir);
  const path = join(authDir, name);
  const previous = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(
    path,
    JSON.stringify({
      ...previous,
      priority: 42,
      disabled: true,
      note: 'user setting',
    }),
  );
  data = {
    ...credentials,
    tokens: {
      ...credentials.tokens,
      access_token: token({
        exp: 2000000100,
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'account-1',
          chatgpt_plan_type: 'plus',
        },
      }),
    },
  };
  await syncNativeAuth(options);
  const next = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(next.access_token, data.tokens.access_token);
  assert.equal(next.priority, 42);
  assert.equal(next.disabled, true);
  assert.equal(next.note, 'user setting');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(credentials.tokens.refresh_token, 'native-refresh-secret');
});

test('sign-out removes only bridge-owned exports; temporary read failures preserve them', async (t) => {
  const authDir = await directory(t);
  await writeFile(
    join(authDir, 'manual.json'),
    '{"type":"codex","access_token":"manual"}',
  );
  const options = {
    authDir,
    sources: [source],
    readSource: async () => nativeRecords(source, credentials),
  };
  await syncNativeAuth(options);
  const failed = await syncNativeAuth({
    ...options,
    readSource: async () => {
      throw new Error('Could not read native credentials.');
    },
  });
  assert.equal(failed.errors.length, 1);
  assert.equal((await readdir(authDir)).length, 2);
  await syncNativeAuth({ ...options, readSource: async () => [] });
  assert.deepEqual(await readdir(authDir), ['manual.json']);
  await syncNativeAuth(options);
  await removeNativeAuth(authDir);
  assert.deepEqual(await readdir(authDir), ['manual.json']);
});

test('near-expiry tokens are refreshed by the native CLI and reread before export', async (t) => {
  const authDir = await directory(t);
  let refreshed = false;
  const old = token({
    exp: 1800000010,
    'https://api.openai.com/auth': { chatgpt_account_id: 'account-1' },
  });
  const result = await syncNativeAuth({
    authDir,
    sources: [{ ...source, binary: 'codex' }],
    now: () => 1800000000000,
    readSource: async () =>
      nativeRecords(source, {
        tokens: { access_token: refreshed ? access : old },
      }),
    refresh: async (s) => {
      assert.equal(s.binary, 'codex');
      refreshed = true;
    },
  });
  assert.equal(refreshed, true);
  assert.equal(result.accounts[0].expired, false);
  const [name] = await readdir(authDir);
  assert.equal(
    JSON.parse(await readFile(join(authDir, name), 'utf8')).access_token,
    access,
  );
});

test('T3 custom provider homes are discovered without loading or changing T3 credentials', async (t) => {
  const home = await directory(t);
  const userdata = join(home, '.t3', 'userdata');
  await mkdir(userdata, { recursive: true });
  const settings = {
    providerInstances: {
      work: {
        driver: 'claudeAgent',
        enabled: true,
        config: { homePath: '~/claude-work', binaryPath: 'work-claude' },
      },
      disabled: {
        driver: 'codex',
        enabled: false,
        config: { homePath: '~/disabled' },
      },
    },
  };
  const path = join(userdata, 'settings.json');
  await writeFile(path, JSON.stringify(settings));
  const sources = await discoverNativeSources({ home, env: {} });
  assert.equal(sources.length, 5);
  assert.equal(sources.at(-1).home, join(home, 'claude-work'));
  assert.equal(sources.at(-1).binary, 'work-claude');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), settings);
});
