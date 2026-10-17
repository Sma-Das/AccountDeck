import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Grok Bot keeps its client state as base32-named JSON blobs. The weekly usage
// reading is a plain cache the app refreshes itself; credentials are separate
// and encrypted, so only these cache files are read.
const PREFIX = 'sand.client.slice.';
const SLOT = `${PREFIX}client-meta.account-slot`;
const USAGE = /^sand\.client\.slice\.account\.(.+)\.weekly-usage\.cache$/;
const MAX_BLOB = 64 * 1024;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function defaultGrokBotDir(env = process.env, home = homedir()) {
  if (env.GROK_BOT_DATA_DIR === 'none') return null;
  if (env.GROK_BOT_DATA_DIR) return env.GROK_BOT_DATA_DIR;
  return process.platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Grok Bot')
    : null;
}

export function decodeBlobName(file) {
  if (!file.endsWith('.blob')) return null;
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of file.slice(0, -5).toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function normalizeGrokBotUsage(cache, now = Date.now()) {
  const value = cache?.value;
  const reading = value?.reading;
  const usage = reading?.usage;
  if (value?.kind !== 'present' || !usage || typeof usage !== 'object')
    return {
      connected: true,
      plan: null,
      windows: [],
      updatedAt: null,
      error: 'Grok Bot has not saved a usage reading yet. Open Grok Bot.',
    };
  const used = finite(usage.percentUsed);
  const resetMs = finite(usage.nextResetMs);
  const readAt = finite(reading.readAtMs);
  const resetPassed = resetMs !== null && resetMs <= now;
  const plan =
    typeof usage.grokPlanLabel === 'string'
      ? usage.grokPlanLabel.slice(0, 80)
      : null;
  return {
    connected: true,
    plan,
    windows: [
      {
        id: 'weekly',
        label: 'Weekly limit',
        // A reading taken before the reset says nothing about the new window.
        remaining:
          used === null || resetPassed
            ? null
            : Math.max(0, Math.min(100, 100 - used)),
        resetsAt: resetMs === null ? null : new Date(resetMs).toISOString(),
        periodHours: 168,
      },
    ],
    teamSeat: usage.isTeamSeat === true,
    onDemand: usage.onDemand ?? null,
    updatedAt: readAt === null ? null : new Date(readAt).toISOString(),
    error: resetPassed
      ? 'The weekly limit reset after Grok Bot last saved usage. Open Grok Bot to update it.'
      : null,
  };
}

async function readBlob(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BLOB) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

export function createGrokBotReader({ dataDir, now = Date.now } = {}) {
  const missing = { connected: false, plan: null, windows: [], error: null };
  return async function status() {
    if (!dataDir) return missing;
    const folder = join(dataDir, 'sand-client-persistence');
    let names;
    try {
      names = await readdir(folder);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return missing;
      return { ...missing, error: 'Could not read Grok Bot usage data.' };
    }
    const keys = new Map();
    for (const name of names) {
      const key = decodeBlobName(name);
      if (key?.startsWith(PREFIX)) keys.set(key, name);
    }
    try {
      const slot = keys.has(SLOT)
        ? (await readBlob(join(folder, keys.get(SLOT))))?.value
        : null;
      let usageFile = null;
      for (const [key, name] of keys) {
        const match = USAGE.exec(key);
        if (!match) continue;
        const account = decodeURIComponent(match[1]);
        if (!usageFile || account === slot) usageFile = name;
        if (account === slot) break;
      }
      if (!usageFile)
        return {
          ...missing,
          connected: true,
          error: 'Grok Bot has not saved a usage reading yet. Open Grok Bot.',
        };
      return normalizeGrokBotUsage(
        await readBlob(join(folder, usageFile)),
        now(),
      );
    } catch {
      return {
        ...missing,
        connected: true,
        error:
          'Grok Bot usage data is unreadable. Open Grok Bot to rewrite it.',
      };
    }
  };
}
