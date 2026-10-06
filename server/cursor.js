import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const number = (value) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);

export function normalizeCursorUsage(payload, now = Date.now()) {
  if (
    !object(payload) ||
    (!object(payload.individualUsage) &&
      !object(payload.teamUsage) &&
      payload.isUnlimited !== true)
  )
    throw new Error('Cursor returned an unsupported usage summary.');
  const resetsAt = Number.isFinite(Date.parse(payload.billingCycleEnd))
    ? new Date(payload.billingCycleEnd).toISOString()
    : null;
  const windows = [];
  const add = (id, label, bucket, percentKey) => {
    if (!object(bucket) || bucket.enabled === false) return;
    const used = number(bucket.used);
    const limit = number(bucket.limit);
    const reported = number(bucket.remaining);
    const percent = percentKey ? number(bucket[percentKey]) : null;
    const remaining =
      percent !== null
        ? Math.max(0, 100 - Math.min(100, percent))
        : limit > 0 && (used !== null || reported !== null)
          ? Math.max(
              0,
              Math.min(100, ((reported ?? limit - used) * 100) / limit),
            )
          : null;
    windows.push({
      id,
      label,
      remaining,
      resetsAt,
      periodHours: 720,
      // Percentage rails can represent different pools. Don't infer dollar budgets from them.
      usedUsd: percentKey ? null : used === null ? null : used / 100,
      limitUsd: percentKey ? null : limit === null ? null : limit / 100,
    });
  };
  const individual = payload.individualUsage || {};
  const plan = individual.plan;
  if (
    object(plan) &&
    plan.enabled !== false &&
    (number(plan.autoPercentUsed) !== null ||
      number(plan.apiPercentUsed) !== null)
  ) {
    if (number(plan.autoPercentUsed) !== null)
      add('cursor-models', 'Cursor Models', plan, 'autoPercentUsed');
    if (number(plan.apiPercentUsed) !== null)
      add('other-models', 'Other Models', plan, 'apiPercentUsed');
  } else if (
    object(individual.overall) &&
    individual.overall.enabled !== false
  ) {
    add('personal', 'Individual spending limit', individual.overall);
  } else {
    add(
      'plan',
      'Included usage',
      plan,
      number(plan?.totalPercentUsed) === null ? undefined : 'totalPercentUsed',
    );
  }
  add('on-demand', 'On-demand usage', individual.onDemand);
  add('team', 'Pooled team usage', payload.teamUsage?.onDemand);
  add('team-plan', 'Team included usage', payload.teamUsage?.plan);
  return {
    connected: true,
    plan:
      typeof payload.membershipType === 'string'
        ? payload.membershipType.slice(0, 80)
        : null,
    unlimited: payload.isUnlimited === true,
    windows,
    updatedAt: new Date(now).toISOString(),
    error: null,
  };
}

export function createCursorTracker({
  stateFile,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let token;
  let loaded = false;
  let cache = null;
  let lastAttempt = -Infinity;
  let queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  async function load() {
    if (loaded) return;
    if (stateFile) {
      try {
        token = validate(
          JSON.parse(await readFile(stateFile, 'utf8')).sessionToken,
        );
      } catch (error) {
        if (error.code !== 'ENOENT')
          throw new Error('Could not read the saved Cursor connection.');
      }
    }
    loaded = true;
  }
  function validate(value) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 16384 ||
      /[\s;\x00-\x20\x7f-\uffff]/.test(value)
    ) {
      const error = new Error(
        'Paste only the value of the WorkosCursorSessionToken cookie.',
      );
      error.status = 400;
      throw error;
    }
    return value;
  }
  async function inspect(value) {
    let response;
    try {
      response = await fetchImpl('https://cursor.com/api/usage-summary', {
        headers: {
          Cookie: `WorkosCursorSessionToken=${value}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('Could not reach Cursor. Try refreshing again.');
    }
    if (response.status === 401 || response.status === 403)
      throw new Error(
        'Cursor session expired or was rejected. Reconnect with a fresh dashboard session.',
      );
    if (!response.ok)
      throw new Error(`Cursor usage request returned HTTP ${response.status}.`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Cursor returned an invalid usage summary.');
    }
    return normalizeCursorUsage(payload, now());
  }
  async function persist(value) {
    if (!stateFile) return;
    let temporary;
    try {
      if (!value) {
        await unlink(stateFile).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        return;
      }
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
      temporary = `${stateFile}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify({ sessionToken: value }), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, stateFile);
    } catch {
      throw new Error('Could not save the Cursor connection.');
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  async function status(force = false) {
    await load();
    if (!token) return { connected: false, windows: [], error: null };
    if (!force && cache && now() - lastAttempt < 60000) return cache;
    lastAttempt = now();
    try {
      cache = await inspect(token);
    } catch (error) {
      cache = {
        ...(cache || { connected: true, windows: [], updatedAt: null }),
        error: error.message,
      };
      return cache;
    }
    return cache;
  }
  return {
    status: (force = false) => serial(() => status(force)),
    connect: (value) =>
      serial(async () => {
        const valid = validate(value);
        const usage = await inspect(valid);
        await persist(valid);
        loaded = true;
        token = valid;
        cache = usage;
        lastAttempt = now();
        return usage;
      }),
    disconnect: () =>
      serial(async () => {
        await persist(null);
        loaded = true;
        token = undefined;
        cache = null;
        return { connected: false, windows: [], error: null };
      }),
  };
}
