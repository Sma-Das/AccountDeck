import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGrokBotReader,
  decodeBlobName,
  defaultGrokBotDir,
  normalizeGrokBotUsage,
} from './grok-bot.js';

const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
function blobName(key) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of Buffer.from(key)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return `${out}.blob`;
}
const now = Date.parse('2026-10-17T04:00:00Z');
const reading = (percentUsed, nextResetMs, extra = {}) => ({
  schemaVersion: 2,
  value: {
    kind: 'present',
    selectedTeamId: null,
    reading: {
      usage: {
        percentUsed,
        nextResetMs,
        isTeamSeat: false,
        onDemand: null,
        grokPlanLabel: 'Grok Bot Plan',
        ...extra,
      },
      readAtMs: now - 3600000,
    },
    expiresAtMs: now + 3600000,
  },
});
async function dataDir(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'grok-bot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'sand-client-persistence');
  await mkdir(folder);
  for (const [key, value] of Object.entries(files))
    await writeFile(
      join(folder, blobName(key)),
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  return root;
}

test('decodes Grok Bot base32 blob names', () => {
  const key = 'sand.client.slice.account.grok%7Cuser_1.weekly-usage.cache';
  assert.equal(decodeBlobName(blobName(key)), key);
  assert.equal(decodeBlobName('not-base32!.blob'), null);
  assert.equal(decodeBlobName('readme.txt'), null);
});

test('normalizes the weekly reading as remaining quota', () => {
  const reset = now + 6 * 86400000;
  const usage = normalizeGrokBotUsage(reading(8.8, reset), now);
  assert.equal(usage.plan, 'Grok Bot Plan');
  assert.equal(usage.windows[0].label, 'Weekly limit');
  assert.equal(Math.round(usage.windows[0].remaining), 91);
  assert.equal(usage.windows[0].resetsAt, new Date(reset).toISOString());
  assert.equal(usage.updatedAt, new Date(now - 3600000).toISOString());
  assert.equal(usage.error, null);
  assert.equal(
    normalizeGrokBotUsage(reading(140, reset), now).windows[0].remaining,
    0,
  );
});

test('does not carry a reading across a weekly reset', () => {
  const usage = normalizeGrokBotUsage(reading(60, now - 1000), now);
  assert.equal(usage.windows[0].remaining, null);
  assert.match(usage.error, /reset after Grok Bot last saved usage/);
});

test('reads the active account slot and ignores other files', async (t) => {
  const root = await dataDir(t, {
    'sand.client.slice.client-meta.account-slot': {
      schemaVersion: 1,
      value: 'grok|user_b',
    },
    'sand.client.slice.account.grok%7Cuser_a.weekly-usage.cache': reading(
      70,
      now + 86400000,
    ),
    'sand.client.slice.account.grok%7Cuser_b.weekly-usage.cache': reading(
      25,
      now + 86400000,
    ),
    'sand.client.slice.account.grok%7Cuser_b.send-journal': 'not json',
  });
  const usage = await createGrokBotReader({ dataDir: root, now: () => now })();
  assert.equal(usage.connected, true);
  assert.equal(usage.windows[0].remaining, 75);
});

test('reports missing installs and unreadable caches without throwing', async (t) => {
  assert.equal(
    (await createGrokBotReader({ dataDir: null })()).connected,
    false,
  );
  assert.equal(
    (await createGrokBotReader({ dataDir: '/nonexistent/grok-bot' })())
      .connected,
    false,
  );
  const empty = await dataDir(t, {});
  assert.match(
    (await createGrokBotReader({ dataDir: empty })()).error,
    /has not saved a usage reading/,
  );
  const broken = await dataDir(t, {
    'sand.client.slice.account.grok%7Cuser_a.weekly-usage.cache': '{',
  });
  assert.match(
    (await createGrokBotReader({ dataDir: broken })()).error,
    /unreadable/,
  );
});

test('honours GROK_BOT_DATA_DIR', () => {
  assert.equal(defaultGrokBotDir({ GROK_BOT_DATA_DIR: 'none' }), null);
  assert.equal(defaultGrokBotDir({ GROK_BOT_DATA_DIR: '/x' }), '/x');
});
