import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CircleAlert,
  Copy,
  FolderGit2,
  GitBranch,
  Github,
  Laptop,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api, errorMessage } from '../types';
import type { Page } from '../types';
import { Modal, PageHeader, Skeleton } from './ui';

type GitHubAccount = {
  host: string;
  account: string;
  state: string;
  active: boolean;
  source: string;
};
type Route = { path: string; host: string; account: string; repo?: string };
type Machine = { name: string; url: string };
type Workspace = {
  accounts: GitHubAccount[];
  mappings: Route[];
  config: string;
  home: string;
  version: string;
  machine: { hostname: string };
};
type Repository = {
  path: string;
  primary: string;
  account: string | null;
  remotes: {
    name: string;
    direction: string;
    host: string;
    repo: string;
    protocol: string;
    account: string | null;
  }[];
};
const empty: Workspace = {
  accounts: [],
  mappings: [],
  config: '',
  home: '',
  version: '',
  machine: { hostname: '' },
};
const key = (route: Route) =>
  JSON.stringify([route.path, route.host, route.repo || '']);
const basename = (path: string) =>
  path.split('/').filter(Boolean).at(-1) || path;
const shellQuote = (value: string) =>
  /^[a-zA-Z0-9_./:@-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
const login = (host: string) =>
  `env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_DEBUG -u DEBUG gh auth login${host === 'github.com' ? '' : ` --hostname ${shellQuote(host)}`} --web`;

export type GitHubSummary = {
  loading: boolean;
  error: boolean;
  accounts: number | null;
  routes: number | null;
  folders: number | null;
  computers: number;
  computer: string;
};

function Avatar({ host, account }: { host: string; account: string }) {
  const [failed, setFailed] = useState(false);
  if (host !== 'github.com' || failed)
    return (
      <span className="avatar" aria-hidden="true">
        {account[0]?.toUpperCase()}
      </span>
    );
  return (
    <img
      className="avatar"
      src={`https://github.com/${encodeURIComponent(account)}.png?size=80`}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function AccountTag({
  host,
  account,
  hue,
}: {
  host: string;
  account: string;
  hue: string;
}) {
  return (
    <span className={`account-tag ${hue}`} title={`${host}/${account}`}>
      <i className="swatch" />@{account}
      {host !== 'github.com' && <small>{host}</small>}
    </span>
  );
}

export function GitHubWorkspace({
  page,
  header,
  go,
  notify,
  onSummary,
}: {
  page: Page;
  header: { title: string; description: string };
  go: (page: Page) => void;
  notify: (text: string, error?: boolean) => void;
  onSummary: (summary: GitHubSummary) => void;
}) {
  const [machine, setMachine] = useState(
    () => sessionStorage.getItem('accountdeck-github-machine') || 'local',
  );
  const [machines, setMachines] = useState<Machine[]>([]);
  const [state, setState] = useState<Workspace>(empty);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [scanPath, setScanPath] = useState('');
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [routeForm, setRouteForm] = useState<Route | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<Route | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairName, setPairName] = useState('');
  const [pairUrl, setPairUrl] = useState('');
  const [unpairing, setUnpairing] = useState<Machine | null>(null);
  const [formError, setFormError] = useState('');
  const [agentRoute, setAgentRoute] = useState('');
  const [agent, setAgent] = useState('codex');
  const [loginHost, setLoginHost] = useState('github.com');
  const [loginOpen, setLoginOpen] = useState(false);
  const version = useRef(0);
  const mounted = useRef(true);
  const active = page === 'overview' || page.startsWith('github-');
  const computer =
    machine === 'local' ? state.machine.hostname || 'This computer' : machine;
  const url = (endpoint: string, target = machine, path?: string) =>
    `/github/${endpoint}?${new URLSearchParams({ machine: target, ...(path ? { path } : {}) })}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      version.current++;
    };
  }, []);
  async function load(target = machine) {
    const requestVersion = ++version.current;
    setLoading(true);
    setReady(false);
    setError('');
    setState(empty);
    setRepositories(null);
    try {
      const [registry, result] = await Promise.allSettled([
        api<{ machines: Machine[] }>('/github/machines'),
        api<Workspace>(url('state', target)),
      ]);
      if (!mounted.current || requestVersion !== version.current) return;
      if (registry.status === 'fulfilled') setMachines(registry.value.machines);
      if (result.status === 'rejected') throw result.reason;
      if (registry.status === 'rejected') throw registry.reason;
      setState(result.value);
      setReady(true);
      const paths = result.value.mappings.map((route) => route.path.split('/'));
      const shared = paths
        .reduce(
          (common, path) =>
            common.filter((part, index) =>
              common
                .slice(0, index + 1)
                .every((value, position) => value === path[position]),
            ),
          paths[0] || [],
        )
        .join('/');
      setScanPath(
        shared.startsWith(`${result.value.home}/`)
          ? shared
          : result.value.home
            ? `${result.value.home}/projects`
            : '',
      );
    } catch (failure) {
      if (mounted.current && requestVersion === version.current)
        setError(errorMessage(failure));
    } finally {
      if (mounted.current && requestVersion === version.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    void load(machine);
  }, [machine]); // Each response belongs to one selected computer.
  function selectMachine(next: string) {
    if (writing.current || scanning || loading) return;
    version.current++;
    setReady(false);
    setLoading(true);
    setState(empty);
    setRepositories(null);
    setMachine(next);
    sessionStorage.setItem('accountdeck-github-machine', next);
    setRouteForm(null);
    setRemoving(null);
    setAgentRoute('');
    setFilter('all');
    setQuery('');
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify('Copied to clipboard.');
    } catch {
      notify(
        'Clipboard access is unavailable. Select and copy the command.',
        true,
      );
    }
  }
  async function write(
    action: () => Promise<unknown>,
    success: string,
    done: () => void,
    refreshTarget: string | null = machine,
  ) {
    if (writing.current) return;
    const target = refreshTarget;
    writing.current = true;
    setBusy(true);
    setFormError('');
    try {
      await action();
      if (!mounted.current) return;
      done();
      notify(success);
      if (target !== null) await load(target);
    } catch (failure) {
      if (mounted.current) setFormError(errorMessage(failure));
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function newRoute(prefill?: Partial<Route>) {
    setFormError('');
    setEditing(false);
    setRouteForm({ path: '', host: 'github.com', account: '', ...prefill });
  }
  async function scan() {
    const requestVersion = version.current;
    setScanning(true);
    setRepositories(null);
    try {
      const result = await api<{ repositories: Repository[] }>(
        url('scan', machine, scanPath),
      );
      if (mounted.current && requestVersion === version.current)
        setRepositories(result.repositories);
    } catch (failure) {
      if (mounted.current && requestVersion === version.current)
        notify(errorMessage(failure), true);
    } finally {
      if (mounted.current) setScanning(false);
    }
  }
  const routes = state.mappings.filter(
    (route) =>
      (filter === 'all' || `${route.host}/${route.account}` === filter) &&
      `${route.path} ${route.host} ${route.account} ${route.repo || ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selectedRoute = state.mappings.find(
    (route) => key(route) === agentRoute,
  );
  const command = selectedRoute
    ? `ghr exec --path ${shellQuote(selectedRoute.path)} --host ${shellQuote(selectedRoute.host)}${selectedRoute.repo ? ` --repo ${shellQuote(selectedRoute.repo)}` : ''} -- ${agent}`
    : '';
  // Each account keeps one colour everywhere so routes are easy to scan.
  const accountKeys = Array.from(
    new Set([
      ...state.accounts.map((account) => `${account.host}/${account.account}`),
      ...state.mappings.map((route) => `${route.host}/${route.account}`),
    ]),
  );
  const hue = (host: string, account: string) =>
    `hue-${Math.max(0, accountKeys.indexOf(`${host}/${account}`)) % 6}`;
  useEffect(() => {
    onSummary({
      loading,
      error: !!error,
      accounts: ready ? state.accounts.length : null,
      routes: ready ? state.mappings.length : null,
      folders: ready
        ? new Set(state.mappings.map((route) => route.path)).size
        : null,
      computers: machines.length + 1,
      computer,
    });
  }, [loading, error, ready, state, machines, computer, onSummary]);

  if (!active || page === 'overview') return null;
  const picker = (
    <label
      className="select-control computer-select"
      title="Computer whose GitHub accounts and routes you are managing"
    >
      <Laptop size={16} />
      <select
        aria-label="GitHub computer"
        value={machine}
        disabled={busy || scanning || loading}
        onChange={(event) => selectMachine(event.target.value)}
      >
        <option value="local">
          {(machine === 'local' && state.machine.hostname) || 'This computer'}
        </option>
        {!machines.some((item) => item.name === machine) &&
          machine !== 'local' && <option value={machine}>{machine}</option>}
        {machines.map((item) => (
          <option key={item.name} value={item.name}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
  const primary =
    page === 'github-routes' ? (
      <button
        className="primary"
        disabled={!ready || busy}
        onClick={() => newRoute()}
      >
        <Plus size={17} />
        Add route
      </button>
    ) : page === 'github-accounts' ? (
      <button
        className="primary"
        disabled={!ready}
        onClick={() => setLoginOpen(true)}
      >
        <Plus size={17} />
        Add account
      </button>
    ) : page === 'github-machines' ? (
      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          setPairName('');
          setPairUrl('');
          setFormError('');
          setPairing(true);
        }}
      >
        <Plus size={17} />
        Pair computer
      </button>
    ) : null;
  const commandBlock = (text: string, placeholder = '') => (
    <div className={`command ${text ? '' : 'empty'}`}>
      <code>{text || placeholder}</code>
      <button
        className="icon-button"
        disabled={!text}
        onClick={() => void copy(text)}
        aria-label="Copy command"
        title="Copy command"
      >
        <Copy size={16} />
      </button>
    </div>
  );
  const routeCounts = state.mappings.reduce(
    (counts, route) =>
      counts.set(
        `${route.host}/${route.account}`,
        (counts.get(`${route.host}/${route.account}`) || 0) + 1,
      ),
    new Map<string, number>(),
  );
  const groups = Array.from(
    routes
      .reduce(
        (map, route) =>
          map.set(route.path, [...(map.get(route.path) || []), route]),
        new Map<string, Route[]>(),
      )
      .entries(),
  )
    .map(
      ([path, list]) =>
        [
          path,
          list.sort(
            (a, b) =>
              Number(!!a.repo) - Number(!!b.repo) ||
              (a.repo || '').localeCompare(b.repo || ''),
          ),
        ] as const,
    )
    .sort(([a], [b]) =>
      basename(a).localeCompare(basename(b), undefined, {
        sensitivity: 'base',
      }),
    );
  const tilde = (path: string) =>
    state.home && (path === state.home || path.startsWith(`${state.home}/`))
      ? `~${path.slice(state.home.length)}`
      : path;
  const unassigned = (repo: Repository) =>
    repo.remotes.filter((remote) => !remote.account).length;
  const shownRepositories = repositories?.filter(
    (repo) => !unassignedOnly || unassigned(repo) > 0,
  );

  return (
    <section className="github-workspace" aria-label="GitHub workspace">
      <PageHeader
        title={header.title}
        description={header.description}
        actions={
          <>
            {picker}
            <button
              className="icon-button bordered"
              disabled={busy || scanning || loading}
              onClick={() => void load()}
              aria-label="Refresh GitHub"
              title="Reload accounts and routes"
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
            {primary}
          </>
        }
      />
      {error && (
        <div className="callout red" role="alert">
          <CircleAlert size={18} />
          <div>
            <strong>GitHub workspace unavailable on {computer}</strong>
            <p>{error}</p>
          </div>
          <button
            className="secondary compact"
            disabled={loading}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}
      {loading && page !== 'github-machines' && (
        <div
          className="card"
          role="status"
          aria-label="Loading GitHub workspace"
        >
          <Skeleton rows={4} />
        </div>
      )}
      {page === 'github-accounts' && ready && (
        <>
          <div className="github-account-grid">
            {state.accounts.map((account) => {
              const id = `${account.host}/${account.account}`;
              const count = routeCounts.get(id) || 0;
              return (
                <article className="card github-card" key={id}>
                  <div className="github-card-head">
                    <Avatar host={account.host} account={account.account} />
                    <div>
                      <h2 title={`@${account.account}`}>@{account.account}</h2>
                      <p>
                        {account.host}
                        {account.active && (
                          <span className="tag">CLI default</span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`badge ${account.state === 'success' ? 'green' : 'red'}`}
                    >
                      {account.state === 'success'
                        ? 'Signed in'
                        : account.state}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Folder routes</dt>
                      <dd>
                        {count ? (
                          <button
                            className="link-button"
                            onClick={() => {
                              setFilter(id);
                              setQuery('');
                              go('github-routes');
                            }}
                          >
                            {count}
                            <ArrowRight size={15} />
                          </button>
                        ) : (
                          'None'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Credentials</dt>
                      <dd>{account.source}</dd>
                    </div>
                  </dl>
                  <button
                    className="secondary compact"
                    onClick={() => {
                      setLoginHost(account.host);
                      setLoginOpen(true);
                    }}
                  >
                    Renew sign-in
                  </button>
                </article>
              );
            })}
          </div>
          {!state.accounts.length && (
            <div className="empty-state card">
              <Github size={25} />
              <h3>No GitHub accounts on {computer}</h3>
              <p>Sign in with GitHub CLI on that computer, then refresh.</p>
              <button className="secondary" onClick={() => setLoginOpen(true)}>
                <Plus size={16} />
                Add account
              </button>
            </div>
          )}
          <p className="footnote">
            Accounts come from GitHub CLI on {computer}. Add or renew
            credentials there, then refresh.
          </p>
        </>
      )}
      {page === 'github-routes' && ready && (
        <>
          <div className="toolbar standalone">
            <label className="search-field">
              <Search size={17} />
              <input
                data-search
                aria-label="Search GitHub routes"
                placeholder="Search folders, repositories, accounts"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button
                  className="icon-button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  <X size={15} />
                </button>
              ) : (
                <kbd>/</kbd>
              )}
            </label>
            <div
              className="chip-group"
              role="group"
              aria-label="Filter routes by account"
            >
              <button
                className="chip"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                All<span>{state.mappings.length}</span>
              </button>
              {Array.from(routeCounts.entries()).map(([id, count]) => {
                const [host, ...rest] = id.split('/');
                const account = rest.join('/');
                return (
                  <button
                    key={id}
                    className={`chip ${hue(host, account)}`}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(filter === id ? 'all' : id)}
                    title={id}
                  >
                    <i className="swatch" />@{account}
                    <span>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {groups.length > 0 && (
            <div className="card flush route-groups">
              {groups.map(([path, list]) => (
                <article className="route-group" key={path}>
                  <div className="route-folder">
                    <FolderGit2 size={18} />
                    <div>
                      <h3>{basename(path)}</h3>
                      <code title={path}>{tilde(path)}</code>
                    </div>
                    <button
                      className="icon-button route-add"
                      disabled={busy}
                      title="Add a repository route in this folder"
                      aria-label={`Add a repository route in ${path}`}
                      onClick={() => newRoute({ path })}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <ul>
                    {list.map((route) => (
                      <li key={key(route)}>
                        <span
                          className={`route-scope ${route.repo ? '' : 'all'}`}
                        >
                          {route.repo ? (
                            <>
                              <GitBranch size={15} />
                              <span>{route.repo}</span>
                            </>
                          ) : (
                            'All repositories'
                          )}
                        </span>
                        <AccountTag
                          host={route.host}
                          account={route.account}
                          hue={hue(route.host, route.account)}
                        />
                        <span className="route-actions">
                          <button
                            className="icon-button"
                            disabled={busy}
                            title="Edit route"
                            aria-label={`Edit route ${route.path}${route.repo ? ` for ${route.repo}` : ''}`}
                            onClick={() => {
                              setFormError('');
                              setEditing(true);
                              setRouteForm(route);
                            }}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-button danger-hover"
                            disabled={busy}
                            title="Remove route"
                            aria-label={`Remove route ${route.path}${route.repo ? ` for ${route.repo}` : ''}`}
                            onClick={() => {
                              setFormError('');
                              setRemoving(route);
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
          {!routes.length && (
            <div className="empty-state card">
              <FolderGit2 size={25} />
              <h3>
                {state.mappings.length
                  ? 'No matching routes'
                  : 'No folder routes yet'}
              </h3>
              <p>
                {state.mappings.length
                  ? 'Try another search or account.'
                  : 'Add a folder route to choose which GitHub account your projects use.'}
              </p>
              {state.mappings.length ? (
                <button
                  className="secondary"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <button className="secondary" onClick={() => newRoute()}>
                  <Plus size={16} />
                  Add route
                </button>
              )}
            </div>
          )}
          <div className="footnote config-path">
            <span>
              A checkout with repository routes needs an assignment for each
              remote. Configuration on {computer}:
            </span>
            <code>{state.config}</code>
            <button
              className="icon-button"
              aria-label="Copy GitHub configuration path"
              title="Copy path"
              onClick={() => void copy(state.config)}
            >
              <Copy size={15} />
            </button>
          </div>
        </>
      )}
      {page === 'github-repositories' && ready && (
        <>
          <form
            className="card scan-card"
            onSubmit={(event) => {
              event.preventDefault();
              void scan();
            }}
          >
            <label htmlFor="github-scan-path">
              Workspace folder on {computer}
            </label>
            <div>
              <input
                id="github-scan-path"
                value={scanPath}
                onChange={(event) => setScanPath(event.target.value)}
                placeholder="/path/to/projects"
                required
                disabled={scanning || busy}
              />
              <button className="primary" disabled={scanning || busy}>
                <Search size={17} />
                {scanning ? 'Scanning…' : 'Scan'}
              </button>
            </div>
            <p>
              Finds up to 200 repositories within five folder levels. Linked
              worktrees inherit their primary checkout’s routes.
            </p>
          </form>
          {scanning && (
            <div className="card" role="status" aria-label="Scanning">
              <Skeleton rows={3} />
            </div>
          )}
          {repositories && repositories.length > 0 && (
            <div className="scan-summary">
              <span>
                <strong>{repositories.length}</strong> repositories ·{' '}
                <strong
                  className={
                    repositories.some((repo) => unassigned(repo) > 0)
                      ? 'yellow'
                      : 'green'
                  }
                >
                  {repositories.reduce(
                    (sum, repo) => sum + unassigned(repo),
                    0,
                  )}
                </strong>{' '}
                remotes without an account
              </span>
              <label className="check-control">
                <input
                  type="checkbox"
                  checked={unassignedOnly}
                  onChange={(event) => setUnassignedOnly(event.target.checked)}
                />
                Only show unassigned
              </label>
            </div>
          )}
          <div className="repo-list">
            {shownRepositories?.map((repo) => (
              <article className="card repo" key={repo.path}>
                <div className="repo-head">
                  <FolderGit2 size={18} />
                  <div>
                    <h3>{basename(repo.path)}</h3>
                    <code>{tilde(repo.path)}</code>
                    {repo.primary !== repo.path && (
                      <small>Worktree of {repo.primary}</small>
                    )}
                  </div>
                  <button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => newRoute({ path: repo.path })}
                  >
                    Set folder default
                  </button>
                </div>
                {repo.remotes.length > 0 ? (
                  <ul className="remote-list">
                    {Array.from(
                      new Map(
                        repo.remotes.map((remote) => [
                          `${remote.name}/${remote.host}/${remote.repo}`,
                          remote,
                        ]),
                      ).values(),
                    ).map((remote) => (
                      <li key={`${remote.name}/${remote.host}/${remote.repo}`}>
                        <span className="remote-name">{remote.name}</span>
                        <code>
                          {remote.host}/{remote.repo}
                        </code>
                        <span className="tag">
                          {remote.protocol.toUpperCase()}
                        </span>
                        {remote.account ? (
                          <AccountTag
                            host={remote.host}
                            account={remote.account}
                            hue={hue(remote.host, remote.account)}
                          />
                        ) : (
                          <span className="tag yellow">No account</span>
                        )}
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() =>
                            newRoute({
                              path: repo.path,
                              host: remote.host,
                              repo: remote.repo,
                              account: remote.account || '',
                            })
                          }
                        >
                          {remote.account ? 'Change' : 'Assign'}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="footnote">No GitHub remotes found.</p>
                )}
              </article>
            ))}
          </div>
          {repositories?.length === 0 && (
            <div className="empty-state card">
              <Search size={25} />
              <h3>No repositories found</h3>
              <p>Try a parent folder or check the path.</p>
            </div>
          )}
        </>
      )}
      {page === 'github-machines' && (
        <>
          <div className="card flush machine-list">
            {[
              {
                id: 'local',
                name: 'This computer',
                detail:
                  (machine === 'local' && state.machine.hostname) ||
                  'AccountDeck host',
              },
              ...machines.map((item) => ({
                id: item.name,
                name: item.name,
                detail: item.url,
              })),
            ].map((item) => (
              <article className="machine-row" key={item.id}>
                <span className="machine-icon">
                  <Laptop size={18} />
                </span>
                <div>
                  <h3>
                    {item.name}
                    {item.id === 'local' && <span className="tag">Local</span>}
                    {machine === item.id && (
                      <span className="tag accent">Managing</span>
                    )}
                  </h3>
                  <code>{item.detail}</code>
                </div>
                {machine !== item.id && (
                  <button
                    className="secondary compact"
                    disabled={busy || scanning || loading}
                    onClick={() => selectMachine(item.id)}
                  >
                    Manage
                  </button>
                )}
                {item.id !== 'local' && (
                  <button
                    className="icon-button danger-hover"
                    disabled={busy || scanning || loading}
                    aria-label={`Unpair ${item.name}`}
                    title="Unpair"
                    onClick={() => {
                      setFormError('');
                      setUnpairing({ name: item.id, url: item.detail });
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </article>
            ))}
          </div>
          <p className="footnote">
            Pair with the complete session URL printed by <code>ghr ui</code>.
            Accounts and credentials stay on their own computer, and each paired
            computer needs its GitHub router service running.
          </p>
        </>
      )}
      {page === 'github-agents' && ready && (
        <>
          {!state.mappings.length && (
            <div className="callout">
              <FolderGit2 size={18} />
              <div>
                <strong>No folder routes on {computer}</strong>
                <p>
                  Agent commands run with the account a folder is routed to.
                </p>
              </div>
              <button
                className="secondary compact"
                onClick={() => go('github-routes')}
              >
                Add a route
                <ArrowRight size={16} />
              </button>
            </div>
          )}
          <div className="agent-layout">
            <section className="card">
              <div className="card-header">
                <div>
                  <h2>Run an agent</h2>
                  <p>
                    The router picks credentials for the folder without
                    switching the CLI default. Requires <code>ghr</code> on{' '}
                    {computer}.
                  </p>
                </div>
              </div>
              <label className="field">
                Folder route
                <select
                  value={agentRoute}
                  onChange={(event) => setAgentRoute(event.target.value)}
                >
                  <option value="">Choose a route</option>
                  {state.mappings.map((route) => (
                    <option key={key(route)} value={key(route)}>
                      {basename(route.path)}
                      {route.repo ? ` · ${route.repo}` : ''} · @{route.account}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span id="agent-label">Agent</span>
                <div
                  className="chip-group"
                  role="group"
                  aria-labelledby="agent-label"
                >
                  {[
                    ['codex', 'Codex'],
                    ['claude', 'Claude Code'],
                    ['grok', 'Grok'],
                    ['opencode', 'OpenCode'],
                    ['gh auth status', 'Identity check'],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      className="chip"
                      aria-pressed={agent === id}
                      onClick={() => setAgent(id)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              {commandBlock(
                command,
                'Choose a folder route to generate the command.',
              )}
            </section>
            <section className="card">
              <div className="card-header">
                <div>
                  <h2>Route ordinary Git</h2>
                  <p>
                    Run inside a checkout on {computer} to install the Git
                    credential helper. HTTPS remotes then follow folder routes.
                  </p>
                </div>
              </div>
              {commandBlock('ghr setup')}
              <p className="footnote">
                Use <code>ghr setup --global</code> for machine-wide routing.
                Unmapped folders stop instead of using another account. SSH
                remotes keep using SSH keys.
              </p>
            </section>
          </div>
        </>
      )}
      {routeForm && (
        <Modal
          title={editing ? 'Edit GitHub route' : 'Add GitHub route'}
          close={() => {
            if (!busy) setRouteForm(null);
          }}
        >
          <form
            className="github-form"
            onSubmit={(event) => {
              event.preventDefault();
              void write(
                () => api(url('mappings'), 'PUT', routeForm),
                `Route saved on ${computer}.`,
                () => setRouteForm(null),
              );
            }}
          >
            <p>Save this route on {computer}.</p>
            <label>
              Folder
              <input
                value={routeForm.path}
                required
                readOnly={editing}
                disabled={busy}
                onChange={(event) =>
                  setRouteForm({ ...routeForm, path: event.target.value })
                }
                placeholder="/path/to/project"
              />
            </label>
            <label>
              GitHub hostname
              <input
                value={routeForm.host}
                required
                readOnly={editing}
                disabled={busy}
                onChange={(event) =>
                  setRouteForm({
                    ...routeForm,
                    host: event.target.value,
                    account: '',
                  })
                }
              />
            </label>
            <label>
              Repository, optional
              <input
                value={routeForm.repo || ''}
                readOnly={editing}
                disabled={busy}
                onChange={(event) =>
                  setRouteForm({ ...routeForm, repo: event.target.value })
                }
                placeholder="OWNER/REPO"
              />
            </label>
            <label>
              GitHub account
              <select
                value={routeForm.account}
                required
                disabled={busy}
                onChange={(event) =>
                  setRouteForm({ ...routeForm, account: event.target.value })
                }
              >
                <option value="">Choose a signed-in account</option>
                {state.accounts
                  .filter(
                    (account) =>
                      account.host === routeForm.host &&
                      account.state === 'success',
                  )
                  .map((account) => (
                    <option key={account.account} value={account.account}>
                      @{account.account}
                    </option>
                  ))}
              </select>
            </label>
            {formError && (
              <p className="github-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save route'}
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal
          title="Remove GitHub route"
          close={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <div className="github-form">
            <p>
              Remove the route for{' '}
              <code>
                {removing.path}
                {removing.repo ? ` · ${removing.repo}` : ''}
              </code>{' '}
              on {computer}? Projects may inherit another folder route after
              removal.
            </p>
            {formError && (
              <p className="github-error" role="alert">
                {formError}
              </p>
            )}
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void write(
                  () => api(url('mappings'), 'DELETE', removing),
                  'GitHub route removed.',
                  () => setRemoving(null),
                )
              }
            >
              {busy ? 'Removing…' : 'Remove route'}
            </button>
          </div>
        </Modal>
      )}
      {pairing && (
        <Modal
          title="Pair a GitHub computer"
          close={() => {
            if (!busy) {
              setPairing(false);
              setPairUrl('');
            }
          }}
        >
          <form
            className="github-form"
            onSubmit={(event) => {
              event.preventDefault();
              void write(
                () =>
                  api('/github/machines', 'PUT', {
                    name: pairName,
                    url: pairUrl,
                  }),
                'Computer paired.',
                () => {
                  setPairing(false);
                  setPairUrl('');
                },
              );
            }}
          >
            <label>
              Computer name
              <input
                required
                pattern="[a-z0-9][a-z0-9_-]{0,47}"
                value={pairName}
                disabled={busy}
                onChange={(event) => setPairName(event.target.value)}
                placeholder="work-mac"
              />
            </label>
            <label>
              Complete GitHub router session URL
              <input
                required
                type="password"
                autoComplete="off"
                value={pairUrl}
                disabled={busy}
                onChange={(event) => setPairUrl(event.target.value)}
                placeholder="https://computer.example/#session-key"
              />
            </label>
            <p>
              Use the complete URL printed by ghr ui, including its session
              fragment. The pairing key is stored privately on this Mac.
            </p>
            {formError && (
              <p className="github-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Checking connection…' : 'Pair computer'}
            </button>
          </form>
        </Modal>
      )}
      {unpairing && (
        <Modal
          title="Unpair computer"
          close={() => {
            if (!busy) setUnpairing(null);
          }}
        >
          <div className="github-form">
            <p>
              Remove {unpairing.name} from AccountDeck? Its accounts, routes,
              and running service will remain on that computer.
            </p>
            {formError && (
              <p className="github-error" role="alert">
                {formError}
              </p>
            )}
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void write(
                  () =>
                    api('/github/machines', 'DELETE', { name: unpairing.name }),
                  'Computer unpaired.',
                  () => {
                    if (machine === unpairing.name) {
                      setReady(false);
                      setLoading(true);
                      setState(empty);
                      setMachine('local');
                      sessionStorage.setItem(
                        'accountdeck-github-machine',
                        'local',
                      );
                    }
                    setUnpairing(null);
                  },
                  machine === unpairing.name ? null : machine,
                )
              }
            >
              {busy ? 'Removing…' : 'Unpair computer'}
            </button>
          </div>
        </Modal>
      )}
      {loginOpen && (
        <Modal
          title="Add or renew a GitHub account"
          close={() => setLoginOpen(false)}
        >
          <div className="github-form">
            <p>
              Run this on {computer}, complete GitHub sign-in, then refresh
              AccountDeck.
            </p>
            <label>
              GitHub hostname
              <input
                value={loginHost}
                onChange={(event) => setLoginHost(event.target.value)}
              />
            </label>
            <div className="github-command">
              <code>{login(loginHost)}</code>
              <button
                className="secondary compact"
                onClick={() => void copy(login(loginHost))}
              >
                <Copy size={16} />
                Copy command
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
