import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  FolderGit2,
  Github,
  Laptop,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { api, errorMessage } from '../types';
import type { Page } from '../types';
import { Modal } from './ui';

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

export function GitHubWorkspace({
  page,
  go,
  notify,
}: {
  page: Page;
  go: (page: Page) => void;
  notify: (text: string, error?: boolean) => void;
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

  if (!active) return null;
  return (
    <section className="github-workspace" aria-label="GitHub workspace">
      <div className="github-toolbar">
        <label className="computer-picker">
          <Laptop size={16} />
          <span>GitHub computer</span>
          <select
            aria-label="GitHub computer"
            value={machine}
            disabled={busy || scanning || loading}
            onChange={(event) => selectMachine(event.target.value)}
          >
            <option value="local">
              {(machine === 'local' && state.machine.hostname) ||
                'This computer'}
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
        <div className="github-actions">
          <button
            className="secondary compact"
            disabled={busy || scanning || loading}
            onClick={() => void load()}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh GitHub
          </button>
          {page === 'github-routes' && (
            <button
              className="primary compact"
              disabled={!ready || busy}
              onClick={() => newRoute()}
            >
              <Plus size={14} />
              Add route
            </button>
          )}
          {page === 'github-accounts' && (
            <button
              className="primary compact"
              disabled={!ready}
              onClick={() => setLoginOpen(true)}
            >
              <Plus size={14} />
              Add GitHub account
            </button>
          )}
          {page === 'github-machines' && (
            <button
              className="primary compact"
              disabled={busy}
              onClick={() => {
                setPairName('');
                setPairUrl('');
                setFormError('');
                setPairing(true);
              }}
            >
              <Plus size={14} />
              Pair computer
            </button>
          )}
        </div>
      </div>
      <p className="github-scope">
        GitHub accounts and routes below belong to {computer}. AI providers use
        this Mac's proxy.
      </p>
      {error && (
        <div className="github-error" role="alert">
          <strong>GitHub workspace unavailable</strong>
          <p>{error}</p>
          <p>Select another computer or refresh to retry.</p>
        </div>
      )}
      {loading && (
        <p className="github-empty" role="status">
          Loading GitHub accounts and routes…
        </p>
      )}
      {page === 'overview' && ready && (
        <>
          <div className="section-heading">
            <h2>GitHub workspace</h2>
            <button className="text-button" onClick={() => go('github-routes')}>
              Manage routes
            </button>
          </div>
          <div className="github-stats">
            <button onClick={() => go('github-accounts')}>
              <Github size={18} />
              <strong>{state.accounts.length}</strong>
              <span>GitHub accounts</span>
            </button>
            <button onClick={() => go('github-routes')}>
              <FolderGit2 size={18} />
              <strong>{state.mappings.length}</strong>
              <span>Folder routes</span>
            </button>
            <button onClick={() => go('github-machines')}>
              <Laptop size={18} />
              <strong>{machines.length + 1}</strong>
              <span>Computers</span>
            </button>
          </div>
        </>
      )}
      {page === 'github-accounts' && ready && (
        <>
          <p className="github-help">
            Accounts come from GitHub CLI on {computer}. Add or renew
            credentials on that computer, then refresh here.
          </p>
          <div className="github-account-grid">
            {state.accounts.map((account) => (
              <article
                className="github-card"
                key={`${account.host}/${account.account}`}
              >
                <Github size={22} />
                <div>
                  <h2>@{account.account}</h2>
                  <p>{account.host}</p>
                </div>
                <span
                  className={`badge ${account.state === 'success' ? 'green' : 'red'}`}
                >
                  {account.state === 'success' ? 'Signed in' : account.state}
                </span>
                <dl>
                  <dt>Credential storage</dt>
                  <dd>{account.source}</dd>
                  <dt>CLI default</dt>
                  <dd>
                    {account.active
                      ? 'Active'
                      : 'Folder routes select this account'}
                  </dd>
                  <dt>Routes</dt>
                  <dd>
                    {
                      state.mappings.filter(
                        (route) =>
                          route.account === account.account &&
                          route.host === account.host,
                      ).length
                    }
                  </dd>
                </dl>
                <button
                  className="secondary"
                  onClick={() => {
                    setLoginHost(account.host);
                    setLoginOpen(true);
                  }}
                >
                  Sign in on {computer}
                </button>
              </article>
            ))}
          </div>
          {!state.accounts.length && (
            <p className="github-empty">
              No GitHub accounts are stored on this computer yet.
            </p>
          )}
        </>
      )}
      {page === 'github-routes' && ready && (
        <>
          <div className="github-filters">
            <label className="github-search">
              <Search size={15} />
              <input
                aria-label="Search GitHub routes"
                placeholder="Search folders, accounts, repositories…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="Filter routes by account"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All accounts</option>
              {Array.from(
                new Set(
                  state.mappings.map(
                    (route) => `${route.host}/${route.account}`,
                  ),
                ),
              ).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <p className="github-help">
            Folder routes apply to nested repositories and worktrees. A checkout
            with repository-specific routes requires an assignment for each
            remote.
          </p>
          <div className="github-route-list">
            {routes.map((route) => (
              <article className="github-route" key={key(route)}>
                <FolderGit2 size={20} />
                <div className="github-route-folder">
                  <h2>{basename(route.path)}</h2>
                  <code>{route.path}</code>
                  <span>
                    {route.repo
                      ? `${route.host}/${route.repo}`
                      : `All ${route.host} repositories in this folder`}
                  </span>
                </div>
                <strong>@{route.account}</strong>
                <div className="github-actions">
                  <button
                    className="secondary compact"
                    disabled={busy}
                    aria-label={`Edit route ${route.path}${route.repo ? ` for ${route.repo}` : ''}`}
                    onClick={() => {
                      setFormError('');
                      setEditing(true);
                      setRouteForm(route);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={`Remove route ${route.path}${route.repo ? ` for ${route.repo}` : ''}`}
                    onClick={() => {
                      setFormError('');
                      setRemoving(route);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!routes.length && (
            <div className="github-empty">
              {state.mappings.length
                ? 'No routes match your search.'
                : 'Add a folder route to choose which GitHub account your projects use.'}
            </div>
          )}
          <div className="github-config">
            <span>Routing configuration on {computer}</span>
            <code>{state.config}</code>
            <button
              className="icon-button"
              aria-label="Copy GitHub configuration path"
              onClick={() => void copy(state.config)}
            >
              <Copy size={14} />
            </button>
          </div>
        </>
      )}
      {page === 'github-repositories' && ready && (
        <>
          <form
            className="github-scan"
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
                <Search size={15} />
                {scanning ? 'Scanning…' : 'Scan repositories'}
              </button>
            </div>
          </form>
          <p className="github-help">
            Scans up to 200 repositories within five folder levels. Linked
            worktrees inherit their primary checkout's routes.
          </p>
          {repositories?.map((repo) => (
            <article className="github-repository" key={repo.path}>
              <div className="section-heading">
                <div>
                  <h2>{basename(repo.path)}</h2>
                  <code>{repo.path}</code>
                </div>
                <button
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => newRoute({ path: repo.path })}
                >
                  Set folder default
                </button>
              </div>
              {repo.primary !== repo.path && (
                <p className="github-help">Primary checkout: {repo.primary}</p>
              )}
              <div className="github-remotes">
                {Array.from(
                  new Map(
                    repo.remotes.map((remote) => [
                      `${remote.name}/${remote.host}/${remote.repo}`,
                      remote,
                    ]),
                  ).values(),
                ).map((remote) => (
                  <div key={`${remote.name}/${remote.host}/${remote.repo}`}>
                    <div>
                      <strong>
                        {remote.name}: {remote.host}/{remote.repo}
                      </strong>
                      <span>
                        {remote.account
                          ? `@${remote.account} over ${remote.protocol.toUpperCase()}`
                          : `Unassigned, ${remote.protocol.toUpperCase()}`}
                      </span>
                    </div>
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
                      Assign account
                    </button>
                  </div>
                ))}
              </div>
              {!repo.remotes.length && (
                <p className="github-help">No GitHub remotes found.</p>
              )}
            </article>
          ))}
          {repositories?.length === 0 && (
            <p className="github-empty">
              No repositories found in this folder.
            </p>
          )}
        </>
      )}
      {page === 'github-machines' && (
        <>
          <p className="github-help">
            Pair another computer using its GitHub router session URL. Accounts
            and credentials stay on their own computer. Paired computers need
            their existing GitHub router service running.
          </p>
          <div className="github-machine-list">
            <article className="github-route">
              <Laptop size={20} />
              <div className="github-route-folder">
                <h2>This computer</h2>
                <span>
                  {(machine === 'local' && state.machine.hostname) ||
                    'AccountDeck host'}
                </span>
              </div>
              <span className="badge">Local</span>
            </article>
            {machines.map((item) => (
              <article className="github-route" key={item.name}>
                <Laptop size={20} />
                <div className="github-route-folder">
                  <h2>{item.name}</h2>
                  <code>{item.url}</code>
                </div>
                <button
                  className="secondary compact"
                  disabled={
                    busy || scanning || loading || machine === item.name
                  }
                  onClick={() => selectMachine(item.name)}
                >
                  {machine === item.name ? 'Selected' : 'Select'}
                </button>
                <button
                  className="icon-button"
                  disabled={busy || scanning || loading}
                  aria-label={`Unpair ${item.name}`}
                  onClick={() => {
                    setFormError('');
                    setUnpairing(item);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {page === 'github-agents' && ready && (
        <div className="github-agent-panel">
          <h2>Run an agent with the right GitHub identity</h2>
          <p className="github-help">
            Run this command on {computer}. The router chooses credentials for
            the folder without switching the CLI default. The ghr CLI must be
            installed on that computer.
          </p>
          <label>
            Folder route
            <select
              value={agentRoute}
              onChange={(event) => setAgentRoute(event.target.value)}
            >
              <option value="">Choose a route</option>
              {state.mappings.map((route) => (
                <option key={key(route)} value={key(route)}>
                  {basename(route.path)}
                  {route.repo ? ` (${route.repo})` : ''}, @{route.account}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agent
            <select
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
              <option value="grok">Grok</option>
              <option value="opencode">OpenCode</option>
              <option value="gh auth status">GitHub CLI identity check</option>
            </select>
          </label>
          {command && (
            <div className="github-command">
              <code>{command}</code>
              <button
                className="secondary compact"
                onClick={() => void copy(command)}
              >
                <Copy size={14} />
                Copy command
              </button>
            </div>
          )}
          <h2 className="github-git-title">Route ordinary Git commands</h2>
          <p className="github-help">
            Run this inside a checkout on {computer} to configure its Git
            credential helper. HTTPS remotes then use the folder route.
          </p>
          <div className="github-command">
            <code>ghr setup</code>
            <button
              className="secondary compact"
              onClick={() => void copy('ghr setup')}
            >
              <Copy size={14} />
              Copy setup command
            </button>
          </div>
          <p className="github-help">
            Use <code>ghr setup --global</code> for machine-wide routing.
            Unmapped folders stop instead of using another account. SSH remotes
            use SSH keys.
          </p>
          {!state.mappings.length && (
            <button className="secondary" onClick={() => go('github-routes')}>
              Add a folder route first
            </button>
          )}
        </div>
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
                {removing.repo ? ` (${removing.repo})` : ''}
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
                <Copy size={14} />
                Copy command
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
