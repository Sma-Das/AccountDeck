import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Github,
  FolderGit2,
  Laptop,
  Bot,
  LayoutDashboard,
  Menu,
  Moon,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Terminal,
  X,
} from 'lucide-react';
import {
  api,
  createDemo,
  info,
  masked,
  providerInfo,
  relative,
  errorMessage as message,
} from './types';
import type { Account, Expiry, Page, Quota, Routing } from './types';
import { Brand, Meter } from './components/ui';
import { ConnectionModal } from './components/ConnectionModal';
import { AccountModal } from './components/AccountModal';
import { OAuthModal } from './components/OAuthModal';
import { RoutingPage } from './components/RoutingPage';
import { SetupPage } from './components/SetupPage';
import { GitHubWorkspace } from './components/GitHubWorkspace';
import { CursorUsage } from './components/CursorUsage';
import { CreditAccessNote } from './components/CreditAccessNote';
import { LimitDisplayModal } from './components/LimitDisplayModal';
import {
  displayWindow,
  limitsHidden,
  readLimitDisplay,
  visibleWindows,
} from './limit-display';
import type { LimitDisplay } from './limit-display';

const nav = [
  { id: 'overview' as Page, label: 'Overview', icon: LayoutDashboard },
  { id: 'github-accounts' as Page, label: 'GitHub accounts', icon: Github },
  { id: 'github-routes' as Page, label: 'Folder routing', icon: FolderGit2 },
  { id: 'github-repositories' as Page, label: 'Repositories', icon: Search },
  { id: 'github-machines' as Page, label: 'Computers', icon: Laptop },
  { id: 'github-agents' as Page, label: 'Agent commands', icon: Bot },
  { id: 'quota' as Page, label: 'Quota management', icon: Gauge },
  { id: 'providers' as Page, label: 'AI providers', icon: Network },
  {
    id: 'routing' as Page,
    label: 'Routing & affinity',
    icon: SlidersHorizontal,
  },
  { id: 'setup' as Page, label: 'Client setup', icon: Terminal },
];
const titles: Record<Page, string> = {
  overview: 'AccountDeck overview',
  'github-accounts': 'GitHub accounts',
  'github-routes': 'Folder routing',
  'github-repositories': 'Repositories',
  'github-machines': 'Computers',
  'github-agents': 'Agent commands',
  quota: 'Quota management',
  providers: 'AI providers',
  routing: 'Routing & affinity',
  setup: 'Client setup',
};
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
    return nav.some((n) => n.id === id) ? (id as Page) : 'overview';
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
      if (nav.some((n) => n.id === id)) setPage(id as Page);
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
  const loaded = accounts.filter(
    (a) => visibleWindows(a, limitDisplay).length,
  ).length;
  const nextReset = accounts
    .filter((a) => !a.disabled && Date.parse(weekly(a)?.resetsAt || '') > now)
    .sort(
      (a, b) =>
        Date.parse(weekly(a)!.resetsAt!) - Date.parse(weekly(b)!.resetsAt!),
    )[0];
  const currentName = nav.find((n) => n.id === page)!.label;

  function accountRow(account: Account) {
    const accountWindows = visibleWindows(account, limitDisplay);
    const hidden =
      limitsHidden(account, limitDisplay) ||
      (!!account.quota?.windows.length && !accountWindows.length);
    const stale =
      !!account.quota?.updatedAt &&
      now - Date.parse(account.quota.updatedAt) > 5 * 60000;
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
          <div>
            <strong>
              {reveal
                ? account.email || account.name
                : masked(account.email || account.name)}
            </strong>
            <span>
              {(view === 'cards' || sort !== 'provider') && (
                <span>{info(account.provider).name} ·</span>
              )}
              {account.quota?.plan || account.plan || 'OAuth account'}
              {account.nativeSource && (
                <span className="priority-label">{account.nativeSource}</span>
              )}
              {account.priority !== 0 && (
                <span className="priority-label">P{account.priority}</span>
              )}
              {expiry.boosted.some((boost) => boost.id === account.id) && (
                <span className="priority-label expiring">
                  Auto-prioritized
                </span>
              )}
              {account.disabled && (
                <span className="priority-label">Paused</span>
              )}
              {!account.disabled && account.unavailable && (
                <span className="priority-label warning">Unavailable</span>
              )}
            </span>
          </div>
        </button>
        <div className="account-meters">
          {accountWindows.length ? (
            accountWindows.map((window) => (
              <Meter key={window.id} window={window} now={now} />
            ))
          ) : (
            <div className="quota-missing">
              <span>
                {hidden
                  ? 'Limits hidden'
                  : account.quota?.error || 'Quota has not been loaded'}
              </span>
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
              (connected &&
                !['claude', 'codex', 'xai'].includes(account.provider))
            }
            onClick={() => refreshAccount(account)}
            aria-label={`Refresh ${info(account.provider).name} account ${reveal ? account.email || account.name : masked(account.email || account.name)}`}
            title={
              connected &&
              !['claude', 'codex', 'xai'].includes(account.provider)
                ? 'Quota inspection is not supported for this provider'
                : 'Refresh quota'
            }
          >
            <RefreshCw
              size={16}
              className={loadingIds.has(account.id) ? 'spin' : ''}
            />
          </button>
          <button
            className="icon-button"
            aria-label={`Manage ${info(account.provider).name} account ${reveal ? account.email || account.name : masked(account.email || account.name)}`}
            title="Manage account"
            onClick={() => setSelected(account)}
          >
            <Settings2 size={16} />
          </button>
        </div>
        <CreditAccessNote account={account} />
        {!hidden &&
          ((account.quota?.error && accountWindows.length > 0) || stale) && (
            <div className="row-warning">
              {account.quota?.error ||
                'Quota is over 5 minutes old. Refresh for current limits.'}
            </div>
          )}
      </article>
    );
  }

  const summaryCards = (
    <div className="provider-summary">
      {providers
        .filter(
          (provider) =>
            ['claude', 'codex', 'xai', 'kimi'].includes(provider) ||
            accounts.some((account) => account.provider === provider),
        )
        .map((provider) => {
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
          const hiddenCount = group.length - shown.length;
          const allHidden =
            limitDisplay.providers.includes(provider) ||
            (group.length > 0 && !shown.length);
          const values = shown
            .map((a) => weekly(a)?.remaining)
            .filter((v): v is number => v != null);
          const total = Math.round(
            values.reduce((sum, value) => sum + value, 0),
          );
          const reset = shown
            .map((a) => weekly(a)?.resetsAt)
            .filter((v): v is string => !!v && Date.parse(v) > now)
            .sort()[0];
          return (
            <button
              key={provider}
              className={`summary-card ${page === 'quota' && filter === provider ? 'selected' : ''}`}
              aria-pressed={page === 'quota' && filter === provider}
              onClick={() => {
                setFilter(provider);
                go('quota');
              }}
            >
              <div className="summary-heading">
                <span>
                  <Brand provider={provider} small />
                  {info(provider).name}
                </span>
                <small>
                  {group.length} {group.length === 1 ? 'account' : 'accounts'}
                </small>
              </div>
              <div className="summary-label">
                {allHidden
                  ? 'Limit display'
                  : labels.length === 1
                    ? labels[0]
                    : 'Visible capacity'}
              </div>
              <div className="summary-value">
                {allHidden ? 'Hidden' : values.length ? `${total}%` : '—'}
                <span>
                  {allHidden
                    ? 'limits'
                    : values.length
                      ? `of ${values.length * 100}%`
                      : 'not available'}
                </span>
              </div>
              <div className="segments">
                {shown.length ? (
                  shown.map((a) => {
                    const value = weekly(a)?.remaining;
                    return (
                      <div key={a.id} className="track">
                        <span
                          className={
                            value == null
                              ? 'muted'
                              : value <= 20
                                ? 'red'
                                : value < 65
                                  ? 'yellow'
                                  : 'green'
                          }
                          style={{ width: `${value || 0}%` }}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div className="track" />
                )}
              </div>
              <div className="summary-reset">
                <Clock3 size={12} />
                {allHidden
                  ? 'Limits hidden'
                  : reset
                    ? `Next reset ${relative(reset, now)}`
                    : 'No reset data'}
                {!allHidden && hiddenCount > 0 && ` · ${hiddenCount} hidden`}
              </div>
            </button>
          );
        })}
      <CursorUsage
        summary
        active={connected}
        display={limitDisplay}
        saveDisplay={saveLimitDisplay}
      />
    </div>
  );

  if (initializing) {
    return (
      <main className="connection-startup" aria-busy={initializing}>
        <Terminal size={28} />
        <h1>Opening AccountDeck…</h1>
        {startupError && (
          <>
            <p role="alert">{startupError}</p>
            <button
              className="primary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </>
        )}
      </main>
    );
  }

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
          <span className="brand-symbol">
            <Terminal size={22} />
          </span>
          <div>
            <strong>AccountDeck</strong>
          </div>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Network size={16} />
          </span>
          <div>
            <strong>Personal workspace</strong>
          </div>
          <span className={`status-dot ${connected ? '' : 'yellow'}`} />
        </div>
        <div className="nav-label">Workspace</div>
        <nav aria-label="Console">
          {nav.map((item, index) => (
            <div key={item.id}>
              {index === 1 && <div className="nav-label">GitHub</div>}
              {index === 6 && <div className="nav-label">AI tools</div>}
              <button
                className={page === item.id ? 'active' : ''}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => go(item.id)}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.id === 'quota' && <small>{accounts.length}</small>}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="gateway-card">
            <div>
              <span className={`status-dot ${connected ? '' : 'yellow'}`} />
              <strong>
                {connected
                  ? 'Proxy connected'
                  : startupError
                    ? 'Proxy unavailable'
                    : 'AI demo workspace'}
              </strong>
              <span className="local-badge">
                {connected ? 'LIVE' : startupError ? 'OFFLINE' : 'DEMO'}
              </span>
            </div>
            {connected && <p>{new URL(baseUrl).host}</p>}
            <button onClick={() => setConnectOpen(true)}>
              {connected ? 'Manage connection' : 'Connect your proxy'}
              <ArrowUpRight size={14} />
            </button>
          </div>
          <a
            className="sidebar-link"
            href="https://help.router-for.me/"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={17} />
            Documentation
            <ExternalLink size={12} />
          </a>
          <div className="sidebar-footer">
            <span>AccountDeck</span>
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              id="navigation-toggle"
              className="icon-button mobile-toggle"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label={mobileNav ? 'Close navigation' : 'Open navigation'}
              aria-controls="sidebar"
              aria-expanded={mobileNav}
            >
              <Menu size={19} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={12} />
            <strong>{currentName}</strong>
          </div>
          <div className="topbar-right">
            <span className="connection-indicator">
              <span className={`status-dot ${connected ? '' : 'yellow'}`} />
              {connected
                ? 'AI proxy connected'
                : startupError
                  ? 'AI proxy offline'
                  : 'AI demo mode'}
            </span>
            <span className="topbar-divider" />
            <a
              href="https://github.com/router-for-me/CLIProxyAPI"
              target="_blank"
              rel="noreferrer"
            >
              CLIProxyAPI
              <ArrowUpRight size={13} />
            </a>
          </div>
        </header>
        {!connected && !startupError && !page.startsWith('github-') && (
          <div className="demo-banner">
            <span>
              <strong>Demo</strong>
              <span>Sample data</span>
            </span>
            <button onClick={() => setConnectOpen(true)}>
              Connect proxy
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        <main id="main-content" tabIndex={-1}>
          {startupError && (
            <div className="github-error" role="alert">
              <strong>AI proxy unavailable</strong>
              <p>{startupError}</p>
              <button
                className="secondary compact"
                onClick={() => window.location.reload()}
              >
                Retry AI connection
              </button>
            </div>
          )}
          <div className="page-heading">
            <div className="heading-row">
              <div>
                <h1>{titles[page]}</h1>
              </div>
              {!page.startsWith('github-') && page !== 'overview' && (
                <button
                  className="primary"
                  onClick={() => setAddProvider('claude')}
                >
                  <Plus size={16} />
                  Add AI account
                </button>
              )}
            </div>
          </div>
          <GitHubWorkspace page={page} go={go} notify={notify} />
          {page === 'overview' && (
            <div className="section-heading">
              <h2>AI workspace</h2>
              <button className="text-button" onClick={() => go('quota')}>
                Manage AI usage →
              </button>
            </div>
          )}
          {(page === 'quota' || page === 'overview') && (
            <>
              <div className="quota-meta">
                <span className="mono">
                  <span className="status-dot" />
                  {accounts.length} accounts
                  <span className="dot-separator">·</span>
                  <span className="subtle">{loaded} quotas loaded</span>
                </span>
                <div>
                  <span className="last-sync">
                    {connected ? 'Last refreshed' : 'Demo updated'}{' '}
                    {Math.max(0, Math.floor((now - refreshed) / 60000)) < 1
                      ? 'just now'
                      : `${Math.floor((now - refreshed) / 60000)}m ago`}
                  </span>
                  <button
                    className="secondary compact"
                    onClick={refreshAll}
                    disabled={busy}
                  >
                    <RefreshCw size={14} className={busy ? 'spin' : ''} />
                    {busy ? 'Refreshing…' : 'Refresh all'}
                  </button>
                </div>
              </div>
              {summaryCards}
            </>
          )}
          {page === 'quota' && (
            <section
              className="quota-section"
              aria-labelledby="quota-section-title"
            >
              <div className="section-heading">
                <div>
                  <h2 id="quota-section-title">
                    Account quotas
                    <span className="count">{visible.length}</span>
                  </h2>
                </div>
                <div className="expiry-control">
                  <span>Auto-prioritize · 15m</span>
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
                </div>
              </div>
              <p id="expiry-help" className="expiry-help">
                {connected
                  ? 'Prefer unused Claude, Codex, and Grok quota in the last 15 minutes.'
                  : 'Connect your proxy to auto-prioritize expiring quota.'}
                {expiry.boosted.length > 0 &&
                  ` ${expiry.boosted.length} prioritized.`}
              </p>
              {expiry.error && (
                <p className="expiry-error" role="alert">
                  {expiry.error}
                </p>
              )}
              <div className="filter-bar">
                <div className="provider-tabs">
                  <button
                    className={filter === 'all' ? 'active' : ''}
                    aria-pressed={filter === 'all'}
                    onClick={() => setFilter('all')}
                  >
                    <LayoutDashboard size={14} />
                    All providers<span>{accounts.length}</span>
                  </button>
                  {providers
                    .filter((provider) =>
                      accounts.some((a) => a.provider === provider),
                    )
                    .map((provider) => (
                      <button
                        className={filter === provider ? 'active' : ''}
                        aria-pressed={filter === provider}
                        key={provider}
                        onClick={() => setFilter(provider)}
                      >
                        <Brand provider={provider} small />
                        {info(provider).name}
                        <span>
                          {
                            accounts.filter((a) => a.provider === provider)
                              .length
                          }
                        </span>
                      </button>
                    ))}
                </div>
                <div className="view-selector">
                  <select
                    value={view}
                    onChange={(event) => setView(event.target.value)}
                    aria-label="Quota layout"
                  >
                    <option value="ledger">Ledger view</option>
                    <option value="cards">Card view</option>
                  </select>
                  <ChevronDown size={13} />
                </div>
              </div>
              <div className="ledger-toolbar">
                <div className="search-field">
                  <Search size={15} />
                  <input
                    placeholder="Search accounts…"
                    aria-label="Search accounts"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <div>
                  <button
                    className="text-button"
                    onClick={() => setLimitDisplayOpen(true)}
                  >
                    <EyeOff size={14} />
                    Limit display
                  </button>
                  <button
                    className="text-button"
                    onClick={toggleEmails}
                    aria-pressed={reveal}
                  >
                    {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                    {reveal ? 'Hide emails' : 'Show emails'}
                  </button>
                  <div className="sort-control">
                    <ArrowDownUp size={13} />
                    <select
                      aria-label="Sort accounts"
                      value={sort}
                      onChange={(event) => setSort(event.target.value)}
                    >
                      <option value="provider">Provider order</option>
                      <option value="reset">Soonest reset</option>
                      <option value="remaining">Lowest remaining</option>
                      <option value="priority">Highest priority</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className={view === 'cards' ? 'account-cards' : 'ledger'}>
                {visible.length === 0 ? (
                  <div className="empty-state">
                    <Search size={25} />
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
                          <div className="group-heading">
                            <h2>
                              <Brand provider={provider} small />
                              {info(provider).name}
                              <span>{group.length}</span>
                            </h2>
                          </div>
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
          )}
          {page === 'overview' && (
            <div className="overview-grid">
              <section className="panel">
                <div className="panel-title">
                  <h2>Account health</h2>
                  <ShieldCheck size={18} />
                </div>
                <div className="health-value">
                  {ready}
                  <span>/ {accounts.length} ready</span>
                </div>
                <div className="health-bar">
                  <span
                    style={{
                      width: `${accounts.length ? (ready / accounts.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="health-legend">
                  <span>
                    <i className="status-dot" />
                    {ready} ready
                  </span>
                  <span>
                    <i className="status-dot red" />
                    {
                      accounts.filter((a) => a.unavailable && !a.disabled)
                        .length
                    }{' '}
                    unavailable
                  </span>
                  <span>
                    <i className="status-dot gray" />
                    {accounts.filter((a) => a.disabled).length} paused
                  </span>
                </div>
                <button className="text-button" onClick={() => go('providers')}>
                  Manage accounts
                  <ArrowRight size={14} />
                </button>
              </section>
              <section className="panel">
                <div className="panel-title">
                  <h2>Next reset</h2>
                  <Clock3 size={18} />
                </div>
                {nextReset ? (
                  <>
                    <div className="health-value">
                      {relative(weekly(nextReset)?.resetsAt, now).replace(
                        'in ',
                        '',
                      )}
                    </div>
                    <p>
                      <Brand provider={nextReset.provider} small />{' '}
                      {reveal
                        ? nextReset.email || nextReset.name
                        : masked(nextReset.email || nextReset.name)}
                    </p>
                    <p>
                      {Math.round(weekly(nextReset)?.remaining || 0)}% remaining
                      in this window.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSort('reset');
                        go('quota');
                      }}
                    >
                      See reset order
                      <ArrowRight size={14} />
                    </button>
                  </>
                ) : (
                  <p>Refresh account quotas to see upcoming resets.</p>
                )}
              </section>
              <section className="panel wide">
                <div className="panel-title">
                  <h2>Client endpoint</h2>
                  <Terminal size={18} />
                </div>
                <div className="endpoint-line">
                  <code>{baseUrl}/v1</code>
                  <button className="secondary" onClick={() => go('setup')}>
                    Set up a client
                    <ArrowRight size={14} />
                  </button>
                </div>
              </section>
            </div>
          )}
          {page === 'providers' && (
            <>
              <div className="section-intro">
                <h2>
                  Connected providers<span>{accounts.length} accounts</span>
                </h2>
              </div>
              <div className="provider-grid">
                <CursorUsage
                  active={connected}
                  display={limitDisplay}
                  saveDisplay={saveLimitDisplay}
                />
                {providers
                  .filter((provider) => provider !== 'cursor')
                  .map((provider) => {
                    const group = accounts.filter(
                      (a) => a.provider === provider,
                    );
                    return (
                      <section className="provider-panel" key={provider}>
                        <div className="provider-panel-heading">
                          <Brand provider={provider} />
                          <div>
                            <h2>{info(provider).name}</h2>
                          </div>
                          <span
                            className={`badge ${group.length ? 'green' : ''}`}
                          >
                            {group.length
                              ? `${group.length} connected`
                              : 'Not connected'}
                          </span>
                        </div>
                        <div className="provider-accounts">
                          {group.length ? (
                            group.map((account) => (
                              <button
                                key={account.id}
                                onClick={() => setSelected(account)}
                              >
                                <span
                                  className={`status-dot ${account.disabled ? 'gray' : account.unavailable ? 'red' : ''}`}
                                />
                                <span>
                                  {reveal
                                    ? account.email || account.name
                                    : masked(account.email || account.name)}
                                </span>
                                <small>{account.plan || 'OAuth'}</small>
                                <ChevronRight size={14} />
                              </button>
                            ))
                          ) : (
                            <p>No accounts</p>
                          )}
                        </div>
                        <button
                          className="secondary"
                          onClick={() => setAddProvider(provider)}
                        >
                          <Plus size={14} />
                          Connect {info(provider).name}
                        </button>
                      </section>
                    );
                  })}
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
        </main>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleHelp size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
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
