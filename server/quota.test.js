import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuota, resetTime, safeAccount } from './quota.js';

test('Claude utilization is converted to remaining quota, including zero and null', () => {
  const result = normalizeQuota('claude', {
    five_hour: { utilization: 0, resets_at: null },
    seven_day: { utilization: 100, resets_at: '2026-10-04T10:00:00Z' },
    seven_day_sonnet: { utilization: null },
  });
  assert.deepEqual(
    result.windows.map((w) => w.remaining),
    [100, 0, null],
  );
  assert.equal(result.windows[0].resetsAt, null);
  assert.equal(result.windows[1].periodHours, 168);
});

test('Claude named and scoped model limits preserve their model names', () => {
  const result = normalizeQuota('claude', {
    iguana_necktie: { utilization: 42 },
    limits: [
      {
        kind: 'weekly_scoped',
        is_active: true,
        scope: { model: { display_name: 'Fable' } },
        percent: 42,
      },
      {
        kind: 'weekly_scoped',
        is_active: true,
        scope: { model: { display_name: 'New model' } },
        percent: 25,
      },
      { kind: 'weekly_scoped', is_active: false, percent: 25 },
    ],
  });
  assert.deepEqual(
    result.windows.map((w) => w.label),
    ['7-day Fable', '7-day New model'],
  );
  assert.equal(result.windows[0].remaining, 58);
});

test('Codex windows are classified by duration even when primary and secondary are swapped', () => {
  const result = normalizeQuota(
    'codex',
    {
      plan_type: 'pro',
      rate_limit: {
        primary_window: {
          used_percent: 91,
          limit_window_seconds: 604800,
          reset_at: 1791108000,
        },
        secondary_window: {
          used_percent: 0,
          limit_window_seconds: 18000,
          reset_after_seconds: 600,
        },
      },
    },
    1791000000000,
  );
  assert.deepEqual(
    result.windows.map((w) => w.label),
    ['7-day limit', '5-hour limit'],
  );
  assert.deepEqual(
    result.windows.map((w) => w.remaining),
    [9, 100],
  );
  assert.equal(
    result.windows[1].resetsAt,
    new Date(1791000600000).toISOString(),
  );
  assert.equal(result.plan, 'pro');
});

test('Codex supports monthly windows and absent utilization without inventing quota', () => {
  const result = normalizeQuota('codex', {
    rateLimit: {
      primaryWindow: { usedPercent: '' },
      secondaryWindow: { usedPercent: 33, limitWindowSeconds: 2592000 },
    },
  });
  assert.equal(result.windows[0].remaining, null);
  assert.equal(result.windows[1].label, 'Monthly limit');
  assert.equal(result.windows[1].remaining, 67);
  assert.ok(normalizeQuota('codex', {}).error);
});

test('reset timestamps accept epoch seconds, milliseconds, ISO, and missing values', () => {
  const expected = '2026-10-04T10:00:00.000Z';
  const ms = Date.parse(expected);
  for (const value of [ms / 1000, ms, expected])
    assert.equal(resetTime(value), expected);
  assert.equal(resetTime(null), null);
  assert.equal(resetTime('invalid'), null);
});

test('Grok billing percentages and weekly/monthly resets become remaining quota', () => {
  const result = normalizeQuota('xai', {
    config: {
      creditUsagePercent: 35,
      currentPeriod: {
        type: 'USAGE_PERIOD_TYPE_MONTHLY',
        end: '2026-11-01T00:00:00Z',
      },
    },
  });
  assert.equal(result.windows[0].remaining, 65);
  assert.equal(result.windows[0].label, 'Monthly limit');
  assert.equal(result.windows[0].periodHours, 720);
  assert.equal(result.windows[0].resetsAt, '2026-11-01T00:00:00.000Z');
  assert.equal(
    normalizeQuota('xai', { config: { creditUsagePercent: 0 } }).windows[0]
      .remaining,
    100,
  );
  assert.ok(normalizeQuota('xai', { config: {} }).error);
});

test('credential summaries exclude provider tokens, paths, metadata, and auth claims', () => {
  const result = safeAccount({
    auth_index: 'abc',
    name: 'user.json',
    provider: 'codex',
    access_token: 'secret',
    refresh_token: 'refresh',
    path: '/private/auth',
    id_token: { plan_type: 'pro', chatgpt_account_id: 'private-id' },
    metadata: { token: 'hidden' },
  });
  assert.equal(result.id, 'abc');
  assert.equal(result.plan, 'pro');
  const serialized = JSON.stringify(result);
  for (const value of [
    'secret',
    'refresh',
    '/private/auth',
    'private-id',
    'hidden',
  ])
    assert.ok(!serialized.includes(value));
});

test('Claude Pro Fable access uses credits and never supplies included quota or reset capacity', () => {
  const payload = {
    five_hour: { utilization: 93, resets_at: '2026-10-06T21:10:00Z' },
    seven_day: { utilization: 14, resets_at: '2026-10-13T02:00:00Z' },
    iguana_necktie: { utilization: 0, resets_at: '2026-11-05T07:59:00Z' },
    limits: [
      {
        kind: 'weekly_scoped',
        is_active: true,
        scope: { model: { display_name: 'Fable' } },
        percent: 0,
      },
      {
        kind: 'weekly_scoped',
        is_active: true,
        scope: { model: { display_name: 'Fable 5.1' } },
        percent: 0,
      },
      {
        kind: 'weekly_scoped',
        is_active: true,
        scope: { model: { display_name: 'Sonnet' } },
        percent: 25,
      },
    ],
  };
  for (const plan of ['pro', 'Pro', 'claude_pro']) {
    const quota = normalizeQuota('claude', payload, Date.now(), plan);
    assert.deepEqual(quota.creditModels, ['Fable']);
    assert.deepEqual(
      quota.windows.map((w) => w.label),
      ['5-hour limit', '7-day limit', '7-day Sonnet'],
    );
    assert.equal(quota.windows.find((w) => w.id === 'seven_day').remaining, 86);
  }
  const max = normalizeQuota(
    'claude',
    { ...payload, plan_type: 'max' },
    Date.now(),
    'pro',
  );
  assert.equal(max.plan, 'max');
  assert.deepEqual(max.creditModels, []);
  assert.ok(max.windows.some((w) => w.label === '7-day Fable'));
});

test('inactive Fable and unknown legacy periods do not become a fabricated weekly limit', () => {
  const legacy = {
    iguana_necktie: { utilization: 0, resets_at: '2026-11-05T07:59:00Z' },
  };
  const unknown = normalizeQuota('claude', legacy);
  assert.equal(unknown.windows[0].label, 'Fable limit');
  assert.equal(unknown.windows[0].periodHours, 0);
  const inactive = normalizeQuota('claude', {
    ...legacy,
    limits: [
      null,
      {
        kind: 'weekly_scoped',
        is_active: false,
        scope: { model: { display_name: 'Fable' } },
        percent: 0,
      },
    ],
  });
  assert.deepEqual(inactive.windows, []);
  assert.deepEqual(
    normalizeQuota('claude', {
      iguana_necktie: { utilization: 0, is_active: false },
    }).windows,
    [],
  );
});
