import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, normalizeBaseUrl } from './app.js';

async function fixture(t, override, appOptions = {}) {
  const calls = [];
  const files = [
    {
      auth_index: 'c1',
      name: 'claude-user.json',
      provider: 'claude',
      email: 'user@example.com',
      access_token: 'provider-secret',
      priority: 2,
    },
    {
      auth_index: 'o1',
      name: 'codex-user.json',
      provider: 'codex',
      id_token: { chatgpt_account_id: 'account-1', plan_type: 'pro' },
    },
    { auth_index: 'x1', name: 'xai.json', provider: 'xai' },
  ];
  const app = createApp({
    ...appOptions,
    fetchImpl: async (url, options) => {
      const path =
        new URL(url).pathname.replace('/v8/management/', '') +
        new URL(url).search;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, ...options, body });
      const custom = override?.(path, options, body);
      if (custom) return custom;
      if (path === 'config')
        return Response.json({
          'config-version': 8,
          access: { 'api-keys': ['client-secret'] },
          routing: { strategy: 'fill-first', 'session-affinity': true },
        });
      if (path === 'credentials') return Response.json({ files });
      if (path === 'requests/api-call')
        return Response.json({
          status_code: 200,
          body: JSON.stringify(
            body.auth_index === 'c1'
              ? {
                  five_hour: { utilization: 24 },
                  seven_day: { utilization: 51 },
                }
              : {
                  rate_limit: {
                    primary_window: { used_percent: 25 },
                    secondary_window: { used_percent: 90 },
                  },
                },
          ),
        });
      if (path.startsWith('credentials/models'))
        return Response.json({
          models: [{ id: 'actual-model', display_name: 'Actual model' }],
        });
      if (path.startsWith('oauth/auth-url'))
        return Response.json({
          url: 'https://login.example.com/authorize',
          state: 'state-1',
        });
      if (path.startsWith('oauth/status'))
        return Response.json({ status: 'ok' });
      return Response.json({ status: 'ok' });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = new Map();
  const request = async (path, method = 'GET', body, extraHeaders = {}) => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        'X-Console-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [name, value] = header.split(';')[0].split('=');
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  };
  const login = () =>
    request('/session', 'POST', {
      baseUrl: 'http://proxy.local:8317',
      key: 'management-secret',
    });
  return { request, login, calls, app };
}

async function expiryFixture(t, options = {}) {
  let clock = Date.parse('2026-10-05T12:00:00Z');
  const reset = clock + 16 * 60000;
  const files = [
    { auth_index: 'c1', name: 'claude.json', provider: 'claude', priority: 3 },
    {
      auth_index: 'c2',
      name: 'claude-2.json',
      provider: 'claude',
      priority: 100,
    },
    { auth_index: 'o1', name: 'codex.json', provider: 'codex', priority: 7 },
    { auth_index: 'x1', name: 'xai.json', provider: 'xai', priority: 90 },
  ];
  const usage = new Map([
    [
      'c1',
      {
        five_hour: {
          utilization: 10,
          resets_at: new Date(reset).toISOString(),
        },
        seven_day: {
          utilization: 20,
          resets_at: new Date(reset + 86400000).toISOString(),
        },
      },
    ],
    [
      'c2',
      {
        five_hour: {
          utilization: 10,
          resets_at: new Date(reset + 5 * 60000).toISOString(),
        },
      },
    ],
    [
      'o1',
      {
        rate_limit: {
          primary_window: {
            used_percent: 25,
            reset_at: (reset + 60000) / 1000,
          },
        },
      },
    ],
  ]);
  let failQuota = false;
  let failRestore = false;
  const fixtureResult = await fixture(
    t,
    (path, _, body) => {
      if (path === 'credentials') return Response.json({ files });
      if (path === 'requests/api-call')
        return Response.json({
          status_code: failQuota ? 429 : 200,
          body: usage.get(body.auth_index),
        });
      if (path === 'credentials/fields') {
        if (failRestore && body.priority === 3)
          return Response.json({}, { status: 503 });
        files.find((file) => file.name === body.name).priority = body.priority;
      }
      if (path === 'credentials/status')
        files.find((file) => file.name === body.name).disabled = body.disabled;
      return null;
    },
    { now: () => clock, ...options },
  );
  return {
    ...fixtureResult,
    files,
    usage,
    reset,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    failQuota: (value) => {
      failQuota = value;
    },
    failRestore: (value) => {
      failRestore = value;
    },
  };
}

test('expiry routing starts at exactly 15 minutes, polls live quota, and restores at reset', async (t) => {
  const f = await expiryFixture(t);
  await f.login();
  assert.equal(
    (await f.request('/expiry', 'PUT', { enabled: 'yes' })).status,
    400,
  );
  await f.request('/expiry', 'PUT', { enabled: true });
  assert.equal(f.files[0].priority, 3);
  f.advance(60000);
  await f.app.locals.expiry.tick();
  assert.equal(f.files[0].priority, 101);
  assert.equal(f.files[1].priority, 100);
  assert.equal(f.files[2].priority, 7);
  const writes = f.calls.filter(
    (call) => call.path === 'credentials/fields',
  ).length;
  await f.app.locals.expiry.tick();
  assert.equal(
    f.calls.filter((call) => call.path === 'credentials/fields').length,
    writes,
  );
  f.advance(15 * 60000);
  await f.app.locals.expiry.tick();
  assert.equal(f.files[0].priority, 3);
  assert.equal(f.files[2].priority, 8);
  assert.equal(f.files[3].priority, 90);
  await f.request('/expiry', 'PUT', { enabled: false });
  assert.deepEqual(
    f.files.map((file) => file.priority),
    [3, 100, 7, 90],
  );
});

test('depleted, paused, unavailable, and failed quotas are not auto-prioritized', async (t) => {
  const f = await expiryFixture(t);
  f.advance(60000);
  await f.login();
  await f.request('/expiry', 'PUT', { enabled: true });
  f.usage.get('c1').seven_day.utilization = 100;
  f.files[1].disabled = true;
  f.files[2].unavailable = true;
  await f.app.locals.expiry.tick();
  assert.equal(f.files[0].priority, 3);
  assert.equal((await f.request('/expiry')).data.boosted.length, 0);
  f.usage.get('c1').seven_day.utilization = 20;
  f.failQuota(true);
  await f.app.locals.expiry.tick();
  const state = (await f.request('/expiry')).data;
  assert.match(state.error, /429/);
  assert.equal(state.boosted.length, 0);
});

test('when several accounts expire, earliest reset wins without permanently raising priorities', async (t) => {
  const f = await expiryFixture(t);
  f.advance(6 * 60000);
  await f.login();
  await f.request('/expiry', 'PUT', { enabled: true });
  assert.equal(f.files[0].priority, 102);
  assert.equal(f.files[1].priority, 101);
  await f.app.locals.expiry.tick();
  assert.equal(f.files[0].priority, 102);
  assert.equal(f.files[1].priority, 101);
  f.advance(10 * 60000);
  await f.app.locals.expiry.tick();
  assert.equal(f.files[0].priority, 3);
  assert.equal(f.files[1].priority, 101);
  await f.request('/expiry', 'PUT', { enabled: false });
  assert.equal(f.files[1].priority, 100);
});

test('priority edits during a boost become the restored priority and pausing releases it', async (t) => {
  const f = await expiryFixture(t);
  f.advance(60000);
  await f.login();
  await f.request('/expiry', 'PUT', { enabled: true });
  await f.request('/accounts/c1', 'PATCH', { priority: 12 });
  assert.equal(f.files[0].priority, 101);
  assert.equal(
    (await f.request('/expiry')).data.boosted[0].originalPriority,
    12,
  );
  await f.request('/accounts/c1', 'PATCH', { disabled: true });
  assert.equal(f.files[0].priority, 12);
  assert.equal(f.files[0].disabled, true);
});

test('external priority edits win for the current window and restore failures retry', async (t) => {
  const f = await expiryFixture(t);
  f.advance(60000);
  await f.login();
  await f.request('/expiry', 'PUT', { enabled: true });
  f.files[0].priority = 50;
  await f.app.locals.expiry.tick();
  await f.app.locals.expiry.tick();
  assert.equal(f.files[0].priority, 50);
  assert.equal((await f.request('/expiry')).data.boosted.length, 0);
  await f.request('/expiry', 'PUT', { enabled: false });
  f.files[0].priority = 3;
  await f.request('/expiry', 'PUT', { enabled: true });
  f.failRestore(true);
  assert.equal(
    (await f.request('/expiry', 'PUT', { enabled: false })).status,
    503,
  );
  assert.equal((await f.request('/expiry')).data.boosted.length, 1);
  f.failRestore(false);
  await f.app.locals.expiry.tick();
  assert.equal(f.files[0].priority, 3);
  assert.equal((await f.request('/expiry')).data.boosted.length, 0);
});

test('disconnect, session expiry, and shutdown restore temporary priorities', async (t) => {
  const f = await expiryFixture(t);
  f.advance(60000);
  await f.login();
  await f.request('/expiry', 'PUT', { enabled: true });
  await f.request('/session', 'DELETE');
  assert.equal(f.files[0].priority, 3);
  await f.login();
  await f.request('/expiry', 'PUT', { enabled: true });
  await f.app.locals.expiry.close();
  assert.equal(f.files[0].priority, 3);
  await f.request('/expiry', 'PUT', { enabled: true });
  f.advance(12 * 3600000 + 1);
  await f.app.locals.expiry.tick();
  assert.equal(f.files[0].priority, 3);
  assert.equal((await f.request('/session')).data.connected, false);
});

test('normalizes proxy URLs and rejects credentials or invalid protocols', () => {
  assert.equal(
    normalizeBaseUrl('http://localhost:8317/v8/management/'),
    'http://localhost:8317',
  );
  assert.equal(
    normalizeBaseUrl('https://host.ts.net/v1'),
    'https://host.ts.net',
  );
  for (const url of [
    'file:///etc/passwd',
    'http://user:pass@localhost',
    'http://localhost?key=secret',
  ])
    assert.throws(() => normalizeBaseUrl(url));
});

test('requires a session and rejects cross-origin requests', async (t) => {
  const { request, calls } = await fixture(t);
  assert.equal((await request('/snapshot')).status, 401);
  assert.equal(
    (
      await request(
        '/session',
        'POST',
        {},
        { Origin: 'https://attacker.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await request('/session', 'POST', {}, { 'X-Console-Request': '' })).status,
    403,
  );
  assert.equal(calls.length, 0);
});

const defaultConnection = {
  baseUrl: 'http://proxy.local:8317',
  key: 'management-secret',
};

test('fresh browsers automatically connect to the configured proxy without sharing OAuth state or exposing keys', async (t) => {
  const f = await fixture(t, undefined, {
    defaultConnection,
    publicOrigin: 'https://console.example.ts.net:8443',
  });
  assert.equal(
    (
      await f.request('/session', 'GET', undefined, {
        Origin: 'https://attacker.example',
      })
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
  const first = await f.request('/session');
  assert.equal(first.data.connected, true);
  assert.equal(first.data.automatic, true);
  assert.match(
    first.headers.get('set-cookie'),
    /HttpOnly.*Secure.*SameSite=Strict/,
  );
  const firstCookie = first.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('cliproxy_session='));
  const second = await f.request('/session', 'GET', undefined, { Cookie: '' });
  assert.equal(second.data.connected, true);
  assert.notEqual(
    second.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('cliproxy_session=')),
    firstCookie,
  );
  assert.equal(f.calls.filter((call) => call.path === 'config').length, 1);
  const snapshot = (await f.request('/snapshot')).data;
  assert.equal(snapshot.accounts.length, 3);
  assert.equal(snapshot.baseUrl, defaultConnection.baseUrl);
  assert.equal(snapshot.accounts[0].quota.windows[0].remaining, 76);
  assert.equal(snapshot.expiry.enabled, true);
  assert.ok(
    !JSON.stringify({ first: first.data, snapshot }).includes('secret'),
  );
  await f.request('/oauth', 'POST', { provider: 'claude' });
  await f.request('/session', 'GET', undefined, { Cookie: '' });
  assert.equal((await f.request('/oauth/state-1')).status, 404);
});

test('explicit disconnect selects demo only for that browser, and manual reconnect clears the choice', async (t) => {
  const f = await fixture(t, undefined, { defaultConnection });
  await f.request('/session');
  await f.request('/session', 'DELETE');
  assert.equal((await f.request('/session')).data.connected, false);
  assert.equal((await f.request('/snapshot')).status, 401);
  await f.login();
  assert.equal((await f.request('/session')).data.connected, true);
  const fresh = await f.request('/session', 'GET', undefined, { Cookie: '' });
  assert.equal(fresh.data.automatic, true);
});

test('configured connection failures retry instead of falling back to invented demo data', async (t) => {
  let unavailable = true;
  const f = await fixture(
    t,
    (path) =>
      path === 'config' && unavailable
        ? Response.json({}, { status: 503 })
        : null,
    { defaultConnection },
  );
  const failed = await f.request('/session');
  assert.equal(failed.status, 503);
  assert.ok(
    !failed.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith('cliproxy_session=')),
  );
  assert.ok(
    failed.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith('accountdeck_session=')),
  );
  unavailable = false;
  assert.equal((await f.request('/session')).data.connected, true);
});

test('configured automation runs without a browser and survives browser session expiry and eviction', async (t) => {
  const f = await expiryFixture(t, { defaultConnection });
  f.advance(60000);
  await f.app.locals.maintain();
  assert.equal(f.files[0].priority, 101);
  for (let index = 0; index < 52; index++)
    await f.request('/session', 'GET', undefined, { Cookie: '' });
  f.advance(12 * 3600000 + 1);
  await f.app.locals.maintain();
  assert.equal(f.files[0].priority, 3);
  const session = await f.request('/session');
  assert.equal(session.data.automatic, true);
  assert.equal((await f.request('/expiry')).data.enabled, true);
});

test('configured automation settings persist only for the configured proxy', async (t) => {
  const saved = [];
  const f = await fixture(t, undefined, {
    defaultConnection,
    persistDefaultAutomation: async (enabled) => saved.push(enabled),
  });
  await f.request('/session');
  await f.request('/expiry', 'PUT', { enabled: false });
  assert.deepEqual(saved, [false]);
  await f.request('/session', 'POST', {
    baseUrl: 'http://other-proxy.local',
    key: 'management-secret',
  });
  await f.request('/expiry', 'PUT', { enabled: true });
  assert.deepEqual(saved, [false]);
});

test('configured API access renews an expired browser session without a page reload', async (t) => {
  let clock = Date.now();
  const f = await fixture(t, undefined, {
    defaultConnection,
    now: () => clock,
  });
  await f.request('/session');
  clock += 12 * 3600000 + 1;
  const snapshot = await f.request('/snapshot');
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.data.accounts.length, 3);
  assert.ok(
    snapshot.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith('cliproxy_session=')),
  );
});

test('login uses HTTP-only sessions and snapshots do not expose keys or tokens', async (t) => {
  const { request, login, calls } = await fixture(t);
  const response = await login();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  const snapshot = await request('/snapshot');
  assert.equal(snapshot.data.accounts.length, 3);
  assert.deepEqual(snapshot.data.routing, {
    strategy: 'fill-first',
    affinity: true,
    ttl: '1h',
  });
  assert.ok(!JSON.stringify(snapshot.data).includes('secret'));
  assert.ok(
    calls.every(
      (call) => call.headers.Authorization === 'Bearer management-secret',
    ),
  );
});

test('omitted routing configuration uses upstream defaults', async (t) => {
  const { request, login } = await fixture(t, (path) =>
    path === 'config' ? Response.json({ 'config-version': 8 }) : null,
  );
  await login();
  assert.deepEqual((await request('/snapshot')).data.routing, {
    strategy: 'round-robin',
    affinity: false,
    ttl: '1h',
  });
});

test('invalid management keys are not retried and never create a session', async (t) => {
  const { request, login, calls } = await fixture(t, () =>
    Response.json({ error: 'invalid key' }, { status: 401 }),
  );
  assert.equal((await login()).status, 401);
  assert.equal(calls.length, 1);
  assert.equal((await request('/session')).data.connected, false);
});

test('quota requests use stored credentials, fixed provider URLs, and cached normalized results', async (t) => {
  const { request, login, calls } = await fixture(t);
  await login();
  const claude = await request('/accounts/c1/quota', 'POST');
  assert.equal(claude.data.windows[0].remaining, 76);
  const codex = await request('/accounts/o1/quota', 'POST');
  assert.equal(codex.data.windows[1].remaining, 10);
  const quotaCalls = calls.filter((call) => call.path === 'requests/api-call');
  assert.equal(quotaCalls[0].body.header.Authorization, 'Bearer $TOKEN$');
  assert.equal(
    quotaCalls[0].body.url,
    'https://api.anthropic.com/api/oauth/usage',
  );
  assert.equal(quotaCalls[1].body.header['Chatgpt-Account-Id'], 'account-1');
  assert.equal(
    (await request('/snapshot')).data.accounts[0].quota.windows[0].remaining,
    76,
  );
});

test('unknown, disabled, and unsupported accounts do not make provider quota calls', async (t) => {
  const { request, login, calls } = await fixture(t, (path) =>
    path === 'credentials'
      ? Response.json({
          files: [
            {
              auth_index: 'paused',
              name: 'paused.json',
              provider: 'claude',
              disabled: true,
            },
            {
              auth_index: 'x1',
              name: 'antigravity.json',
              provider: 'antigravity',
            },
          ],
        })
      : null,
  );
  await login();
  assert.equal((await request('/accounts/missing/quota', 'POST')).status, 404);
  assert.equal((await request('/accounts/paused/quota', 'POST')).status, 400);
  assert.equal((await request('/accounts/x1/quota', 'POST')).status, 422);
  assert.ok(!calls.some((call) => call.path === 'requests/api-call'));
});

test('upstream quota failures are reported instead of returning invented limits', async (t) => {
  const { request, login } = await fixture(t, (path) =>
    path === 'requests/api-call'
      ? Response.json({ status_code: 429, body: '{}' })
      : null,
  );
  await login();
  const response = await request('/accounts/c1/quota', 'POST');
  assert.equal(response.status, 429);
  assert.match(response.data.error, /rate-limited/);
  assert.ok(!/reauthenticate|expired/i.test(response.data.error));
  assert.equal(response.headers.get('retry-after'), '300');
});

test('Grok quota inspection uses its fixed native billing endpoint', async (t) => {
  const { request, login, calls } = await fixture(t, (path, _, body) =>
    path === 'requests/api-call' && body.auth_index === 'x1'
      ? Response.json({
          status_code: 200,
          body: {
            config: {
              creditUsagePercent: 40,
              currentPeriod: {
                type: 'USAGE_PERIOD_TYPE_WEEKLY',
                end: '2026-10-12T00:00:00Z',
              },
            },
          },
        })
      : null,
  );
  await login();
  const quota = await request('/accounts/x1/quota', 'POST');
  assert.equal(quota.status, 200);
  assert.equal(quota.data.windows[0].remaining, 60);
  assert.equal(
    calls.find((call) => call.path === 'requests/api-call').body.url,
    'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
  );
});

test('native source labels come from local bridge metadata and are not applied to remote proxies', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cliproxy-native-status-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const nativeStatusFile = join(directory, 'status.json');
  await writeFile(
    nativeStatusFile,
    JSON.stringify({
      accounts: [
        {
          name: 'claude-user.json',
          provider: 'claude',
          source: 'Claude Code',
          plan: 'pro',
        },
      ],
    }),
  );
  const { request, login } = await fixture(
    t,
    (path) =>
      path === 'requests/api-call'
        ? Response.json({
            status_code: 200,
            body: {
              five_hour: { utilization: 93 },
              seven_day: { utilization: 14 },
              iguana_necktie: {
                utilization: 0,
                resets_at: '2026-11-05T07:59:00Z',
              },
            },
          })
        : null,
    { nativeStatusFile },
  );
  await login();
  assert.equal(
    (await request('/snapshot')).data.accounts[0].nativeSource,
    null,
  );
  await request('/session', 'POST', {
    baseUrl: 'http://127.0.0.1:8317',
    key: 'management-secret',
  });
  const account = (await request('/snapshot')).data.accounts[0];
  assert.equal(account.nativeSource, 'Claude Code');
  assert.equal(account.plan, 'pro');
  assert.deepEqual(account.creditModels, ['Fable']);
  const quota = await request('/accounts/c1/quota', 'POST');
  assert.equal(quota.data.plan, 'pro');
  assert.deepEqual(quota.data.creditModels, ['Fable']);
  assert.deepEqual(
    quota.data.windows.map((window) => window.id),
    ['five_hour', 'seven_day'],
  );
});

test('priority, pause, and routing updates use validated v8 payloads', async (t) => {
  const { request, login, calls } = await fixture(t);
  await login();
  await request('/accounts/c1', 'PATCH', { priority: 10 });
  await request('/accounts/c1', 'PATCH', { disabled: true });
  await request('/routing', 'PUT', { strategy: 'round-robin', affinity: true });
  assert.deepEqual(
    calls.find((call) => call.path === 'credentials/fields').body,
    { name: 'claude-user.json', priority: 10 },
  );
  assert.deepEqual(
    calls.find((call) => call.path === 'credentials/status').body,
    { name: 'claude-user.json', disabled: true },
  );
  assert.deepEqual(calls.find((call) => call.path === 'config/routing').body, {
    strategy: 'round-robin',
    'session-affinity': true,
  });
  assert.equal(
    (await request('/accounts/c1', 'PATCH', { priority: 101 })).status,
    400,
  );
  assert.equal(
    (await request('/routing', 'PUT', { strategy: 'made-up', affinity: true }))
      .status,
    400,
  );
});

test('OAuth flow checks provider, state, callback match, and supports cancellation', async (t) => {
  const { request, login, calls } = await fixture(t);
  await login();
  assert.equal(
    (await request('/oauth', 'POST', { provider: 'invalid' })).status,
    400,
  );
  const start = await request('/oauth', 'POST', { provider: 'codex' });
  assert.equal(start.data.state, 'state-1');
  assert.equal((await request('/oauth/state-1')).data.status, 'ok');
  assert.equal((await request('/oauth/unknown')).status, 404);
  assert.equal(
    (
      await request('/oauth/state-1/callback', 'POST', {
        redirectUrl: 'http://localhost:1234?state=wrong&code=abc',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/oauth/state-1/callback', 'POST', {
        redirectUrl: 'http://localhost:1234?state=state-1&code=abc',
      })
    ).status,
    200,
  );
  assert.equal((await request('/oauth/state-1', 'DELETE')).status, 200);
  assert.equal((await request('/oauth/state-1')).status, 404);
  assert.ok(
    calls.some(
      (call) =>
        call.path === 'oauth/callback' && call.body.provider === 'codex',
    ),
  );
});

test('model discovery returns proxy model IDs and logout invalidates access', async (t) => {
  const { request, login } = await fixture(t);
  await login();
  assert.deepEqual((await request('/models?account=o1')).data.models, [
    { id: 'actual-model', name: 'Actual model' },
  ]);
  await request('/session', 'DELETE');
  assert.equal((await request('/session')).data.connected, false);
  assert.equal((await request('/snapshot')).status, 401);
});

test('pinned HTTPS origins work behind Serve while hostile origins remain blocked', async (t) => {
  const origin = 'https://console.example.ts.net:8443';
  const { request } = await fixture(t, null, { publicOrigin: origin });
  const login = await request(
    '/session',
    'POST',
    { baseUrl: 'http://proxy.local:8317', key: 'management-secret' },
    { Origin: origin },
  );
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  assert.equal(
    (await request('/snapshot', 'GET', undefined, { Origin: origin })).status,
    200,
  );
  assert.equal(
    (
      await request('/snapshot', 'GET', undefined, {
        Origin: 'https://attacker.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/snapshot', 'GET', undefined, {
        Origin: 'https://console.example.ts.net:443',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/snapshot', 'GET', undefined, {
        Origin: 'http://console.example.ts.net:8443',
      })
    ).status,
    403,
  );
});

test('Cursor subscription routes require a console session and keep credentials out of responses and proxy requests', async (t) => {
  const f = await fixture(t, (path) =>
    path === '/api/usage-summary'
      ? Response.json({
          membershipType: 'enterprise',
          individualUsage: { overall: { used: 1000, limit: 5000 } },
          teamUsage: { onDemand: { used: 20000, limit: 100000 } },
        })
      : null,
  );
  assert.equal((await f.request('/cursor')).status, 401);
  await f.request('/session', 'POST', {
    baseUrl: 'http://localhost:8317',
    key: 'secret',
  });
  const result = await f.request('/cursor', 'POST', {
    sessionToken: 'private-cursor-session',
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.plan, 'enterprise');
  assert.doesNotMatch(JSON.stringify(result.data), /private-cursor-session/);
  const cursorCall = f.calls.find((call) => call.path === '/api/usage-summary');
  assert.equal(
    cursorCall.headers.Cookie,
    'WorkosCursorSessionToken=private-cursor-session',
  );
  assert.ok(
    f.calls
      .filter((call) => call.path !== '/api/usage-summary')
      .every(
        (call) => !JSON.stringify(call).includes('private-cursor-session'),
      ),
  );
  assert.equal((await f.request('/cursor', 'DELETE')).data.connected, false);
  assert.equal((await f.request('/cursor')).data.connected, false);
});

test('GitHub workspace sessions are separate from proxy authentication and use secure cookies', async (t) => {
  const githubCalls = [];
  const { request, login } = await fixture(t, null, {
    publicOrigin: 'https://accountdeck.example',
    githubRequest: async (operation) => {
      githubCalls.push(operation);
      return { machine: operation.machine, accounts: [], mappings: [] };
    },
  });
  assert.equal((await request('/github/state')).status, 401);
  assert.equal(
    (
      await request('/workspace/session', 'GET', undefined, {
        'X-Console-Request': '',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/workspace/session', 'GET', undefined, {
        Origin: 'https://other.example',
      })
    ).status,
    403,
  );
  const opened = await request('/workspace/session', 'GET', undefined, {
    Origin: 'https://accountdeck.example',
  });
  assert.equal(opened.status, 200);
  assert.match(
    opened.headers.getSetCookie().join(';'),
    /accountdeck_session=.*HttpOnly.*Secure.*SameSite=Strict/,
  );
  assert.equal(
    (await request('/github/state?machine=work-mac')).data.machine,
    'work-mac',
  );
  assert.equal(githubCalls.at(-1).machine, 'work-mac');
  assert.equal((await request('/snapshot')).status, 401);
  await login();
  await request('/session', 'DELETE');
  assert.equal((await request('/github/state')).status, 200);
  assert.equal(githubCalls.at(-1).machine, 'local');
  assert.equal(
    (await request('/github/state?machine=../../other')).status,
    400,
  );
  assert.equal((await request('/github/state?machine[]=local')).status, 400);
  assert.equal((await request('/github/scan')).status, 400);
  const callsBefore = githubCalls.length;
  assert.equal(
    (await request('/github/exec', 'POST', { command: 'gh auth token' }))
      .status,
    404,
  );
  assert.equal((await request('/github/state', 'PUT', {})).status, 404);
  assert.equal(githubCalls.length, callsBefore);
  await request('/github/mappings?machine=work-mac', 'PUT', {
    path: '/work/project',
    host: 'github.com',
    account: 'work',
  });
  assert.deepEqual(githubCalls.at(-1), {
    endpoint: 'mappings',
    method: 'PUT',
    machine: 'work-mac',
    path: undefined,
    body: { path: '/work/project', host: 'github.com', account: 'work' },
  });
});

test('GitHub stays available when the configured AI proxy fails, and expired workspaces require renewal', async (t) => {
  let clock = Date.now();
  const { request } = await fixture(
    t,
    () => new Response('', { status: 503 }),
    {
      now: () => clock,
      defaultConnection: {
        baseUrl: 'http://proxy.local:8317',
        key: 'configured-secret',
      },
      githubRequest: async () => ({ accounts: [], mappings: [] }),
    },
  );
  assert.equal((await request('/session')).status, 503);
  assert.equal((await request('/github/state')).status, 200);
  clock += 13 * 60 * 60 * 1000;
  assert.equal((await request('/github/state')).status, 401);
  assert.equal((await request('/workspace/session')).status, 200);
  assert.equal((await request('/github/state')).status, 200);
});

test('quota 429 cooldown is shared by manual and background checks, retains usage, and honors Retry-After', async (t) => {
  let clock = Date.parse('2026-10-06T20:00:00Z');
  let limited = false;
  const { request, login, calls, app } = await fixture(
    t,
    (path, _, body) =>
      path === 'requests/api-call' && body.auth_index === 'c1' && limited
        ? Response.json({
            status_code: 429,
            header: { 'Retry-After': ['180'] },
            body: 'never-expose-upstream-secret',
          })
        : null,
    { now: () => clock },
  );
  await login();
  const success = await request('/accounts/c1/quota', 'POST');
  const before = success.data;
  limited = true;
  assert.equal((await request('/accounts/c1/quota', 'POST')).status, 429);
  const count = () =>
    calls.filter(
      (call) =>
        call.path === 'requests/api-call' && call.body.auth_index === 'c1',
    ).length;
  assert.equal(count(), 2);
  const cached = (await request('/snapshot')).data.accounts[0].quota;
  assert.deepEqual(cached.windows, before.windows);
  assert.equal(cached.updatedAt, before.updatedAt);
  assert.match(cached.error, /rate-limited/);
  assert.ok(!cached.error.includes('secret'));
  await request('/expiry', 'PUT', { enabled: true });
  clock += 60000;
  await app.locals.maintain();
  const cooldown = await request('/accounts/c1/quota', 'POST');
  assert.equal(cooldown.status, 429);
  assert.equal(cooldown.headers.get('retry-after'), '120');
  assert.equal(count(), 2);
  clock += 120000;
  limited = false;
  assert.equal((await request('/accounts/c1/quota', 'POST')).status, 200);
  assert.equal(count(), 3);
  assert.equal((await request('/snapshot')).data.accounts[0].quota.error, null);
});

test('repeated quota limits back off and success resets the delay; credentials keep distinct authentication errors', async (t) => {
  let clock = Date.parse('2026-10-06T20:00:00Z');
  let status = 429;
  let header = {};
  const { request, login, calls } = await fixture(
    t,
    (path) =>
      path === 'requests/api-call' && status !== 200
        ? Response.json({ status_code: status, header, body: '{}' })
        : null,
    { now: () => clock },
  );
  await login();
  assert.equal(
    (await request('/accounts/c1/quota', 'POST')).headers.get('retry-after'),
    '300',
  );
  clock += 300000;
  assert.equal(
    (await request('/accounts/c1/quota', 'POST')).headers.get('retry-after'),
    '600',
  );
  clock += 600000;
  header = { 'retry-after': new Date(clock + 240000).toUTCString() };
  assert.equal(
    (await request('/accounts/c1/quota', 'POST')).headers.get('retry-after'),
    '240',
  );
  clock += 240000;
  status = 200;
  assert.equal((await request('/accounts/c1/quota', 'POST')).status, 200);
  status = 429;
  header = {};
  assert.equal(
    (await request('/accounts/c1/quota', 'POST')).headers.get('retry-after'),
    '300',
  );
  status = 401;
  const auth = await request('/accounts/o1/quota', 'POST');
  assert.match(auth.data.error, /Reauthenticate/);
  assert.ok(!/rate-limited/.test(auth.data.error));
  assert.equal(
    calls.filter((call) => call.path === 'requests/api-call').length,
    6,
  );
});

test('concurrent quota refreshes share one request instead of causing a provider burst', async (t) => {
  // Each incoming refresh lists credentials before joining the pending quota read.
  // Keep the provider request open long enough for both HTTP handlers to overlap.
  const {
    request: parallel,
    login: parallelLogin,
    calls: parallelCalls,
  } = await fixture(t, (path) =>
    path === 'requests/api-call'
      ? new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                Response.json({
                  status_code: 200,
                  body: { five_hour: { utilization: 10 } },
                }),
              ),
            40,
          ),
        )
      : null,
  );
  await parallelLogin();
  const results = await Promise.all([
    parallel('/accounts/c1/quota', 'POST'),
    parallel('/accounts/c1/quota', 'POST'),
  ]);
  assert.ok(results.every((result) => result.status === 200));
  assert.equal(
    parallelCalls.filter((call) => call.path === 'requests/api-call').length,
    1,
  );
});

test('Grok Bot usage needs only a workspace session and works without a proxy', async (t) => {
  const { request } = await fixture(t, null, {
    grokBotDir: '/nonexistent/grok-bot',
  });
  assert.equal((await request('/grok-bot')).status, 401);
  await request('/workspace/session');
  const result = await request('/grok-bot');
  assert.equal(result.status, 200);
  assert.equal(result.data.connected, false);
});
