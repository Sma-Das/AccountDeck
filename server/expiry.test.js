import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createExpiryRouter,
  expiringWindow,
  EXPIRY_LEAD_MS,
} from './expiry.js';

test('expiry eligibility rejects missing, unknown, stale-reset, and exhausted quota', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const window = {
    id: 'five_hour',
    remaining: 20,
    resetsAt: new Date(now + EXPIRY_LEAD_MS).toISOString(),
  };
  const quota = { windows: [window] };
  assert.equal(expiringWindow(quota, now), window);
  assert.equal(expiringWindow({ ...quota, error: 'Failed' }, now), null);
  for (const remaining of [null, 0])
    assert.equal(
      expiringWindow({ windows: [{ ...window, remaining }] }, now),
      null,
    );
  for (const resetsAt of [
    null,
    'invalid',
    new Date(now).toISOString(),
    new Date(now + EXPIRY_LEAD_MS + 1).toISOString(),
  ])
    assert.equal(
      expiringWindow({ windows: [{ ...window, resetsAt }] }, now),
      null,
    );
  assert.equal(expiringWindow(null, now), null);
});

test('reconnect restores journaled boosts after a restart without persisting keys', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cliproxy-expiry-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'priorities.json');
  const clock = Date.now();
  const session = {
    baseUrl: 'http://proxy.local',
    key: 'management-secret',
    expires: clock + 3600000,
  };
  const files = [
    { auth_index: 'c1', name: 'claude.json', provider: 'claude', priority: 10 },
  ];
  const options = {
    stateFile,
    sessions: new Map([['session', session]]),
    now: () => clock,
    credentials: async () => files.map((file) => ({ ...file })),
    readQuota: async () => ({
      windows: [
        {
          id: 'five_hour',
          remaining: 50,
          resetsAt: new Date(clock + 600000).toISOString(),
        },
      ],
    }),
    upstream: async (_, path, method, body) => {
      files[0].priority = body.priority;
    },
  };
  const before = createExpiryRouter(options);
  await before.setEnabled(session, true);
  assert.equal(files[0].priority, 11);
  assert.ok(!readFileSync(stateFile, 'utf8').includes('management-secret'));
  const after = createExpiryRouter(options);
  after.status(session);
  await after.tick();
  assert.equal(files[0].priority, 10);
  assert.equal(after.status(session).enabled, false);
  assert.equal(after.status(session).boosted.length, 0);
});

test('multiple browser sessions share one worker and the last disconnect restores it', async () => {
  const clock = Date.now();
  const first = { baseUrl: 'http://proxy.local', expires: clock + 3600000 };
  const second = { ...first };
  const sessions = new Map([
    ['first', first],
    ['second', second],
  ]);
  const file = {
    auth_index: 'c1',
    name: 'claude.json',
    provider: 'claude',
    priority: 0,
  };
  const worker = createExpiryRouter({
    sessions,
    now: () => clock,
    credentials: async () => [{ ...file }],
    readQuota: async () => ({
      windows: [
        {
          id: 'five_hour',
          remaining: 50,
          resetsAt: new Date(clock + 600000).toISOString(),
        },
      ],
    }),
    upstream: async (_, path, method, body) => {
      file.priority = body.priority;
    },
  });
  await worker.setEnabled(first, true);
  sessions.delete('first');
  await worker.tick();
  assert.equal(file.priority, 1);
  assert.equal(worker.status(second).enabled, true);
  sessions.delete('second');
  await worker.tick();
  assert.equal(file.priority, 0);
});

test('a reset reached while fetching quota does not create a late boost', async () => {
  let clock = Date.now();
  const resetsAt = new Date(clock + 60000).toISOString();
  const session = { baseUrl: 'http://proxy.local', expires: clock + 3600000 };
  let writes = 0;
  const worker = createExpiryRouter({
    sessions: new Map([['session', session]]),
    now: () => clock,
    credentials: async () => [
      {
        auth_index: 'c1',
        name: 'claude.json',
        provider: 'claude',
        priority: 0,
      },
    ],
    readQuota: async () => {
      clock += 60000;
      return { windows: [{ id: 'five_hour', remaining: 50, resetsAt }] };
    },
    upstream: async () => {
      writes++;
    },
  });
  await worker.setEnabled(session, true);
  assert.equal(writes, 0);
});

test('a Pro legacy Fable field cannot trigger subscription quota prioritization', async () => {
  const { normalizeQuota } = await import('./quota.js');
  const now = Date.parse('2026-10-06T20:00:00Z');
  const quota = normalizeQuota(
    'claude',
    {
      seven_day: {
        utilization: 14,
        resets_at: new Date(now + 86400000).toISOString(),
      },
      iguana_necktie: {
        utilization: 0,
        resets_at: new Date(now + 600000).toISOString(),
      },
    },
    now,
    'pro',
  );
  assert.equal(expiringWindow(quota, now), null);
});
