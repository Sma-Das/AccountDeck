import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  rename,
  unlink,
  chmod,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { refreshNativeLogin } from './native-cli.js';

const exec = promisify(execFile);
const marker = 'cliproxy-native-v1';
const hash = (text) =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);
const jwt = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch {
    return {};
  }
};
async function json(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Could not read native credential data.');
  }
}
const expand = (path, home) =>
  path.startsWith('~/') ? join(home, path.slice(2)) : resolve(path);

export async function discoverNativeSources({
  home = homedir(),
  env = process.env,
} = {}) {
  const sources = [
    {
      kind: 'codex',
      label: 'Codex CLI',
      home: env.CODEX_HOME || join(home, '.codex'),
      binary: 'codex',
    },
    {
      kind: 'claude',
      label: 'Claude Code',
      home: env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
      binary: 'claude',
    },
    {
      kind: 'grok',
      label: 'Grok CLI',
      home: env.GROK_HOME || join(home, '.grok'),
      binary: 'grok',
    },
    {
      kind: 'opencode',
      label: 'OpenCode',
      home: join(
        env.XDG_DATA_HOME || join(home, '.local', 'share'),
        'opencode',
      ),
    },
  ];
  const settings = await json(join(home, '.t3', 'userdata', 'settings.json'));
  for (const instance of Object.values(settings?.providerInstances || {})) {
    const kind = instance.driver === 'claudeAgent' ? 'claude' : instance.driver;
    if (
      instance.enabled === false ||
      !['claude', 'codex'].includes(kind) ||
      !instance.config?.homePath
    )
      continue;
    sources.push({
      kind,
      label: kind === 'claude' ? 'Claude Code' : 'Codex CLI',
      home: expand(instance.config.homePath, home),
      binary: instance.config.binaryPath || kind,
    });
  }
  const unique = new Map();
  for (const source of sources) {
    source.home = resolve(source.home);
    source.id = hash(`${source.kind}:${source.home}`);
    unique.set(source.id, source);
  }
  return [...unique.values()];
}

export function nativeRecords(source, data, account = {}) {
  const provenance = { owner: marker, id: source.id, label: source.label };
  const record = (type, accessToken, identity = {}, expiresAt) => {
    if (typeof accessToken !== 'string' || !accessToken.trim()) return null;
    const claims = jwt(accessToken);
    const expires = expiresAt || (claims.exp ? claims.exp * 1000 : null);
    return {
      type,
      access_token: accessToken,
      refresh_token: '',
      ...identity,
      ...(Number.isFinite(Number(expires)) && Number(expires) > 0
        ? { expired: new Date(Number(expires)).toISOString() }
        : {}),
      native_source: provenance,
    };
  };
  const codexRecord = (tokens) => {
    const claims = jwt(tokens?.access_token || '');
    const idClaims = jwt(tokens?.id_token || '');
    const auth =
      claims['https://api.openai.com/auth'] ||
      idClaims['https://api.openai.com/auth'] ||
      {};
    return record('codex', tokens?.access_token, {
      id_token: tokens?.id_token || '',
      account_id: tokens?.account_id || auth.chatgpt_account_id || '',
      email:
        claims.email ||
        claims['https://api.openai.com/profile']?.email ||
        idClaims.email ||
        '',
      plan_type: auth.chatgpt_plan_type || '',
    });
  };
  if (source.kind === 'codex')
    return data?.auth_mode === 'apikey' || data?.OPENAI_API_KEY
      ? []
      : [codexRecord(data?.tokens)].filter(Boolean);
  if (source.kind === 'claude') {
    const oauth = data?.claudeAiOauth;
    return [
      record(
        'claude',
        oauth?.accessToken,
        {
          email: account.emailAddress || account.email || '',
          account_uuid: account.accountUuid || '',
          organization_uuid: account.organizationUuid || '',
          plan_type: oauth?.subscriptionType || account.subscriptionType || '',
        },
        oauth?.expiresAt,
      ),
    ].filter(Boolean);
  }
  if (source.kind === 'grok') {
    const auth =
      data?.['https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828'] ||
      data?.['https://accounts.x.ai/sign-in'];
    return !auth || auth.auth_mode === 'api_key'
      ? []
      : [
          record('xai', auth.key, {
            email: auth.email || '',
            sub: auth.user_id || jwt(auth.key || '').sub || '',
            auth_kind: 'oauth',
            base_url: 'https://cli-chat-proxy.grok.com/v1',
          }),
        ].filter(Boolean);
  }
  if (source.kind === 'opencode') {
    const records = [];
    if (data?.openai?.type === 'oauth')
      records.push(
        codexRecord({
          access_token: data.openai.access,
          account_id: data.openai.accountId,
        }),
      );
    return records.filter(Boolean);
  }
  return [];
}

export async function readNativeSource(
  source,
  { home = homedir(), platform = process.platform, execImpl = exec } = {},
) {
  if (source.kind !== 'claude')
    return nativeRecords(source, await json(join(source.home, 'auth.json')));
  let credentials;
  if (platform === 'darwin') {
    const service =
      source.home === join(home, '.claude')
        ? 'Claude Code-credentials'
        : `Claude Code-credentials-${createHash('sha256').update(source.home).digest('hex').slice(0, 8)}`;
    try {
      const { stdout } = await execImpl(
        '/usr/bin/security',
        ['find-generic-password', '-s', service, '-w'],
        { timeout: 10000, maxBuffer: 1024 * 1024 },
      );
      credentials = JSON.parse(stdout);
    } catch (error) {
      if (error.code === 44) return [];
      throw new Error('Could not read the Claude Code Keychain login.');
    }
  } else credentials = await json(join(source.home, '.credentials.json'));
  const config = await json(
    source.home === join(home, '.claude')
      ? join(home, '.claude.json')
      : join(source.home, '.claude.json'),
  );
  return nativeRecords(source, credentials, config?.oauthAccount);
}

export async function syncNativeAuth({
  authDir = join(homedir(), '.cli-proxy-api'),
  sources,
  readSource = readNativeSource,
  refresh = refreshNativeLogin,
  now = Date.now,
  cwd,
} = {}) {
  sources ||= await discoverNativeSources();
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  const records = new Map();
  const failed = new Set();
  const errors = [];
  for (const source of sources) {
    try {
      let found = await readSource(source);
      if (
        source.binary &&
        found.some((record) => Date.parse(record.expired) <= now() + 5 * 60000)
      ) {
        await refresh(source, { cwd });
        found = await readSource(source);
      }
      for (const record of found) {
        const identity =
          record.account_id ||
          record.account_uuid ||
          record.sub ||
          record.email;
        if (!identity) {
          errors.push(`${source.label} did not report an account identity.`);
          failed.add(source.id);
          continue;
        }
        const name = `native-${record.type}-${hash(identity)}.json`;
        const prior = records.get(name);
        // Prefer the native CLI over a duplicate account stored in OpenCode.
        if (
          !prior ||
          (prior.native_source.label === 'OpenCode' &&
            source.kind !== 'opencode')
        )
          records.set(name, record);
      }
    } catch (error) {
      failed.add(source.id);
      errors.push(`${source.label}: ${error.message}`);
    }
  }
  for (const name of await readdir(authDir)) {
    if (!/^native-(claude|codex|xai)-[a-f0-9]{16}\.json$/.test(name)) continue;
    const previous = await json(join(authDir, name));
    if (previous?.native_source?.owner !== marker) continue;
    if (!records.has(name) && !failed.has(previous.native_source.id))
      await unlink(join(authDir, name));
  }
  const accounts = [];
  for (const [name, credentials] of records) {
    const path = join(authDir, name);
    const previous = await json(path);
    if (previous && previous.native_source?.owner !== marker) {
      errors.push(`A non-native credential already uses ${name}.`);
      continue;
    }
    // Routing and pause settings belong to the proxy; preserve them on token changes.
    const next = {
      ...previous,
      ...credentials,
      disabled: !!previous?.disabled,
      priority: Number(previous?.priority) || 0,
      label: credentials.native_source.label,
    };
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(`${path}.tmp`, path);
      await chmod(path, 0o600);
    }
    accounts.push({
      name,
      provider: next.type,
      source: next.native_source.label,
      plan: next.plan_type || null,
      email: next.email,
      expired: Date.parse(next.expired) <= now(),
    });
  }
  return { accounts, errors, checkedAt: new Date(now()).toISOString() };
}

export async function removeNativeAuth(authDir) {
  let names;
  try {
    names = await readdir(authDir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const name of names) {
    if (!/^native-(claude|codex|xai)-[a-f0-9]{16}\.json$/.test(name)) continue;
    if ((await json(join(authDir, name)))?.native_source?.owner === marker)
      await unlink(join(authDir, name));
  }
}
