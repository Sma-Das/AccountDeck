export type Window = {
  id: string;
  label: string;
  remaining: number | null;
  resetsAt: string | null;
  periodHours: number;
};
export type Quota = {
  windows: Window[];
  plan: string | null;
  updatedAt: string;
  error: string | null;
  creditModels?: string[];
};
export type Account = {
  id: string;
  name: string;
  email: string | null;
  provider: string;
  label: string | null;
  plan: string | null;
  disabled: boolean;
  unavailable: boolean;
  runtimeOnly: boolean;
  status: string;
  priority: number;
  nativeSource?: string | null;
  creditModels?: string[];
  quota: Quota | null;
};
export type Routing = { strategy: string; affinity: boolean; ttl: string };
export type Expiry = {
  enabled: boolean;
  checkedAt: string | null;
  error: string | null;
  boosted: { id: string; originalPriority: number; resetsAt: string }[];
};
export type Page =
  | 'overview'
  | 'quota'
  | 'providers'
  | 'routing'
  | 'setup'
  | 'github-accounts'
  | 'github-routes'
  | 'github-repositories'
  | 'github-machines'
  | 'github-agents';
export type Model = { id: string; name: string };

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Console-Request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || `Request failed with HTTP ${response.status}.`,
    );
  return data;
}

export const providerInfo: Record<
  string,
  { name: string; color: string; mark: string; description: string }
> = {
  claude: {
    name: 'Claude',
    color: '#d9957a',
    mark: '✳',
    description: 'Claude Code subscription',
  },
  codex: {
    name: 'Codex',
    color: '#a6b9ef',
    mark: '◈',
    description: 'ChatGPT subscription',
  },
  antigravity: {
    name: 'Antigravity',
    color: '#8baedf',
    mark: 'A',
    description: 'Google OAuth',
  },
  xai: {
    name: 'Grok Build',
    color: '#deded9',
    mark: '𝕏',
    description: 'Grok CLI subscription',
  },
  kimi: {
    name: 'Kimi',
    color: '#dfdeda',
    mark: 'K',
    description: 'Kimi coding subscription',
  },
  cursor: {
    name: 'Cursor',
    color: '#deded9',
    mark: 'C',
    description: 'Cursor subscription',
  },
  'grok-bot': {
    name: 'Grok Bot',
    color: '#deded9',
    mark: '𝕏',
    description: 'Grok Bot app subscription',
  },
};
// Tracked on this Mac rather than through the proxy, so they have no OAuth flow.
export const localSubscriptions = ['cursor', 'grok-bot'];
export const info = (provider: string) =>
  providerInfo[provider] || {
    name: provider,
    color: '#9eddaf',
    mark: provider[0]?.toUpperCase() || '?',
    description: 'OAuth provider',
  };
export const weekly = (account: Account) =>
  account.quota?.windows.find((w) => w.id === 'seven_day' || w.id === 'week') ||
  account.quota?.windows.find((w) => w.periodHours >= 168) ||
  account.quota?.windows[0];
export function relative(date: string | null | undefined, now = Date.now()) {
  if (!date) return 'No reset scheduled';
  const diff = Date.parse(date) - now;
  if (!Number.isFinite(diff)) return 'Reset time unavailable';
  if (diff <= 0) return 'Reset due. Refresh quota.';
  const hours = Math.ceil(diff / 3600000);
  return diff < 3600000
    ? `in ${Math.ceil(diff / 60000)}m`
    : hours < 24
      ? `in ${hours}h`
      : `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}
export function masked(email: string) {
  if (!email.includes('@')) return email.replace(/(.{5}).*(.{5})/, '$1•••$2');
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}•••@${domain.slice(0, 1)}•••.${domain.split('.').at(-1)}`;
}
export function createDemo(): Account[] {
  const rows: [string, string, string, number, number, number, number][] = [
    ['claude', 'alex@work.dev', 'Max 20x', 58, 100, 79, 20],
    ['claude', 'sam@studio.dev', 'Max 20x', 100, 100, 100, 96],
    ['claude', 'jules@build.dev', 'Max 20x', 100, 100, 100, 106],
    ['claude', 'robin@work.dev', 'Max 20x', 51, 99, 75, 28],
    ['claude', 'morgan@studio.dev', 'Max 20x', 100, 100, 100, 122],
    ['codex', 'alex@work.dev', 'Pro', 12, 72, 12, 43],
    ['codex', 'sam@studio.dev', 'Pro', 0, 0, 0, 67],
    ['codex', 'jules@build.dev', 'Plus', 5, 89, 5, 93],
    ['xai', 'alex@work.dev', 'SuperGrok', -1, -1, -1, 125],
    ['kimi', 'robin@work.dev', 'Coding', 100, 100, 100, 117],
  ];
  return rows.map(([provider, email, plan, week, five, all, hours], index) => {
    const reset = new Date(Date.now() + hours * 3600000).toISOString();
    const windows: Window[] =
      provider === 'xai'
        ? []
        : provider === 'claude'
          ? [
              {
                id: 'model',
                label: '7-day Fable',
                remaining: week,
                resetsAt: reset,
                periodHours: 168,
              },
              {
                id: 'five',
                label: '5-hour limit',
                remaining: five,
                resetsAt:
                  five === 100
                    ? null
                    : new Date(Date.now() + 3 * 3600000).toISOString(),
                periodHours: 5,
              },
              {
                id: 'week',
                label: '7-day limit',
                remaining: all,
                resetsAt: reset,
                periodHours: 168,
              },
            ]
          : [
              {
                id: 'five',
                label: '5-hour limit',
                remaining: five,
                resetsAt: new Date(Date.now() + 2 * 3600000).toISOString(),
                periodHours: 5,
              },
              {
                id: 'week',
                label: '7-day limit',
                remaining: week,
                resetsAt: reset,
                periodHours: 168,
              },
            ];
    return {
      id: `demo-${index}`,
      name: `${provider}-${email}.json`,
      email,
      provider,
      label: null,
      plan,
      disabled: false,
      unavailable: week === 0,
      runtimeOnly: false,
      status: week === 0 ? 'cooldown' : 'ready',
      priority: 0,
      quota: {
        windows,
        plan,
        updatedAt: new Date().toISOString(),
        error:
          provider === 'xai'
            ? 'Quota inspection is unavailable for this provider.'
            : null,
      },
    };
  });
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';
