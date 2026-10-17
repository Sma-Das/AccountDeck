import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  FolderGit2,
  Gauge,
  Github,
  Laptop,
  LayoutDashboard,
  LayoutGrid,
  List,
  Menu,
  Moon,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  Terminal,
  Unplug,
  X,
} from 'lucide-react';
import {
  api,
  createDemo,
  info,
  localSubscriptions,
  masked,
  providerInfo,
  relative,
  errorMessage as message,
} from './types';
import type { Account, Expiry, Page, Quota, Routing } from './types';
import { Bar, Brand, Logo, Meter, PageHeader, tone } from './components/ui';
import { ConnectionModal } from './components/ConnectionModal';
import { AccountModal } from './components/AccountModal';
import { OAuthModal } from './components/OAuthModal';
import { RoutingPage } from './components/RoutingPage';
import { SetupPage } from './components/SetupPage';
import { GitHubWorkspace } from './components/GitHubWorkspace';
import type { GitHubSummary } from './components/GitHubWorkspace';
import { CursorUsage } from './components/CursorUsage';
import { GrokBotUsage } from './components/GrokBotUsage';
import { CreditAccessNote } from './components/CreditAccessNote';
import { LimitDisplayModal } from './components/LimitDisplayModal';
import { CommandPalette } from './components/CommandPalette';
import type { Command } from './components/CommandPalette';
import {
  displayWindow,
  limitsHidden,
  readLimitDisplay,
  visibleWindows,
} from './limit-display';
import type { LimitDisplay } from './limit-display';

type PageInfo = {
  label: string;
  title: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
};
const pages: Record<Page, PageInfo> = {
  overview: {
    label: 'Overview',
    title: 'Overview',
    description: 'AI subscription capacity and GitHub routing at a glance.',
    icon: LayoutDashboard,
  },
  'github-accounts': {
    label: 'Accounts',
    title: 'GitHub accounts',
    description:
      'Accounts signed in to GitHub CLI. Tokens stay in each computer’s credential store.',
    icon: Github,
  },
  'github-routes': {
    label: 'Folder routes',
    title: 'Folder routes',
    description:
      'Choose which GitHub account each folder uses. Routes apply to nested repositories and worktrees.',
    icon: FolderGit2,
  },
  'github-repositories': {
    label: 'Repositories',
    title: 'Repositories',
    description:
      'Scan a workspace folder to find checkouts and remotes without an account.',
    icon: Search,
  },
  'github-machines': {
    label: 'Computers',
    title: 'Computers',
    description:
      'Pair other computers to manage their GitHub accounts and routes from here.',
    icon: Laptop,
  },
  'github-agents': {
    label: 'Agent commands',
    title: 'Agent commands',
    description:
      'Run coding agents and Git with the GitHub identity a folder is routed to.',
    icon: Bot,
  },
  quota: {
    label: 'Quotas',
    title: 'Quotas',
    description: 'Remaining capacity and reset times for every proxy account.',
    icon: Gauge,
  },
  providers: {
    label: 'Providers',
    title: 'AI providers',
    description: 'Connected providers and the accounts behind each one.',
    icon: Network,
  },
  routing: {
    label: 'Routing',
    title: 'Routing',
    description: 'How the proxy picks an account for each new request.',
    icon: SlidersHorizontal,
  },
  setup: {
    label: 'Client setup',
    title: 'Client setup',
    description:
      'Point Claude Code, Codex, or any OpenAI-compatible client at your proxy.',
    icon: Terminal,
  },
};
const navGroups: { label: string | null; items: Page[] }[] = [
  { label: null, items: ['overview'] },
  {
    label: 'GitHub',
    items: [
      'github-accounts',
      'github-routes',
      'github-repositories',
      'github-machines',
      'github-agents',
    ],
  },
  { label: 'AI', items: ['quota', 'providers', 'routing', 'setup'] },
];
const isPage = (id: string): id is Page => Object.hasOwn(pages, id);
// Only these providers report quota through the proxy.
const inspectable = ['claude', 'codex', 'xai'];
const emptyExpiry: Expiry = {
  enabled: false,
  checkedAt: null,
  error: null,
  boosted: [],
};

export default function App() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  );
  const [page, setPage] = useState<Page>(() => {
    const id = location.hash.slice(1);
    return isPage(id) ? id : 'overview';
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [startupError, setStartupError] = useState('');
  const [connected, setConnected] = useState(false);
  const [baseUrl, setBaseUrl] = useState('http://localhost:8317');
  const [routing, setRouting] = useState<Routing>({
    strategy: 'round-robin',
    affinity: true,
    ttl: '1h',
  });
  const [filter, setFilter] = useState('all');
  const [expiry, setExpiry] = useState<Expiry>(emptyExpiry);
  const [expiryBusy, setExpiryBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('provider');
  const [view, setView] = useState('ledger');
  const [reveal, setReveal] = useState(
    () => localStorage.getItem('cliproxy-reveal') === 'true',
  );
  const [now, setNow] = useState(Date.now());
  const [refreshed, setRefreshed] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [limitDisplayOpen, setLimitDisplayOpen] = useState(false);
  const displayKey = `cliproxy-limit-display:${connected ? baseUrl : 'demo'}`;
  const [limitSettings, setLimitSettings] = useState(() => ({
    key: displayKey,
    value: readLimitDisplay(displayKey),
  }));
  const limitDisplay =
    limitSettings.key === displayKey
      ? limitSettings.value
      : readLimitDisplay(displayKey);
  function saveLimitDisplay(value: LimitDisplay) {
    try {
      localStorage.setItem(displayKey, JSON.stringify(value));
      setLimitSettings({ key: displayKey, value });
      setLimitDisplayOpen(false);
      setSelected(null);
      notify('Limit display saved.');
    } catch {
      notify(
        'Could not save limit display. Browser storage is unavailable.',
        true,
      );
    }
  }
  const weekly = (account: Account) => displayWindow(account, limitDisplay);
  const [addProvider, setAddProvider] = useState<string | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [github, setGithub] = useState<GitHubSummary | null>(null);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 760px)').matches,
  );
  const generation = useRef(0);
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const loadSnapshot = useCallback(async () => {
    const version = generation.current;
    const data = await api<{
      accounts: Account[];
      routing: Routing;
      expiry: Expiry;
      baseUrl: string;
    }>('/snapshot');
    if (version !== generation.current) return null;
    setAccounts(data.accounts);
    setBaseUrl(data.baseUrl);
    setRouting(data.routing);
    setExpiry(data.expiry);
    setRefreshed(Date.now());
    return data;
  }, []);
  useEffect(() => {
    let cancelled = false;
    api('/workspace/session')
      .then(() => {
        if (!cancelled) setInitializing(false);
        return api<{ connected: boolean; baseUrl: string }>('/session');
      })
      .then(async (session) => {
        if (cancelled) return;
        if (!session.connected) {
          setAccounts(createDemo());
          return;
        }
        setAccounts([]);
        setConnected(true);
        setBaseUrl(session.baseUrl);
        await loadSnapshot();
      })
      .catch((error) => {
        if (!cancelled) setStartupError(message(error));
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot, notify]);
  useEffect(() => {
    if (!connected || (!expiry.enabled && !expiry.boosted.length)) return;
    const timer = setInterval(
      () => void loadSnapshot().catch((error) => notify(message(error), true)),
      60000,
    );
    return () => clearInterval(timer);
  }, [connected, expiry.enabled, expiry.boosted.length, loadSnapshot, notify]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = () => {
      const id = location.hash.slice(1);
      if (isPage(id)) setPage(id);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => {
      setIsMobile(media.matches);
      setMobileNav(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileNav) return;
    document
      .querySelector<HTMLButtonElement>('#sidebar nav [aria-current="page"]')
      ?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const controls = document.querySelectorAll<HTMLElement>(
          '#sidebar a[href], #sidebar button:not(:disabled)',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (event.key !== 'Escape') return;
      setMobileNav(false);
      document.getElementById('navigation-toggle')?.focus();
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNav]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement;
      if (
        event.key !== '/' ||
        event.metaKey ||
        event.ctrlKey ||
        target.closest('input, textarea, select, [contenteditable], dialog')
      )
        return;
      const search = document.querySelector<HTMLInputElement>('[data-search]');
      if (!search) return;
      event.preventDefault();
      search.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function go(next: Page) {
    setPage(next);
    location.hash = next;
    setMobileNav(false);
    window.scrollTo({ top: 0 });
    if (mobileNav)
      requestAnimationFrame(() =>
        document.getElementById('main-content')?.focus(),
      );
  }
  function toggleEmails() {
    setReveal(!reveal);
    localStorage.setItem('cliproxy-reveal', String(!reveal));
  }
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cliproxy-theme', next);
  }
  async function refreshAccount(account: Account, quiet = false) {
    const version = generation.current;
    setLoadingIds((ids) => new Set(ids).add(account.id));
    try {
      const quota = connected
        ? await api<Quota>(
            `/accounts/${encodeURIComponent(account.id)}/quota`,
            'POST',
          )
        : { ...account.quota!, updatedAt: new Date().toISOString() };
      if (version !== generation.current) return false;
      setAccounts((current) =>
        current.map((a) =>
          a.id === account.id
            ? { ...a, quota: { ...quota, plan: quota.plan || a.plan } }
            : a,
        ),
      );
      if (!quiet)
        notify(
          connected
            ? `${info(account.provider).name} quota refreshed.`
            : 'Demo quota refreshed. Connect your proxy for live data.',
        );
      return true;
    } catch (error) {
      if (version !== generation.current) return false;
      setAccounts((current) =>
        current.map((a) =>
          a.id === account.id
            ? {
                ...a,
                quota: {
                  ...a.quota,
                  windows: a.quota?.windows || [],
                  plan: a.plan,
                  updatedAt: a.quota?.updatedAt || '',
                  error: message(error),
                },
              }
            : a,
        ),
      );
      if (!quiet) notify(message(error), true);
      return false;
    } finally {
      setLoadingIds((ids) => {
        const next = new Set(ids);
        next.delete(account.id);
        return next;
      });
    }
  }
  async function refreshAll() {
    const version = generation.current;
    setBusy(true);
    try {
      const data = connected ? await loadSnapshot() : { accounts };
      if (!data || version !== generation.current) return;
      const eligible = data.accounts.filter(
        (a) =>
          !a.disabled &&
          (!connected || ['claude', 'codex', 'xai'].includes(a.provider)),
      );
      let failed = 0;
      for (let index = 0; index < eligible.length; index += 3) {
        if (version !== generation.current) return;
        const result = await Promise.all(
          eligible.slice(index, index + 3).map((a) => refreshAccount(a, true)),
        );
        failed += result.filter((ok) => !ok).length;
      }
      if (version !== generation.current) return;
      setNow(Date.now());
      setRefreshed(Date.now());
      notify(
        connected
          ? `${eligible.length - failed} quotas refreshed.${failed ? ` ${failed} failed; details are shown beside each account.` : ''}`
          : 'Demo data refreshed. Connect your proxy for live quotas.',
        failed > 0,
      );
    } catch (error) {
      notify(message(error), true);
    } finally {
      setBusy(false);
    }
  }
  async function updateAccount(
    account: Account,
    changes: { disabled?: boolean; priority?: number },
  ) {
    if (connected)
      await api(
        `/accounts/${encodeURIComponent(account.id)}`,
        'PATCH',
        changes,
      );
    setAccounts((current) =>
      current.map((a) => (a.id === account.id ? { ...a, ...changes } : a)),
    );
    if (connected) await loadSnapshot();
    notify(
      `${connected ? '' : 'Demo: '}${changes.disabled !== undefined ? `Account ${changes.disabled ? 'paused' : 'resumed'}.` : 'Account priority saved.'}`,
    );
  }
  async function disconnect() {
    try {
      await api('/session', 'DELETE');
      generation.current++;
      setConnected(false);
      setAccounts(createDemo());
      setBaseUrl('http://localhost:8317');
      setRouting({ strategy: 'round-robin', affinity: true, ttl: '1h' });
      setExpiry(emptyExpiry);
      setConnectOpen(false);
      notify('Disconnected. You are viewing demo data.');
    } catch (error) {
      notify(message(error), true);
    }
  }
  const providers = [
    ...new Set([
      ...Object.keys(providerInfo),
      ...accounts.map((a) => a.provider),
    ]),
  ];
  const visible = accounts
    .filter(
      (a) =>
        (filter === 'all' || a.provider === filter) &&
        `${a.email || ''} ${a.name} ${a.plan || ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'reset'
        ? (Date.parse(weekly(a)?.resetsAt || '') || Infinity) -
          (Date.parse(weekly(b)?.resetsAt || '') || Infinity)
        : sort === 'remaining'
          ? (weekly(a)?.remaining ?? -1) - (weekly(b)?.remaining ?? -1)
          : sort === 'priority'
            ? b.priority - a.priority
            : providers.indexOf(a.provider) - providers.indexOf(b.provider),
    );
  const ready = accounts.filter((a) => !a.disabled && !a.unavailable).length;
  const unavailable = accounts.filter(
    (a) => a.unavailable && !a.disabled,
  ).length;
  const paused = accounts.filter((a) => a.disabled).length;
  const loaded = accounts.filter(
    (a) => visibleWindows(a, limitDisplay).length,
  ).length;
  const nextReset = accounts
    .filter((a) => !a.disabled && Date.parse(weekly(a)?.resetsAt || '') > now)
    .sort(
      (a, b) =>
        Date.parse(weekly(a)!.resetsAt!) - Date.parse(weekly(b)!.resetsAt!),
    )[0];
  const activeProviders = providers.filter(
    (provider) =>
      !localSubscriptions.includes(provider) &&
      accounts.some((account) => account.provider === provider),
  );
  const isGitHub = page.startsWith('github-');
  const isAI = !isGitHub && page !== 'overview';
  const minutesAgo = Math.max(0, Math.floor((now - refreshed) / 60000));
  const syncLabel = `${connected ? 'Refreshed' : 'Demo data'} ${minutesAgo < 1 ? 'just now' : `${minutesAgo}m ago`}`;
  const label = (account: Account) =>
    reveal
      ? account.email || account.name
      : masked(account.email || account.name);

  function capacity(provider: string) {
    const group = accounts.filter(
      (a) => a.provider === provider && !a.disabled,
    );
    const shown = group.filter(
      (account) =>
        !limitsHidden(account, limitDisplay) &&
        (!account.quota?.windows.length ||
          visibleWindows(account, limitDisplay).length > 0),
    );
    const labels = [
      ...new Set(
        shown.map((account) => weekly(account)?.label).filter(Boolean),
      ),
    ];
    const values = shown
      .map((a) => weekly(a)?.remaining)
      .filter((v): v is number => v != null);
    const reset = shown
      .map((a) => weekly(a)?.resetsAt)
      .filter((v): v is string => !!v && Date.parse(v) > now)
      .sort()[0];
    return {
      group,
      shown,
      labels,
      values,
      reset,
      hiddenCount: group.length - shown.length,
      allHidden:
        limitDisplay.providers.includes(provider) ||
        (group.length > 0 && !shown.length),
      average: values.length
        ? Math.round(
            values.reduce((sum, value) => sum + value, 0) / values.length,
          )
        : null,
    };
  }

  function capacityCard(provider: string, onSelect: () => void) {
    const c = capacity(provider);
    const total = accounts.filter((a) => a.provider === provider).length;
    const selected = page === 'quota' && filter === provider;
    return (
      <button
        key={provider}
        className={`capacity ${selected ? 'selected' : ''}`}
        aria-pressed={page === 'quota' ? selected : undefined}
        onClick={onSelect}
      >
        <span className="capacity-head">
          <Brand provider={provider} small />
          <strong>{info(provider).name}</strong>
          <small>
            {total} {total === 1 ? 'account' : 'accounts'}
          </small>
        </span>
        <span className="capacity-value">
          <strong className={c.allHidden ? 'muted' : tone(c.average)}>
            {c.allHidden ? 'Hidden' : c.average == null ? '—' : `${c.average}%`}
          </strong>
          <small>
            {c.allHidden
              ? 'limits hidden'
              : c.average == null
                ? 'quota unavailable'
                : `${c.values.length > 1 ? 'avg. left' : 'left'} · ${c.labels.length === 1 ? c.labels[0] : 'visible limits'}`}
          </small>
        </span>
        <span className="segments">
          {c.shown.length && !c.allHidden ? (
            c.shown.map((a) => <Bar key={a.id} value={weekly(a)?.remaining} />)
          ) : (
            <Bar value={null} />
          )}
        </span>
        <span className="capacity-foot">
          <Clock3 size={12} />
          {c.allHidden
            ? 'Limits hidden'
            : c.reset
              ? `Next reset ${relative(c.reset, now)}`
              : 'No reset scheduled'}
          {!c.allHidden && c.hiddenCount > 0 && ` · ${c.hiddenCount} hidden`}
        </span>
      </button>
    );
  }

  const attention = accounts
    .flatMap((account) => {
      if (account.disabled) return [];
      const window = weekly(account);
      if (account.unavailable)
        return [
          {
            account,
            level: 'red',
            text: `Unavailable${window?.resetsAt ? ` · resets ${relative(window.resetsAt, now)}` : ''}`,
          },
        ];
      if (window?.remaining != null && window.remaining <= 20)
        return [
          {
            account,
            level: window.remaining <= 5 ? 'red' : 'yellow',
            text: `${Math.round(window.remaining)}% left on ${window.label} · resets ${relative(window.resetsAt, now)}`,
          },
        ];
      if (
        connected &&
        account.quota?.error &&
        inspectable.includes(account.provider)
      )
        return [{ account, level: 'yellow', text: account.quota.error }];
      return [];
    })
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(`${baseUrl}/v1`);
      notify('Endpoint copied.');
    } catch {
      notify('Clipboard access is unavailable. Select and copy the URL.', true);
    }
  }

  const commands: Command[] = [
    ...navGroups.flatMap((group) =>
      group.items.map((id) => ({
        id: `go-${id}`,
        label: pages[id].title,
        group: 'Go to',
        icon: pages[id].icon,
        keywords: `${group.label || ''} ${pages[id].label}`,
        run: () => go(id),
      })),
    ),
    {
      id: 'refresh-quotas',
      label: 'Refresh all quotas',
      group: 'Actions',
      icon: RefreshCw,
      run: () => {
        go('quota');
        void refreshAll();
      },
    },
    {
      id: 'add-ai',
      label: 'Add AI account',
      group: 'Actions',
      icon: Plus,
      keywords: 'connect oauth claude codex',
      run: () => setAddProvider('claude'),
    },
    {
      id: 'connection',
      label: connected ? 'Manage proxy connection' : 'Connect your proxy',
      group: 'Actions',
      icon: Unplug,
      keywords: 'cliproxyapi management key',
      run: () => setConnectOpen(true),
    },
    {
      id: 'limits',
      label: 'Limit display',
      group: 'Actions',
      icon: SlidersHorizontal,
      keywords: 'hide limits',
      run: () => setLimitDisplayOpen(true),
    },
    {
      id: 'emails',
      label: reveal ? 'Hide email addresses' : 'Show email addresses',
      group: 'Preferences',
      icon: reveal ? EyeOff : Eye,
      keywords: 'privacy mask',
      run: toggleEmails,
    },
    {
      id: 'theme',
      label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
      group: 'Preferences',
      icon: theme === 'dark' ? Sun : Moon,
      keywords: 'appearance dark light',
      run: toggleTheme,
    },
  ];

  function accountRow(account: Account) {
    const accountWindows = visibleWindows(account, limitDisplay);
    const hidden =
      limitsHidden(account, limitDisplay) ||
      (!!account.quota?.windows.length && !accountWindows.length);
    const stale =
      !!account.quota?.updatedAt &&
      now - Date.parse(account.quota.updatedAt) > 5 * 60000;
    const refreshable = !connected || inspectable.includes(account.provider);
    return (
      <article
        className={`account-row ${account.disabled ? 'disabled' : ''}`}
        key={account.id}
      >
        <button
          className="account-identity"
          onClick={() => setSelected(account)}
          title="Manage account"
        >
          <span
            className={`status-dot ${account.disabled ? 'gray' : account.unavailable ? 'red' : ''}`}
          />
          <span>
            <strong>{label(account)}</strong>
            <span className="account-tags">
              {(view === 'cards' || sort !== 'provider') && (
                <span>{info(account.provider).name} ·</span>
              )}
              <span>
                {account.quota?.plan || account.plan || 'OAuth account'}
              </span>
              {account.nativeSource && (
                <span className="tag">{account.nativeSource}</span>
              )}
              {account.priority !== 0 && (
                <span className="tag">P{account.priority}</span>
              )}
              {expiry.boosted.some((boost) => boost.id === account.id) && (
                <span className="tag accent">Auto-prioritized</span>
              )}
              {account.disabled && <span className="tag">Paused</span>}
              {!account.disabled && account.unavailable && (
                <span className="tag red">Unavailable</span>
              )}
            </span>
          </span>
        </button>
        <div className="account-meters">
          {accountWindows.length ? (
            accountWindows.map((window) => (
              <Meter key={window.id} window={window} now={now} />
            ))
          ) : (
            <div className="quota-missing">
              {hidden ? <EyeOff size={14} /> : <CircleAlert size={14} />}
              {hidden
                ? 'Limits hidden'
                : account.quota?.error || 'Quota has not been loaded'}
            </div>
          )}
        </div>
        <div className="row-actions">
          <button
            className="icon-button"
            disabled={
              loadingIds.has(account.id) ||
              account.disabled ||
              busy ||
              !refreshable
            }
            onClick={() => refreshAccount(account)}
            aria-label={`Refresh ${info(account.provider).name} account ${label(account)}`}
            title={
              refreshable
                ? 'Refresh quota'
                : 'Quota inspection is not supported for this provider'
            }
          >
            <RefreshCw
              size={15}
              className={loadingIds.has(account.id) ? 'spin' : ''}
            />
          </button>
          <button
            className="icon-button"
            aria-label={`Manage ${info(account.provider).name} account ${label(account)}`}
            title="Manage account"
            onClick={() => setSelected(account)}
          >
            <Settings2 size={15} />
          </button>
        </div>
        <CreditAccessNote account={account} />
        {!hidden &&
          ((account.quota?.error && accountWindows.length > 0) || stale) && (
            <div className="row-warning">
              <Clock3 size={12} />
              {account.quota?.error ||
                'Quota is over 5 minutes old. Refresh for current limits.'}
            </div>
          )}
      </article>
    );
  }

  const refreshButton = (
    <button className="secondary" onClick={refreshAll} disabled={busy}>
      <RefreshCw size={14} className={busy ? 'spin' : ''} />
      {busy ? 'Refreshing…' : 'Refresh quotas'}
    </button>
  );
  const addButton = (
    <button className="primary" onClick={() => setAddProvider('claude')}>
      <Plus size={15} />
      Add AI account
    </button>
  );
  const headerActions: Partial<Record<Page, ReactNode>> = {
    overview: refreshButton,
    quota: (
      <>
        {refreshButton}
        {addButton}
      </>
    ),
    providers: addButton,
  };

  if (initializing) {
    return (
      <main className="connection-startup" aria-busy={initializing}>
        <Logo size={40} />
        <h1>
          {startupError
            ? 'AccountDeck could not start'
            : 'Opening AccountDeck…'}
        </h1>
        {startupError ? (
          <>
            <p role="alert">{startupError}</p>
            <button
              className="primary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </>
        ) : (
          <div className="startup-bar" />
        )}
      </main>
    );
  }

  const proxyState = connected ? 'live' : startupError ? 'offline' : 'demo';
  const proxyLabel = {
    live: 'Proxy connected',
    offline: 'Proxy offline',
    demo: 'Demo data',
  }[proxyState];

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        id="sidebar"
        inert={isMobile && !mobileNav}
        aria-label="Workspace navigation"
        className={`sidebar ${mobileNav ? 'open' : ''}`}
      >
        <a className="brand" href="#overview" onClick={() => go('overview')}>
          <Logo />
          <strong>AccountDeck</strong>
        </a>
        <button
          className="palette-trigger"
          onClick={() => setPaletteOpen(true)}
        >
          <Search size={14} />
          <span>Jump to…</span>
          <kbd>⌘K</kbd>
        </button>
        <nav aria-label="Console">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label || 'main'}>
              {group.label && <div className="nav-label">{group.label}</div>}
              {group.items.map((id) => {
                const Icon = pages[id].icon;
                return (
                  <button
                    key={id}
                    className={page === id ? 'active' : ''}
                    aria-current={page === id ? 'page' : undefined}
                    onClick={() => go(id)}
                  >
                    <Icon size={16} />
                    <span>{pages[id].label}</span>
                    {id === 'quota' && attention.length > 0 && (
                      <small
                        className="nav-alert"
                        title={`${attention.length} accounts need attention`}
                      >
                        {attention.length}
                      </small>
                    )}
                    {id === 'quota' && !attention.length && (
                      <small>{accounts.length}</small>
                    )}
                    {id === 'github-routes' && github?.routes != null && (
                      <small>{github.routes}</small>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`proxy-card ${proxyState}`}
            onClick={() => setConnectOpen(true)}
          >
            <span className="proxy-card-top">
              <span className="pulse" />
              <strong>{proxyLabel}</strong>
              <ArrowUpRight size={14} />
            </span>
            <span className="proxy-card-detail">
              {connected
                ? new URL(baseUrl).host
                : startupError
                  ? 'Retry or update the connection'
                  : 'Connect CLIProxyAPI for live quotas'}
            </span>
          </button>
          <div className="sidebar-links">
            <a
              href="https://help.router-for.me/"
              target="_blank"
              rel="noreferrer"
            >
              Docs
              <ArrowUpRight size={12} />
            </a>
            <a
              href="https://github.com/router-for-me/CLIProxyAPI"
              target="_blank"
              rel="noreferrer"
            >
              CLIProxyAPI
              <ArrowUpRight size={12} />
            </a>
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="mobile-bar">
          <button
            id="navigation-toggle"
            className="icon-button"
            onClick={() => setMobileNav(!mobileNav)}
            aria-label={mobileNav ? 'Close navigation' : 'Open navigation'}
            aria-controls="sidebar"
            aria-expanded={mobileNav}
          >
            <Menu size={19} />
          </button>
          <Logo size={24} />
          <strong>{pages[page].title}</strong>
          <button
            className="icon-button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command menu"
          >
            <Search size={17} />
          </button>
        </header>
        <main id="main-content" tabIndex={-1}>
          {!isGitHub && (
            <PageHeader
              title={pages[page].title}
              description={pages[page].description}
              actions={headerActions[page]}
            />
          )}
          {!isGitHub && startupError && (
            <div className="callout red" role="alert">
              <CircleAlert size={16} />
              <div>
                <strong>AI proxy unavailable</strong>
                <p>{startupError}</p>
              </div>
              <button
                className="secondary compact"
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </div>
          )}
          {!isGitHub && !connected && !startupError && (
            <div className="callout">
              <Unplug size={16} />
              <div>
                <strong>You’re looking at sample AI data</strong>
                <p>
                  Connect your CLIProxyAPI instance to see live accounts and
                  quotas. GitHub pages always use real data.
                </p>
              </div>
              <button
                className="secondary compact"
                onClick={() => setConnectOpen(true)}
              >
                Connect proxy
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {page === 'overview' && (
            <>
              <div className="stat-grid">
                <button className="stat" onClick={() => go('quota')}>
                  <span className="stat-label">
                    <Gauge size={14} />
                    AI accounts ready
                  </span>
                  <strong>
                    {ready}
                    <small>/ {accounts.length}</small>
                  </strong>
                  <span className="stat-detail">
                    {unavailable > 0 && (
                      <span className="red">{unavailable} unavailable</span>
                    )}
                    {unavailable > 0 && paused > 0 && ' · '}
                    {paused > 0 && `${paused} paused`}
                    {!unavailable && !paused && 'All accounts available'}
                  </span>
                </button>
                <button
                  className="stat"
                  onClick={() => {
                    setSort('reset');
                    go('quota');
                  }}
                >
                  <span className="stat-label">
                    <Clock3 size={14} />
                    Next quota reset
                  </span>
                  <strong>
                    {nextReset
                      ? relative(weekly(nextReset)?.resetsAt, now).replace(
                          'in ',
                          '',
                        )
                      : '—'}
                  </strong>
                  <span className="stat-detail">
                    {nextReset ? (
                      <>
                        <Brand provider={nextReset.provider} small />
                        <span className="mono">{label(nextReset)}</span>
                      </>
                    ) : (
                      'Refresh quotas to see resets'
                    )}
                  </span>
                </button>
                <button className="stat" onClick={() => go('github-accounts')}>
                  <span className="stat-label">
                    <Github size={14} />
                    GitHub accounts
                  </span>
                  <strong>
                    {github?.loading ? '…' : (github?.accounts ?? '—')}
                  </strong>
                  <span className="stat-detail">
                    {github?.error
                      ? 'Unavailable'
                      : `on ${github?.computer || 'this computer'}`}
                  </span>
                </button>
                <button className="stat" onClick={() => go('github-routes')}>
                  <span className="stat-label">
                    <FolderGit2 size={14} />
                    Folder routes
                  </span>
                  <strong>
                    {github?.loading ? '…' : (github?.routes ?? '—')}
                  </strong>
                  <span className="stat-detail">
                    {github?.folders != null
                      ? `across ${github.folders} ${github.folders === 1 ? 'folder' : 'folders'}`
                      : 'Choose an account per folder'}
                  </span>
                </button>
                <button className="stat" onClick={() => go('github-machines')}>
                  <span className="stat-label">
                    <Laptop size={14} />
                    Computers
                  </span>
                  <strong>{github?.computers ?? '—'}</strong>
                  <span className="stat-detail">
                    {github && github.computers > 1
                      ? `${github.computers - 1} paired`
                      : 'Only this computer'}
                  </span>
                </button>
              </div>
              <div className="overview-layout">
                <section className="card" aria-labelledby="capacity-title">
                  <div className="card-header">
                    <div>
                      <h2 id="capacity-title">AI capacity</h2>
                      <p>
                        {loaded} of {accounts.length} accounts reporting ·{' '}
                        {syncLabel}
                      </p>
                    </div>
                    <button className="link-button" onClick={() => go('quota')}>
                      All quotas
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {activeProviders.length ? (
                    <div className="capacity-list">
                      {activeProviders.map((provider) =>
                        capacityCard(provider, () => {
                          setFilter(provider);
                          go('quota');
                        }),
                      )}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Gauge size={22} />
                      <h3>No AI accounts yet</h3>
                      <p>Add an account to start tracking its quota.</p>
                      <button
                        className="secondary"
                        onClick={() => setAddProvider('claude')}
                      >
                        <Plus size={14} />
                        Add AI account
                      </button>
                    </div>
                  )}
                  <div className="local-subscriptions">
                    <GrokBotUsage summary display={limitDisplay} />
                    <CursorUsage
                      summary
                      active={connected}
                      display={limitDisplay}
                      saveDisplay={saveLimitDisplay}
                    />
                  </div>
                </section>
                <div className="overview-side">
                  <section className="card" aria-labelledby="attention-title">
                    <div className="card-header">
                      <div>
                        <h2 id="attention-title">Needs attention</h2>
                        <p>Low, unavailable, or failing accounts</p>
                      </div>
                    </div>
                    {attention.length ? (
                      <ul className="attention-list">
                        {attention
                          .slice(0, 6)
                          .map(({ account, level, text }) => (
                            <li key={account.id}>
                              <button onClick={() => setSelected(account)}>
                                <span className={`status-dot ${level}`} />
                                <Brand provider={account.provider} small />
                                <span>
                                  <strong className="mono">
                                    {label(account)}
                                  </strong>
                                  <small>{text}</small>
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <div className="all-clear">
                        <CircleCheck size={18} />
                        Every active account has quota to spare.
                      </div>
                    )}
                    {attention.length > 6 && (
                      <button
                        className="link-button"
                        onClick={() => {
                          setSort('remaining');
                          go('quota');
                        }}
                      >
                        {attention.length - 6} more
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </section>
                  <section className="card" aria-labelledby="endpoint-title">
                    <div className="card-header">
                      <div>
                        <h2 id="endpoint-title">Client endpoint</h2>
                        <p>OpenAI-compatible base URL</p>
                      </div>
                    </div>
                    <div className="copy-field">
                      <code>{baseUrl}/v1</code>
                      <button
                        className="icon-button"
                        onClick={copyEndpoint}
                        aria-label="Copy endpoint"
                        title="Copy endpoint"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <button className="link-button" onClick={() => go('setup')}>
                      Set up a client
                      <ArrowRight size={14} />
                    </button>
                  </section>
                </div>
              </div>
            </>
          )}
          {page === 'quota' && (
            <>
              <div className="capacity-grid">
                <button
                  className={`capacity ${filter === 'all' ? 'selected' : ''}`}
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                >
                  <span className="capacity-head">
                    <LayoutGrid size={16} />
                    <strong>All providers</strong>
                    <small>{accounts.length} accounts</small>
                  </span>
                  <span className="capacity-value">
                    <strong
                      className={ready === accounts.length ? 'green' : 'yellow'}
                    >
                      {ready}/{accounts.length}
                    </strong>
                    <small>ready</small>
                  </span>
                  <span className="segments">
                    {activeProviders.map((provider) => (
                      <Bar key={provider} value={capacity(provider).average} />
                    ))}
                  </span>
                  <span className="capacity-foot">
                    <Clock3 size={12} />
                    {syncLabel}
                  </span>
                </button>
                {activeProviders.map((provider) =>
                  capacityCard(provider, () =>
                    setFilter(filter === provider ? 'all' : provider),
                  ),
                )}
              </div>
              <section
                className="card flush"
                aria-labelledby="quota-section-title"
              >
                <div className="card-header">
                  <div>
                    <h2 id="quota-section-title">
                      {filter === 'all'
                        ? 'All accounts'
                        : `${info(filter).name} accounts`}
                      <span className="count">{visible.length}</span>
                    </h2>
                    <p id="expiry-help">
                      {connected
                        ? 'Auto-prioritize prefers unused Claude, Codex, and Grok Build quota in its last 15 minutes.'
                        : 'Connect your proxy to auto-prioritize expiring quota.'}
                      {expiry.boosted.length > 0 &&
                        ` ${expiry.boosted.length} prioritized now.`}
                    </p>
                  </div>
                  <label className="expiry-control">
                    <span>Auto-prioritize</span>
                    <button
                      className={`switch ${expiry.enabled ? 'on' : ''}`}
                      role="switch"
                      aria-checked={expiry.enabled}
                      aria-label="Auto-prioritize expiring quota"
                      aria-describedby="expiry-help"
                      disabled={expiryBusy || !connected}
                      onClick={async () => {
                        const version = generation.current;
                        setExpiryBusy(true);
                        try {
                          const result = await api<Expiry>('/expiry', 'PUT', {
                            enabled: !expiry.enabled,
                          });
                          if (version !== generation.current) return;
                          setExpiry(result);
                          await loadSnapshot();
                        } catch (error) {
                          if (version === generation.current) {
                            notify(message(error), true);
                            await loadSnapshot().catch(() => {});
                          }
                        } finally {
                          setExpiryBusy(false);
                        }
                      }}
                    >
                      <span />
                    </button>
                  </label>
                </div>
                {expiry.error && (
                  <p className="inline-error" role="alert">
                    {expiry.error}
                  </p>
                )}
                <div className="toolbar">
                  <label className="search-field">
                    <Search size={15} />
                    <input
                      data-search
                      placeholder="Search accounts"
                      aria-label="Search accounts"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query ? (
                      <button
                        className="icon-button"
                        onClick={() => setQuery('')}
                        aria-label="Clear search"
                      >
                        <X size={13} />
                      </button>
                    ) : (
                      <kbd>/</kbd>
                    )}
                  </label>
                  <div className="toolbar-group">
                    <label className="select-control">
                      <ArrowDownUp size={13} />
                      <select
                        aria-label="Sort accounts"
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                      >
                        <option value="provider">Provider</option>
                        <option value="reset">Soonest reset</option>
                        <option value="remaining">Lowest remaining</option>
                        <option value="priority">Highest priority</option>
                      </select>
                    </label>
                    <div className="segmented" role="group" aria-label="Layout">
                      <button
                        aria-pressed={view === 'ledger'}
                        onClick={() => setView('ledger')}
                        aria-label="List layout"
                        title="List layout"
                      >
                        <List size={15} />
                      </button>
                      <button
                        aria-pressed={view === 'cards'}
                        onClick={() => setView('cards')}
                        aria-label="Card layout"
                        title="Card layout"
                      >
                        <LayoutGrid size={15} />
                      </button>
                    </div>
                    <button
                      className="icon-button bordered"
                      onClick={toggleEmails}
                      aria-pressed={reveal}
                      aria-label={reveal ? 'Hide emails' : 'Show emails'}
                      title={reveal ? 'Hide emails' : 'Show emails'}
                    >
                      {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button
                      className="secondary compact"
                      onClick={() => setLimitDisplayOpen(true)}
                      aria-label="Limit display"
                      title="Limit display"
                    >
                      <SlidersHorizontal size={14} />
                      <span className="hide-sm">Limit display</span>
                    </button>
                  </div>
                </div>
                <div className={view === 'cards' ? 'account-cards' : 'ledger'}>
                  {visible.length === 0 ? (
                    <div className="empty-state">
                      <Search size={22} />
                      <h3>
                        {accounts.length
                          ? 'No matching accounts'
                          : 'Your account pool is empty'}
                      </h3>
                      <p>
                        {accounts.length
                          ? 'Try a different search or provider.'
                          : 'Add your first account to start tracking quotas.'}
                      </p>
                      <button
                        className="secondary"
                        onClick={() =>
                          accounts.length
                            ? (setQuery(''), setFilter('all'))
                            : setAddProvider('claude')
                        }
                      >
                        {accounts.length ? 'Clear filters' : 'Add account'}
                      </button>
                    </div>
                  ) : sort === 'provider' && view === 'ledger' ? (
                    providers.map((provider) => {
                      const group = visible.filter(
                        (a) => a.provider === provider,
                      );
                      return (
                        group.length > 0 && (
                          <section className="provider-group" key={provider}>
                            <h3 className="group-heading">
                              <Brand provider={provider} small />
                              {info(provider).name}
                              <span>{group.length}</span>
                            </h3>
                            {group.map(accountRow)}
                          </section>
                        )
                      );
                    })
                  ) : (
                    visible.map(accountRow)
                  )}
                </div>
              </section>
              <div className="subscription-grid">
                <GrokBotUsage display={limitDisplay} />
                <CursorUsage
                  active={connected}
                  display={limitDisplay}
                  saveDisplay={saveLimitDisplay}
                />
              </div>
            </>
          )}
          {page === 'providers' && (
            <>
              <div className="provider-grid">
                {activeProviders.map((provider) => {
                  const group = accounts.filter((a) => a.provider === provider);
                  return (
                    <section className="card provider-panel" key={provider}>
                      <div className="provider-panel-heading">
                        <Brand provider={provider} />
                        <div>
                          <h2>{info(provider).name}</h2>
                          <p>{info(provider).description}</p>
                        </div>
                        <span className="badge green">
                          {group.length} connected
                        </span>
                      </div>
                      <div className="provider-accounts">
                        {group.map((account) => {
                          const window = limitsHidden(account, limitDisplay)
                            ? undefined
                            : weekly(account);
                          return (
                            <button
                              key={account.id}
                              onClick={() => setSelected(account)}
                            >
                              <span
                                className={`status-dot ${account.disabled ? 'gray' : account.unavailable ? 'red' : ''}`}
                              />
                              <span className="mono">{label(account)}</span>
                              <small>{account.plan || 'OAuth'}</small>
                              <span className="mini-meter">
                                <Bar value={window?.remaining} />
                                <small className={tone(window?.remaining)}>
                                  {window?.remaining == null
                                    ? '—'
                                    : `${Math.round(window.remaining)}%`}
                                </small>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        className="secondary compact"
                        onClick={() => setAddProvider(provider)}
                      >
                        <Plus size={14} />
                        Connect another {info(provider).name} account
                      </button>
                    </section>
                  );
                })}
              </div>
              {providers.some(
                (provider) =>
                  !localSubscriptions.includes(provider) &&
                  !activeProviders.includes(provider),
              ) && (
                <section className="card more-providers">
                  <div className="card-header">
                    <div>
                      <h2>Add a provider</h2>
                      <p>Sign in with OAuth to add its accounts to the pool.</p>
                    </div>
                  </div>
                  <div className="provider-chips">
                    {providers
                      .filter(
                        (provider) =>
                          !localSubscriptions.includes(provider) &&
                          !activeProviders.includes(provider),
                      )
                      .map((provider) => (
                        <button
                          key={provider}
                          className="secondary"
                          onClick={() => setAddProvider(provider)}
                        >
                          <Brand provider={provider} small />
                          {info(provider).name}
                          <Plus size={14} />
                        </button>
                      ))}
                  </div>
                </section>
              )}
              <h2 className="section-title">Subscriptions on this Mac</h2>
              <div className="subscription-grid">
                <GrokBotUsage display={limitDisplay} />
                <CursorUsage
                  active={connected}
                  display={limitDisplay}
                  saveDisplay={saveLimitDisplay}
                />
              </div>
            </>
          )}
          {page === 'routing' && (
            <RoutingPage
              routing={routing}
              accounts={accounts}
              connected={connected}
              reveal={reveal}
              save={async (next) => {
                if (connected) await api('/routing', 'PUT', next);
                setRouting(next);
                notify(`${connected ? '' : 'Demo: '}Routing settings saved.`);
              }}
              manage={setSelected}
              notify={notify}
            />
          )}
          {page === 'setup' && (
            <SetupPage
              baseUrl={baseUrl}
              accounts={accounts}
              connected={connected}
              notify={notify}
            />
          )}
          <GitHubWorkspace
            page={page}
            header={pages[page]}
            go={go}
            notify={notify}
            onSummary={setGithub}
          />
        </main>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleAlert size={16} /> : <Check size={16} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {paletteOpen && (
        <CommandPalette
          commands={commands}
          close={() => setPaletteOpen(false)}
        />
      )}
      {connectOpen && (
        <ConnectionModal
          connected={connected}
          baseUrl={baseUrl}
          close={() => setConnectOpen(false)}
          disconnect={disconnect}
          onConnected={async (url) => {
            generation.current++;
            setBaseUrl(url);
            setConnected(true);
            setStartupError('');
            setAccounts([]);
            await loadSnapshot();
            setConnectOpen(false);
            notify('Proxy connected. Refresh all to load live quotas.');
          }}
        />
      )}
      {selected && (
        <AccountModal
          account={accounts.find((a) => a.id === selected.id) || selected}
          reveal={reveal}
          close={() => setSelected(null)}
          update={updateAccount}
          limitDisplay={
            limitDisplay.accounts[selected.id] || { hidden: false, windows: [] }
          }
          providerLimitsHidden={limitDisplay.providers.includes(
            selected.provider,
          )}
          saveLimitDisplay={(display) =>
            saveLimitDisplay({
              ...limitDisplay,
              accounts: { ...limitDisplay.accounts, [selected.id]: display },
            })
          }
          originalPriority={
            expiry.boosted.find((boost) => boost.id === selected.id)
              ?.originalPriority
          }
        />
      )}
      {limitDisplayOpen && (
        <LimitDisplayModal
          providers={providers}
          display={limitDisplay}
          save={saveLimitDisplay}
          close={() => setLimitDisplayOpen(false)}
        />
      )}
      {addProvider && (
        <OAuthModal
          provider={addProvider}
          connected={connected}
          setProvider={setAddProvider}
          close={() => setAddProvider(null)}
          connect={() => {
            setAddProvider(null);
            setConnectOpen(true);
          }}
          finished={async () => {
            await loadSnapshot();
            setAddProvider(null);
            notify('Account connected. Refresh its quota to inspect limits.');
          }}
        />
      )}
    </div>
  );
}
