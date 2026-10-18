import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { safeAccount, normalizeQuota, claudeCreditModels } from './quota.js';
import { createExpiryRouter } from './expiry.js';
import { createCursorTracker } from './cursor.js';
import { createGrokBotReader } from './grok-bot.js';

const providers = new Set([
  'claude',
  'codex',
  'antigravity',
  'kimi',
  'kimi-ai',
  'xai',
]);
const TTL = 12 * 60 * 60 * 1000;
export function normalizeBaseUrl(input) {
  const url = new URL(input);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use an HTTP or HTTPS proxy URL without credentials, query parameters, or a fragment.',
    );
  url.pathname = url.pathname
    .replace(/\/(?:v8\/management|management\.html|v1)\/?$/, '')
    .replace(/\/$/, '');
  return url.toString().replace(/\/$/, '');
}

export function createApp({
  fetchImpl = fetch,
  serveStatic = false,
  publicOrigin = process.env.CONSOLE_ORIGIN || null,
  now = Date.now,
  expiryStateFile,
  nativeStatusFile,
  cursorStateFile,
  grokBotDir = null,
  defaultConnection = null,
  persistDefaultAutomation,
  githubRequest = null,
} = {}) {
  // Pin browser origins when HTTPS reverse proxies rewrite Host. A
  // comma-separated list lets a custom domain sit beside MagicDNS.
  const externalOrigins = (publicOrigin || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol))
        throw new Error('CONSOLE_ORIGIN must list HTTP or HTTPS origins.');
      return url.origin;
    });
  const secureCookies =
    externalOrigins.length > 0 &&
    externalOrigins.every((origin) => origin.startsWith('https://'));
  const app = express();
  const cursor = createCursorTracker({
    stateFile: cursorStateFile,
    fetchImpl,
    now,
  });
  const grokBot = createGrokBotReader({ dataDir: grokBotDir, now });
  const sessions = new Map();
  const workspaceSessions = new Map();
  const quotaReads = new Map();
  const configuredId = Symbol('configured-proxy');
  const configured = defaultConnection
    ? {
        ...defaultConnection,
        baseUrl: normalizeBaseUrl(defaultConnection.baseUrl),
      }
    : null;
  if (
    configured &&
    (typeof configured.key !== 'string' || !configured.key.trim())
  )
    throw new Error('The configured proxy needs a management key.');
  let configuredSession;
  let initialization;
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'strict',
    path: '/api',
    maxAge: TTL,
  };
  const makeSession = (connection) => ({
    baseUrl: connection.baseUrl,
    key: connection.key.trim(),
    expires: now() + TTL,
    files: [],
    quotas: new Map(),
    oauth: new Map(),
  });
  function connectBrowser(res, session) {
    if (sessions.size >= 50) {
      const oldest = [...sessions.keys()].find((id) => typeof id === 'string');
      if (oldest) sessions.delete(oldest);
    }
    const token = randomBytes(32).toString('hex');
    sessions.set(token, session);
    res.cookie('cliproxy_session', token, cookieOptions);
    return token;
  }
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    // Custom header blocks cross-origin form submissions. No CORS is enabled.
    if (req.get('X-Console-Request') !== '1')
      return res
        .status(403)
        .json({ error: 'Open the console to make this request.' });
    if (req.get('Origin')) {
      try {
        const origin = new URL(req.get('Origin'));
        if (
          externalOrigins.length
            ? !externalOrigins.includes(origin.origin)
            : origin.host !== req.get('Host')
        )
          return res
            .status(403)
            .json({ error: 'Cross-origin requests are not allowed.' });
      } catch {
        return res.status(403).json({ error: 'Invalid origin.' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    for (const [id, expires] of workspaceSessions)
      if (expires < now()) workspaceSessions.delete(id);
    const workspaceToken = req.headers.cookie
      ?.split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith('accountdeck_session='))
      ?.split('=')[1];
    req.workspaceAuthenticated = workspaceSessions.has(workspaceToken);
    if (req.workspaceAuthenticated)
      workspaceSessions.set(workspaceToken, now() + TTL);
    for (const [id, session] of sessions)
      if (session.expires < now()) sessions.delete(id);
    const token = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('cliproxy_session='))
      ?.split('=')[1];
    req.session = sessions.get(token);
    req.sessionId = token;
    req.demo = req.headers.cookie
      ?.split(';')
      .some((cookie) => cookie.trim() === 'cliproxy_demo=1');
    if (req.session) req.session.expires = now() + TTL;
    next();
  });

  async function upstream(session, path, method = 'GET', body) {
    const response = await fetchImpl(
      `${session.baseUrl}/v8/management/${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${session.key}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      },
    );
    if (!response.ok) {
      const messages = {
        401: 'Management key rejected. Check the key before reconnecting.',
        403: 'Remote management is disabled or access is temporarily blocked.',
        404: 'This endpoint is unavailable. Use CLIProxyAPI with the v8 management API enabled.',
      };
      const error = new Error(
        messages[response.status] ||
          `CLIProxyAPI returned HTTP ${response.status}.`,
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  async function credentials(session) {
    const result = await upstream(session, 'credentials');
    if (!Array.isArray(result.files))
      throw new Error('CLIProxyAPI returned an invalid credential list.');
    session.files = result.files;
    return result.files;
  }
  async function connectAutomatically(req, res) {
    if (req.session || req.demo || !configured) return;
    const connection = await initializeConfiguredConnection();
    const session = makeSession(connection);
    session.automatic = true;
    session.quotas = new Map(connection.quotas);
    req.session = session;
    req.sessionId = connectBrowser(res, session);
  }
  const required = async (req, res, next) => {
    await connectAutomatically(req, res);
    return req.session
      ? next()
      : res.status(401).json({ error: 'Connect to your proxy first.' });
  };
  const findAccount = async (session, id) => {
    const files = await credentials(session);
    const file = files.find((file) => safeAccount(file).id === id);
    if (!file) {
      const error = new Error(
        'Account no longer exists. Refresh the account list.',
      );
      error.status = 404;
      throw error;
    }
    return file;
  };

  function workspaceSession(req, res) {
    if (req.workspaceAuthenticated) return;
    if (workspaceSessions.size >= 50)
      workspaceSessions.delete(workspaceSessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    workspaceSessions.set(token, now() + TTL);
    res.cookie('accountdeck_session', token, cookieOptions);
    req.workspaceAuthenticated = true;
  }
  app.get('/api/workspace/session', (req, res) => {
    workspaceSession(req, res);
    res.json({ authenticated: true });
  });
  app.use('/api/github', async (req, res, next) => {
    if (!req.workspaceAuthenticated)
      return res
        .status(401)
        .json({ error: 'Reload AccountDeck to open a workspace session.' });
    if (!githubRequest)
      return res
        .status(503)
        .json({ error: 'GitHub routing is unavailable on this server.' });
    next();
  });
  for (const [method, endpoint] of [
    ['get', 'state'],
    ['get', 'scan'],
    ['put', 'mappings'],
    ['delete', 'mappings'],
    ['get', 'machines'],
    ['put', 'machines'],
    ['delete', 'machines'],
  ]) {
    app[method](`/api/github/${endpoint}`, async (req, res) => {
      if (
        Object.keys(req.query).some(
          (key) =>
            !['machine', ...(endpoint === 'scan' ? ['path'] : [])].includes(
              key,
            ),
        )
      )
        return res
          .status(400)
          .json({ error: 'Unknown GitHub workspace query parameter.' });
      if (
        req.query.machine !== undefined &&
        (typeof req.query.machine !== 'string' ||
          !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(req.query.machine))
      )
        return res.status(400).json({ error: 'Choose a valid computer name.' });
      if (
        endpoint === 'scan' &&
        (typeof req.query.path !== 'string' || !req.query.path)
      )
        return res
          .status(400)
          .json({ error: 'Choose a workspace folder to scan.' });
      res.json(
        await githubRequest({
          endpoint,
          method: method.toUpperCase(),
          machine: req.query.machine || 'local',
          path: req.query.path,
          body: req.body,
        }),
      );
    });
  }
  app.get('/api/session', async (req, res) => {
    workspaceSession(req, res);
    await connectAutomatically(req, res);
    res.json({
      connected: !!req.session,
      baseUrl: req.session?.baseUrl ?? null,
      automatic: !!req.session?.automatic,
    });
  });
  app.post('/api/session', async (req, res) => {
    const { baseUrl, key } = req.body;
    if (typeof baseUrl !== 'string' || typeof key !== 'string' || !key.trim())
      return res
        .status(400)
        .json({ error: 'Enter the proxy URL and management key.' });
    let normalized;
    try {
      normalized = normalizeBaseUrl(baseUrl);
    } catch {
      return res
        .status(400)
        .json({ error: 'Enter a valid HTTP or HTTPS proxy URL.' });
    }
    const session = makeSession({ baseUrl: normalized, key });
    await upstream(session, 'config');
    await credentials(session);
    if (req.sessionId) sessions.delete(req.sessionId);
    res.clearCookie('cliproxy_demo', { path: '/api' });
    connectBrowser(res, session);
    expiry.status(session);
    await expiry.tick();
    res.json({ connected: true, baseUrl: normalized });
  });
  app.delete('/api/session', async (req, res) => {
    sessions.delete(req.sessionId);
    await expiry.tick();
    res.clearCookie('cliproxy_session', { path: '/api' });
    if (configured) res.cookie('cliproxy_demo', '1', cookieOptions);
    res.json({ connected: false });
  });

  // Grok Bot usage is read from this Mac, so it follows the workspace session.
  app.get('/api/grok-bot', async (req, res) => {
    if (!req.workspaceAuthenticated)
      return res
        .status(401)
        .json({ error: 'Reload AccountDeck to open a workspace session.' });
    res.json(await grokBot());
  });
  app.get('/api/cursor', required, async (req, res) =>
    res.json(await cursor.status()),
  );
  app.post('/api/cursor', required, async (req, res) =>
    res.json(await cursor.connect(req.body?.sessionToken)),
  );
  app.post('/api/cursor/refresh', required, async (req, res) =>
    res.json(await cursor.status(true)),
  );
  app.delete('/api/cursor', required, async (req, res) =>
    res.json(await cursor.disconnect()),
  );

  async function nativeAccountsFor(session) {
    if (
      nativeStatusFile &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(
        new URL(session.baseUrl).hostname,
      )
    ) {
      try {
        const accounts = JSON.parse(
          await readFile(nativeStatusFile, 'utf8'),
        ).accounts;
        if (Array.isArray(accounts)) return accounts;
      } catch {
        /* Native metadata is optional; proxy accounts still load. */
      }
    }
    return [];
  }
  app.get('/api/snapshot', required, async (req, res) => {
    const [files, config, nativeAccounts] = await Promise.all([
      credentials(req.session),
      upstream(req.session, 'config'),
      nativeAccountsFor(req.session),
    ]);
    const routing = config.routing || {};
    res.json({
      baseUrl: req.session.baseUrl,
      accounts: files.map((file) => {
        const account = safeAccount(file);
        const native = nativeAccounts.find(
          (item) =>
            item.name === account.name && item.provider === account.provider,
        );
        const plan = account.plan || native?.plan || null;
        const quota = req.session.quotas.get(account.id) || null;
        return {
          ...account,
          nativeSource: native?.source || null,
          plan,
          ...(account.provider === 'claude'
            ? { creditModels: claudeCreditModels(quota?.plan || plan) }
            : {}),
          quota,
        };
      }),
      routing: {
        strategy: routing.strategy || 'round-robin',
        affinity: !!routing['session-affinity'],
        ttl: routing['session-affinity-ttl'] || '1h',
      },
      expiry: expiry.status(req.session),
    });
  });
  async function fetchQuota(session, file, onRateLimit) {
    const provider = safeAccount(file).provider;
    if (!['claude', 'codex', 'xai'].includes(provider))
      throw Object.assign(
        new Error(
          `Live quota inspection for ${provider} is not supported in this version.`,
        ),
        { status: 422 },
      );
    if (!file.auth_index)
      throw Object.assign(
        new Error('This credential has no auth index for quota inspection.'),
        { status: 422 },
      );
    const header = {
      Authorization: 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
    };
    if (provider === 'claude') {
      header['anthropic-beta'] = 'oauth-2025-04-20';
      header['User-Agent'] = 'claude-cli/2.1.280 (external, cli)';
    }
    if (provider === 'codex') {
      header['User-Agent'] = 'codex-tui/0.149.1';
      const accountId =
        file.id_token?.chatgpt_account_id ||
        file.id_token?.['https://api.openai.com/auth']?.chatgpt_account_id;
      if (accountId) header['Chatgpt-Account-Id'] = accountId;
    }
    const result = await upstream(session, 'requests/api-call', 'POST', {
      auth_index: file.auth_index,
      method: 'GET',
      url:
        provider === 'claude'
          ? 'https://api.anthropic.com/api/oauth/usage'
          : provider === 'codex'
            ? 'https://chatgpt.com/backend-api/wham/usage'
            : 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
      header,
    });
    if (result.status_code === 429) {
      throw onRateLimit(result.header);
    }
    if (
      !Number.isInteger(result.status_code) ||
      result.status_code < 200 ||
      result.status_code >= 300
    )
      throw new Error(
        result.status_code === 401
          ? 'Provider quota authentication was rejected (HTTP 401). Reauthenticate the account.'
          : result.status_code === 403
            ? 'Provider quota access was denied (HTTP 403). Check this account access.'
            : `Provider quota inspection is unavailable (HTTP ${result.status_code}). Try again later.`,
      );
    const payload =
      typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
    if (!payload || typeof payload !== 'object')
      throw new Error('The provider returned an invalid quota response.');
    const account = safeAccount(file);
    const native =
      provider === 'claude' && !account.plan
        ? (await nativeAccountsFor(session)).find(
            (item) => item.name === account.name && item.provider === provider,
          )
        : null;
    const quota = normalizeQuota(
      provider,
      payload,
      now(),
      account.plan || native?.plan || null,
    );
    for (const connected of sessions.values()) {
      if (connected.baseUrl === session.baseUrl)
        connected.quotas.set(safeAccount(file).id, quota);
    }
    return quota;
  }
  function rateLimitError(provider, retryAt) {
    const seconds = Math.max(1, Math.ceil((retryAt - now()) / 1000));
    const wait =
      seconds < 60
        ? `${seconds} seconds`
        : `${Math.ceil(seconds / 60)} minutes`;
    return Object.assign(
      new Error(
        `${provider === 'claude' ? 'Claude' : provider} quota checks are rate-limited (HTTP 429). Retry in about ${wait}. Existing usage is retained.`,
      ),
      { status: 429, retryAfterSeconds: seconds },
    );
  }
  function quotaBackoff(header, failures) {
    const entry = Object.entries(header || {}).find(
      ([key]) => key.toLowerCase() === 'retry-after',
    );
    const raw = Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1];
    if (typeof raw === 'string' || typeof raw === 'number') {
      const seconds = /^\d+(?:\.\d+)?$/.test(String(raw).trim())
        ? Number(raw)
        : null;
      const delay = seconds === null ? Date.parse(raw) - now() : seconds * 1000;
      if (Number.isFinite(delay) && delay >= 0 && now() + delay <= 8.64e15)
        return Math.max(1000, delay);
    }
    return Math.min(3600000, 300000 * 2 ** Math.min(failures - 1, 4));
  }
  async function readQuota(session, file) {
    const account = safeAccount(file);
    const key = JSON.stringify([session.baseUrl, account.provider, account.id]);
    let read = quotaReads.get(key);
    if (!read) {
      read = { retryAt: 0, failures: 0, pending: null };
      quotaReads.set(key, read);
    }
    if (read.retryAt > now())
      throw rateLimitError(account.provider, read.retryAt);
    if (read.pending) return read.pending;
    read.pending = fetchQuota(session, file, (header) => {
      read.failures++;
      read.retryAt = now() + quotaBackoff(header, read.failures);
      const error = rateLimitError(account.provider, read.retryAt);
      for (const connected of sessions.values()) {
        if (connected.baseUrl !== session.baseUrl) continue;
        const previous = connected.quotas.get(account.id);
        if (previous)
          connected.quotas.set(account.id, {
            ...previous,
            error: error.message,
          });
      }
      return error;
    })
      .then((quota) => {
        read.retryAt = 0;
        read.failures = 0;
        return quota;
      })
      .finally(() => {
        read.pending = null;
      });
    return read.pending;
  }
  const expiry = createExpiryRouter({
    credentials,
    readQuota,
    upstream,
    sessions,
    now,
    stateFile: expiryStateFile,
  });
  app.locals.expiry = expiry;
  async function initializeConfiguredConnection() {
    if (!configured) return null;
    if (configuredSession) return configuredSession;
    if (!initialization) {
      initialization = (async () => {
        const session = makeSession(configured);
        await upstream(session, 'config');
        await credentials(session);
        // Keep the configured proxy active independently of browser-session TTLs.
        session.expires = Infinity;
        sessions.set(configuredId, session);
        try {
          await expiry.setEnabled(session, configured.autoPrioritize !== false);
          configuredSession = session;
          return session;
        } catch (error) {
          sessions.delete(configuredId);
          throw error;
        }
      })().catch((error) => {
        initialization = null;
        throw error;
      });
    }
    return initialization;
  }
  app.locals.maintain = async () => {
    const initialized = !!configuredSession;
    await initializeConfiguredConnection();
    if (!configured || initialized) await expiry.tick();
  };
  app.locals.initializeConfiguredConnection = initializeConfiguredConnection;
  app.get('/api/expiry', required, (req, res) =>
    res.json(expiry.status(req.session)),
  );
  app.put('/api/expiry', required, async (req, res) => {
    if (typeof req.body.enabled !== 'boolean')
      return res.status(400).json({ error: 'Provide an enabled flag.' });
    res.json(
      await expiry.setEnabled(
        req.session,
        req.body.enabled,
        configured && req.session.baseUrl === configured.baseUrl
          ? persistDefaultAutomation
          : undefined,
      ),
    );
  });
  app.post('/api/accounts/:id/quota', required, async (req, res) => {
    const file = await findAccount(req.session, req.params.id);
    if (file.disabled)
      return res
        .status(400)
        .json({ error: 'Resume this account before refreshing its quota.' });
    res.json(await readQuota(req.session, file));
  });
  app.patch('/api/accounts/:id', required, async (req, res) => {
    const file = await findAccount(req.session, req.params.id);
    if (typeof req.body.disabled === 'boolean') {
      await expiry.mutate(
        req.session,
        file,
        { disabled: req.body.disabled },
        () =>
          upstream(req.session, 'credentials/status', 'PATCH', {
            name: file.name || file.id,
            disabled: req.body.disabled,
          }),
      );
    } else if (
      Number.isInteger(req.body.priority) &&
      req.body.priority >= -100 &&
      req.body.priority <= 100
    ) {
      await expiry.mutate(
        req.session,
        file,
        { priority: req.body.priority },
        () =>
          upstream(req.session, 'credentials/fields', 'PATCH', {
            name: file.name || file.id,
            priority: req.body.priority,
          }),
      );
    } else
      return res.status(400).json({
        error:
          'Provide a disabled flag or an integer priority between -100 and 100.',
      });
    res.json({ ok: true });
  });
  app.put('/api/routing', required, async (req, res) => {
    const { strategy, affinity } = req.body;
    if (
      !['round-robin', 'fill-first', 'weighted-round-robin'].includes(
        strategy,
      ) ||
      typeof affinity !== 'boolean'
    )
      return res.status(400).json({ error: 'Invalid routing settings.' });
    await upstream(req.session, 'config/routing', 'PATCH', {
      strategy,
      'session-affinity': affinity,
    });
    res.json({ ok: true });
  });
  app.get('/api/models', required, async (req, res) => {
    const file = await findAccount(
      req.session,
      String(req.query.account || ''),
    );
    const result = await upstream(
      req.session,
      `credentials/models?name=${encodeURIComponent(file.name || file.id)}`,
    );
    res.json({
      models: (result.models || [])
        .map((model) => ({
          id: model.id || model.name,
          name: model.display_name || model.name || model.id,
        }))
        .filter((model) => model.id),
    });
  });
  app.post('/api/oauth', required, async (req, res) => {
    if (!providers.has(req.body.provider))
      return res.status(400).json({ error: 'Choose a supported provider.' });
    const result = await upstream(
      req.session,
      `oauth/auth-url?provider=${req.body.provider}&is_webui=true`,
    );
    if (
      typeof result.url !== 'string' ||
      !['https:', 'http:'].includes(new URL(result.url).protocol) ||
      !result.state
    )
      throw new Error('The proxy returned an invalid OAuth login URL.');
    req.session.oauth.set(result.state, req.body.provider);
    res.json({
      url: result.url,
      state: result.state,
      userCode: result.user_code || null,
    });
  });
  app.get('/api/oauth/:state', required, async (req, res) => {
    if (!req.session.oauth.has(req.params.state))
      return res.status(404).json({ error: 'Login session not found.' });
    const result = await upstream(
      req.session,
      `oauth/status?state=${encodeURIComponent(req.params.state)}`,
    );
    res.json(result);
  });
  app.post('/api/oauth/:state/callback', required, async (req, res) => {
    const provider = req.session.oauth.get(req.params.state);
    if (!provider || typeof req.body.redirectUrl !== 'string')
      return res
        .status(400)
        .json({ error: 'Invalid login session or callback URL.' });
    let callback;
    try {
      callback = new URL(req.body.redirectUrl);
    } catch {
      return res.status(400).json({ error: 'Paste the full callback URL.' });
    }
    if (
      callback.searchParams.get('state') !== req.params.state ||
      !callback.searchParams.get('code')
    )
      return res
        .status(400)
        .json({ error: 'The callback URL does not match this login session.' });
    await upstream(req.session, 'oauth/callback', 'POST', {
      provider,
      state: req.params.state,
      redirect_url: req.body.redirectUrl,
    });
    res.json({ ok: true });
  });
  app.delete('/api/oauth/:state', required, async (req, res) => {
    if (req.session.oauth.has(req.params.state))
      await upstream(
        req.session,
        `oauth/session?state=${encodeURIComponent(req.params.state)}`,
        'DELETE',
      );
    req.session.oauth.delete(req.params.state);
    res.json({ ok: true });
  });
  app.use('/api', (req, res) =>
    res.status(404).json({ error: 'Unknown console endpoint.' }),
  );
  if (serveStatic) {
    app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
    app.get('/{*path}', (req, res) =>
      res.sendFile(
        fileURLToPath(new URL('../dist/index.html', import.meta.url)),
      ),
    );
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.retryAfterSeconds)
      res.set('Retry-After', String(error.retryAfterSeconds));
    const message =
      error.name === 'TimeoutError'
        ? 'The proxy did not respond within 20 seconds.'
        : error.message === 'fetch failed'
          ? 'Could not reach the proxy. Check that CLIProxyAPI is running and the URL is reachable.'
          : error.message;
    res
      .status(
        error.status && error.status >= 400 && error.status < 600
          ? error.status
          : 502,
      )
      .json({ error: message || 'Proxy request failed.' });
  });
  return app;
}
