import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { safeAccount } from './quota.js';

export const EXPIRY_LEAD_MS = 15 * 60 * 1000;

export function expiringWindow(quota, now) {
  if (!quota || quota.error) return null;
  // A spent account-wide limit prevents using the other windows too.
  const globalIds = new Set([
    'five_hour',
    'seven_day',
    'primary_window',
    'secondary_window',
  ]);
  if (
    quota.windows.some(
      (window) => globalIds.has(window.id) && window.remaining === 0,
    )
  )
    return null;
  return (
    quota.windows
      .filter(
        (window) =>
          window.remaining > 0 &&
          Date.parse(window.resetsAt) > now &&
          Date.parse(window.resetsAt) - now <= EXPIRY_LEAD_MS,
      )
      .sort((a, b) => Date.parse(a.resetsAt) - Date.parse(b.resetsAt))[0] ||
    null
  );
}

// One worker per proxy, shared by all browser sessions. Keys remain in memory.
export function createExpiryRouter({
  credentials,
  readQuota,
  upstream,
  sessions,
  now = Date.now,
  stateFile,
}) {
  const workers = new Map();
  if (stateFile && existsSync(stateFile)) {
    for (const [baseUrl, boosts] of JSON.parse(
      readFileSync(stateFile, 'utf8'),
    )) {
      workers.set(baseUrl, {
        enabled: false,
        boosts: new Map(boosts),
        suppressed: new Map(),
        error: null,
        checkedAt: null,
        pending: Promise.resolve(),
      });
    }
  }
  function persist() {
    if (!stateFile) return;
    mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
    writeFileSync(
      `${stateFile}.tmp`,
      JSON.stringify(
        [...workers]
          .filter(([, worker]) => worker.boosts.size)
          .map(([url, worker]) => [url, [...worker.boosts]]),
      ),
      { mode: 0o600 },
    );
    renameSync(`${stateFile}.tmp`, stateFile);
  }
  function workerFor(session) {
    if (!workers.has(session.baseUrl))
      workers.set(session.baseUrl, {
        enabled: false,
        boosts: new Map(),
        suppressed: new Map(),
        error: null,
        checkedAt: null,
        pending: Promise.resolve(),
      });
    const worker = workers.get(session.baseUrl);
    worker.session = session;
    return worker;
  }
  function lock(worker, action) {
    const result = worker.pending.then(action);
    worker.pending = result.catch(() => {});
    return result;
  }
  function status(session) {
    const worker = workerFor(session);
    return {
      enabled: worker.enabled,
      checkedAt: worker.checkedAt,
      error: worker.error,
      boosted: [...worker.boosts].map(([id, boost]) => ({
        id,
        originalPriority: boost.originalPriority,
        resetsAt: boost.resetsAt,
      })),
    };
  }
  async function patch(session, file, priority) {
    await upstream(session, 'credentials/fields', 'PATCH', {
      name: file.name || file.id,
      priority,
    });
    file.priority = priority;
  }
  async function restore(worker, files, id) {
    const boost = worker.boosts.get(id);
    const file = files.find(
      (file) =>
        safeAccount(file).id === id && (file.name || file.id) === boost.name,
    );
    // Preserve edits made outside the console. A missing account needs no restore.
    if (
      file &&
      [boost.priority, boost.previousPriority].includes(
        safeAccount(file).priority,
      )
    )
      await patch(worker.session, file, boost.originalPriority);
    worker.boosts.delete(id);
    persist();
  }
  async function check(worker) {
    const session = worker.session;
    const files = await credentials(session);
    for (const [id, boost] of [...worker.boosts]) {
      if (!worker.enabled || Date.parse(boost.resetsAt) <= now())
        await restore(worker, files, id);
    }
    const candidates = [];
    const errors = [];
    if (worker.enabled) {
      const eligible = files.filter((file) => {
        const account = safeAccount(file);
        return (
          !account.disabled &&
          !account.unavailable &&
          file.auth_index &&
          ['claude', 'codex', 'xai'].includes(account.provider)
        );
      });
      const inspect = async (file) => {
        const account = safeAccount(file);
        try {
          const quota = await readQuota(session, file);
          const window = expiringWindow(quota, now());
          if (window && (worker.suppressed.get(account.id) || 0) <= now())
            candidates.push({ file, account, window });
        } catch (error) {
          errors.push(`${account.provider}: ${error.message}`);
        }
      };
      for (let index = 0; index < eligible.length; index += 3) {
        await Promise.all(eligible.slice(index, index + 3).map(inspect));
      }
    }
    // Revalidate after I/O so a reset reached during polling cannot be boosted.
    const due = candidates.filter(
      ({ window }) => Date.parse(window.resetsAt) > now(),
    );
    for (const id of [...worker.boosts.keys()]) {
      const candidate = due.find(({ account }) => account.id === id);
      const file = files.find((file) => safeAccount(file).id === id);
      const boost = worker.boosts.get(id);
      if (
        !candidate ||
        !file ||
        ![boost.priority, boost.previousPriority].includes(
          safeAccount(file).priority,
        ) ||
        (file.name || file.id) !== boost.name
      ) {
        // An external edit wins for this poll; do not immediately overwrite it.
        const index = due.findIndex(({ account }) => account.id === id);
        if (index >= 0) due.splice(index, 1);
        if (
          file &&
          ![boost.priority, boost.previousPriority].includes(
            safeAccount(file).priority,
          )
        )
          worker.suppressed.set(id, Date.parse(boost.resetsAt));
        await restore(worker, files, id);
      }
    }
    due.sort(
      (a, b) => Date.parse(b.window.resetsAt) - Date.parse(a.window.resetsAt),
    );
    const highest = new Map();
    for (const file of files) {
      const account = safeAccount(file);
      const priority =
        worker.boosts.get(account.id)?.originalPriority ?? account.priority;
      highest.set(
        account.provider,
        Math.max(highest.get(account.provider) ?? 0, priority),
      );
    }
    for (const { file, account, window } of due) {
      const priority = highest.get(account.provider) + 1;
      highest.set(account.provider, priority);
      let boost = worker.boosts.get(account.id);
      if (!boost) {
        boost = {
          name: file.name || file.id,
          originalPriority: account.priority,
          priority,
          resetsAt: window.resetsAt,
        };
        worker.boosts.set(account.id, boost);
        // Journal before changing the proxy so an interrupted request is recoverable.
        persist();
      }
      if (safeAccount(file).priority !== priority) {
        boost.previousPriority = safeAccount(file).priority;
        boost.priority = priority;
        persist();
        await patch(session, file, priority);
        delete boost.previousPriority;
      }
      boost.resetsAt = window.resetsAt;
      persist();
    }
    worker.checkedAt = new Date(now()).toISOString();
    worker.error = errors.join('\n') || null;
  }
  async function run(worker) {
    try {
      await check(worker);
    } catch (error) {
      worker.error = error.message;
      throw error;
    }
  }
  return {
    status,
    async setEnabled(session, enabled, persistEnabled) {
      const worker = workerFor(session);
      return lock(worker, async () => {
        await persistEnabled?.(enabled);
        worker.suppressed.clear();
        worker.enabled = enabled;
        await run(worker);
        return status(session);
      });
    },
    async mutate(session, file, changes, action) {
      const worker = workerFor(session);
      return lock(worker, async () => {
        const id = safeAccount(file).id;
        const boost = worker.boosts.get(id);
        if (boost && changes.priority !== undefined) {
          boost.originalPriority = changes.priority;
          persist();
        } else {
          if (boost && changes.disabled)
            await restore(worker, await credentials(session), id);
          await action();
        }
      });
    },
    async tick() {
      await Promise.all(
        [...workers].map(async ([url, worker]) => {
          if (worker.polling) return;
          worker.polling = true;
          try {
            await lock(worker, async () => {
              const live = [...sessions.values()].find(
                (session) =>
                  session.baseUrl === worker.session?.baseUrl &&
                  session.expires > now(),
              );
              if (live) worker.session = live;
              else worker.enabled = false;
              if (worker.session && (worker.enabled || worker.boosts.size))
                await run(worker);
              if (!live && !worker.boosts.size && worker.session)
                workers.delete(url);
            });
          } catch {
            // Keep the journal and credentials until restoration can be retried.
          } finally {
            worker.polling = false;
          }
        }),
      );
    },
    async close() {
      await Promise.all(
        [...workers.values()].map((worker) =>
          lock(worker, async () => {
            worker.enabled = false;
            if (worker.session && worker.boosts.size) await run(worker);
          }),
        ),
      );
    },
  };
}
