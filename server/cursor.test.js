import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeCursorUsage, createCursorTracker } from './cursor.js';

const enterprise = {
  membershipType: 'enterprise',
  billingCycleEnd: '2026-11-01T00:00:00Z',
  individualUsage: {
    overall: { enabled: true, used: 1200, limit: 4000, remaining: 2800 },
    onDemand: { enabled: true, used: 2309, limit: null, remaining: null },
  },
  teamUsage: { onDemand: { enabled: true, used: 45000, limit: 100000 } },
};

test('Cursor Enterprise preserves personal, unbounded on-demand, and pooled team spending separately', () => {
  const usage = normalizeCursorUsage(enterprise);
  assert.equal(usage.plan, 'enterprise');
  assert.equal(usage.unlimited, false);
  assert.deepEqual(
    usage.windows.map((w) => [w.id, w.remaining, w.usedUsd, w.limitUsd]),
    [
      ['personal', 70, 12, 40],
      ['on-demand', null, 23.09, null],
      ['team', 55, 450, 1000],
    ],
  );
  assert.ok(
    usage.windows.every((w) => w.resetsAt === '2026-11-01T00:00:00.000Z'),
  );
});

test('Cursor model pools use reported percentages without inventing pool dollar budgets', () => {
  const usage = normalizeCursorUsage({
    individualUsage: {
      plan: {
        used: 2000,
        limit: 2000,
        totalPercentUsed: 100,
        autoPercentUsed: 12,
        apiPercentUsed: 76,
      },
    },
  });
  assert.deepEqual(
    usage.windows.map((w) => [w.label, w.remaining, w.limitUsd]),
    [
      ['Cursor Models', 88, null],
      ['Other Models', 24, null],
    ],
  );
});

test('missing enterprise limits stay unknown, zero is preserved, and disabled buckets are skipped', () => {
  const usage = normalizeCursorUsage({
    individualUsage: {
      plan: { enabled: false, used: 0, limit: 100 },
      onDemand: { used: 0, limit: null },
    },
    teamUsage: { onDemand: { used: null, limit: null } },
  });
  assert.equal(usage.windows[0].usedUsd, 0);
  assert.ok(usage.windows.every((w) => w.remaining === null));
  assert.equal(usage.unlimited, false);
  const unlimited = normalizeCursorUsage({ isUnlimited: true });
  assert.equal(unlimited.unlimited, true);
  assert.deepEqual(unlimited.windows, []);
  assert.throws(
    () => normalizeCursorUsage({ error: 'sensitive upstream details' }),
    /unsupported usage/,
  );
});

test('Cursor connection survives restart with a private file and never returns its session or raw payload', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cliproxy-cursor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'cursor.json');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    return Response.json({
      ...enterprise,
      access_token: 'do-not-return',
      metadata: { private: true },
    });
  };
  const tracker = createCursorTracker({ stateFile, fetchImpl });
  const result = await tracker.connect('user_123%3A%3Asession-secret');
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
  assert.equal(
    JSON.parse(await readFile(stateFile, 'utf8')).sessionToken,
    'user_123%3A%3Asession-secret',
  );
  assert.equal(calls[0][0], 'https://cursor.com/api/usage-summary');
  assert.equal(
    calls[0][1].headers.Cookie,
    'WorkosCursorSessionToken=user_123%3A%3Asession-secret',
  );
  assert.equal(calls[0][1].redirect, 'error');
  assert.doesNotMatch(
    JSON.stringify(result),
    /session-secret|do-not-return|metadata/,
  );
  await tracker.status();
  assert.equal(calls.length, 1);
  assert.equal(
    (await createCursorTracker({ stateFile, fetchImpl }).status()).plan,
    'enterprise',
  );
  await tracker.disconnect();
  assert.equal(
    (await createCursorTracker({ stateFile, fetchImpl }).status()).connected,
    false,
  );
});

test('failed refresh retains dated usage, failed reconnection retains old login, and upstream details stay private', async () => {
  let fail = false;
  const tokens = [];
  const tracker = createCursorTracker({
    fetchImpl: async (url, options) => {
      tokens.push(options.headers.Cookie);
      return fail
        ? new Response('sensitive-token-from-upstream', { status: 401 })
        : Response.json(enterprise);
    },
  });
  const original = await tracker.connect('original-session');
  fail = true;
  const result = await tracker.status(true);
  assert.equal(result.updatedAt, original.updatedAt);
  assert.deepEqual(result.windows, original.windows);
  assert.match(result.error, /session expired/);
  assert.doesNotMatch(result.error, /sensitive-token/);
  await assert.rejects(tracker.connect('bad-session'), /session expired/);
  fail = false;
  await tracker.status(true);
  assert.equal(tokens.at(-1), 'WorkosCursorSessionToken=original-session');
  await assert.rejects(tracker.connect('value; injected=header'), /Paste only/);
  await assert.rejects(tracker.connect('value\nHeader: value'), /Paste only/);
});
