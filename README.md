<img src="public/favicon.svg" width="48" height="48" alt="AccountDeck">

# AccountDeck

AccountDeck combines GitHub account routing with AI provider and subscription management. One React workspace manages local GitHub identities, folder and remote routes, repository scans, paired computers, agent commands, proxy quotas, Cursor Enterprise usage, and limit visibility.

The GitHub backend includes the MIT-licensed routing library from [multi-github-account](https://github.com/Sma-Das/multi-github-account). The full CLI and paired-computer service are maintained here in [packages/github-router](packages/github-router/README.md). It uses the same `~/.config/ghr/config.json` and `machines.json`, so existing routes and computer pairings appear immediately. The existing `ghr` CLI and Git credential helper continue to own command execution and credentials.

## GitHub workspace

Install Python 3.9 or newer and GitHub CLI alongside Node.js. Sign in to each account with `gh auth login`, then open **GitHub accounts**. AccountDeck reads account metadata from the CLI; GitHub tokens stay in its credential store. **Add GitHub account** provides a sign-in command to run on the selected computer.

- **Folder routing** creates, edits, removes, searches, and filters routes. Existing folders and signed-in accounts are required. A checkout with remote-specific routes needs an explicit assignment for each remote.
- **Repositories** scans a workspace folder for up to 200 checkouts and shows remote assignments. Routes on a primary checkout also apply to its linked worktrees.
- **Computers** reuses existing pairings and accepts complete GitHub router session URLs. The pairing fragment is stored only in the private machine registry. Each paired computer needs its existing `ghr` dashboard service running.
- **Agent commands** generates `ghr exec` commands for Codex, Claude Code, Grok, OpenCode, and GitHub CLI. Install the `ghr` CLI on the computer where the command runs. `ghr setup` configures routing for ordinary HTTPS Git commands.

The **GitHub computer** picker applies to GitHub accounts, routes, and scans. AI providers use the proxy configured on the AccountDeck host. An unreachable computer shows an error and never falls back to editing local routes. Pairing and unpairing do not change the other computer's accounts or services.

GitHub controls have an independent HTTP-only workspace session and remain usable while the AI proxy is offline or disconnected. GitHub metadata requests use a fixed Python worker with bounded input and output; they cannot execute arbitrary CLI commands. `GHR_PYTHON` selects the interpreter and `GHR_CONFIG` overrides the shared route configuration. Tests use temporary configuration and fake accounts.

The macOS installer keeps the existing service label, data directory, and Tailscale endpoint for upgrades. It checks Python and GitHub CLI before replacing the current release and leaves the standalone GitHub dashboard services and URLs running.

The AI workspace connects to [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). A saved local proxy connection opens live accounts automatically. Without one, AI pages show labeled sample data while GitHub uses real local data. Switch between light and dark themes in the sidebar.

## Install the GitHub router

The CLI, HTTPS Git credential helper, and paired-computer server are included in this repository. Existing `ghr` installations, folder routes, and GitHub CLI logins continue to work. New installations can use Homebrew:

```sh
brew tap Sma-Das/accountdeck https://github.com/Sma-Das/AccountDeck.git
brew install --HEAD Sma-Das/accountdeck/ghr
```

Or install with pipx:

```sh
pipx install 'git+https://github.com/Sma-Das/AccountDeck.git#subdirectory=packages/github-router'
```

See the [router guide](packages/github-router/README.md) for per-folder authentication, multiple remote accounts, CLI commands, and computer pairing. The paired-computer service remembers authenticated browsers across tabs and restarts using signed HTTP-only cookies. Open its full session URL once per browser and use `--persistent-session` for restart persistence. This service's browser sessions and AccountDeck's workspace sessions are separate.

## Run locally

Requires Node.js 22 or newer, npm, Python 3.9 or newer, and GitHub CLI.

```sh
git clone https://github.com/Sma-Das/AccountDeck.git
cd AccountDeck
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite serves the dashboard and forwards `/api` to the local console server on port 4318.

To run the production build:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4318**. Set `PORT` to change the production server port. Both servers bind to loopback. The console can connect to a proxy elsewhere on your trusted network, including a Tailscale hostname.

To install a persistent macOS service and share the console through Tailscale HTTPS and MagicDNS:

```sh
npm run service:install
npm run service:status
```

The installer prints the HTTPS URL, starts the app at login, and preserves existing Tailscale routes. See [Tailscale service setup](docs/tailscale.md) for device access, updates, logs, and removal.

## Connect CLIProxyAPI

On macOS, the installed console reads `~/Library/Application Support/CLIProxyAPI/connection.json` and connects each new browser automatically. Reloading, using another device, or restarting the console restores live mode without re-entering the management key. The server keeps the key private and issues an HTTP-only browser-session cookie. The configured console uses its tailnet-only endpoint for access.

The connection file contains `baseUrl` and `managementKey`. Its optional `autoPrioritize` flag defaults to `true`; changing the quota page's switch saves that preference for the next restart. Set `CONSOLE_CONNECTION_FILE` to another private connection file, or `none` for manual connections. The macOS installer preserves that environment setting across updates. Disconnect selects demo mode for that browser.

For a manual connection:

1. Start an existing CLIProxyAPI instance that exposes the **v8 management API**.
2. Select **Connect proxy** and enter its base URL, normally `http://localhost:8317`, and its management key.
3. Select **Refresh all** to inspect the Claude, Codex, and Grok accounts on that proxy.

### Reuse existing native sign-ins

If you already use Claude Code, Codex, Grok, Antigravity CLI, or OpenCode on this Mac, reuse those local logins:

```sh
npm run native:install
npm run native:status
```

The bridge discovers Codex's `~/.codex/auth.json`, Claude Code's macOS Keychain entry, Grok's `~/.grok/auth.json`, Antigravity CLI's macOS Keychain entry, and OpenCode's local OpenAI OAuth login. Antigravity reads the `gemini` service's `antigravity` account, with `~/.gemini/antigravity-cli/antigravity-oauth-token` as a fallback when the Keychain entry is absent. Consumer Google OAuth logins are supported; enterprise and API-key sessions are skipped. It also discovers custom Claude and Codex homes configured in T3 Code's provider instances. Native sources appear in the console beside each account.

The bridge syncs once a minute into CLIProxyAPI's `~/.cli-proxy-api` credential directory. It exports access tokens and account metadata. Refresh tokens stay with the original CLI. Near expiry, Claude Code, Codex, Grok, and Antigravity CLI refresh their own logins through metadata-only CLI commands. Antigravity uses `agy models`. OpenCode token updates are picked up from its credential store. No model prompt is sent during discovery or refresh. Proxy priorities and pause settings are preserved when tokens change.

Use `CLIPROXY_NATIVE_AUTH_DIR=/absolute/auth/directory npm run native:install` for a proxy configured with another credential directory. `npm run native:sync` performs a single sync. `npm run native:uninstall` stops the bridge and removes its exported credentials. The installed bridge lives outside the checkout and starts at login. Its status and logs are under `~/Library/Application Support/CLIProxy Native Auth/`.

Accounts that have never been signed in locally can still be added through **Add AI account**. Native discovery finds the logins available to these local profiles, not every subscription owned by an email address.

The proxy’s management key and client API keys are different. The console uses the management key to administer the proxy. Coding clients use a client key configured on that proxy.

### Cursor subscription usage

The Cursor card on Quota management and AI providers tracks a Cursor subscription independently of proxy routing. Select **Connect Cursor** and follow the dialog to paste your `WorkosCursorSessionToken` cookie from your signed-in Cursor dashboard. Personal and Enterprise accounts are supported. The console reads Cursor's dashboard usage summary, including available personal spending limits, Cursor Models and Other Models pools, on-demand usage, and pooled team spending. Missing limits stay unknown; only an explicit Cursor response marks access unlimited.

The server stores the session in `~/Library/Application Support/CLIProxy Console/cursor-connection.json` with owner-only file permissions, outside installed releases and git worktrees. The browser does not retain the token. Usage refreshes once a minute while the card is open, and its refresh button requests an immediate update. **Manage subscription** lets you reconnect an expired session or disconnect and delete the saved session. This uses Cursor's undocumented dashboard endpoint, which may change. It does not require a team admin API key or export the subscription into CLIProxyAPI.

### Grok Bot subscription usage

The Grok Bot card on Quota management and AI providers shows the weekly limit for a Grok Bot subscription. It is separate from the Grok Build accounts on the proxy, which use xAI OAuth through CLIProxyAPI. Install and sign in to the Grok Bot desktop app on the Mac that runs AccountDeck. No connection step is needed.

AccountDeck reads the usage reading that Grok Bot saves in `~/Library/Application Support/Grok Bot/sand-client-persistence`. It reads only that cache. It never reads Grok Bot's encrypted credentials or the Keychain, and it sends no network requests. The reading is as current as Grok Bot's last refresh, and the card shows when it was saved. Open Grok Bot to update a stale reading. When a weekly reset passes after the last reading, the card marks the remaining quota unknown rather than showing last week's value. Set `GROK_BOT_DATA_DIR` to read another data directory, or `none` to turn the card off.

### Hide limits

Select **Limit display** on Quota management to hide a provider's limits, such as Grok frontier access. **Manage account** can hide all limits for one account or selected model windows. Cursor's **Manage subscription** offers the same controls for its model and spending pools. Grok Bot appears in **Limit display** beside the proxy providers. Settings persist in the current browser and are scoped to the connected proxy. Hidden windows are omitted from capacity summaries, reset ordering, and the next-reset display. Hiding limits changes the display; proxy routing and automatic priority continue to use real provider data.

For remote proxy connections, enable remote management in CLIProxyAPI. See the [v8 management API documentation](https://help.router-for.me/management/apiv8) for authentication and configuration. Earlier releases that only expose `/v0/management` are not supported.

## What works

- **Quota management:** per-account remaining percentages, reset countdowns, aggregate provider summaries, search, provider filters, ledger and card layouts, and sorting by reset time, remaining quota, or priority. Stale values and failed refreshes are labeled.
- **Provider management:** start, poll, and cancel OAuth login for Claude, Codex, Antigravity, xAI (shown as Grok Build), and Kimi. Forward a matching callback URL when signing in from another machine.
- **Account controls:** pause or resume accounts and edit routing priority through the management API.
- **Routing:** configure round robin, fill first, or existing weighted round robin; enable session affinity.
- **Expiring quota:** enable **Auto-prioritize · 15m** on the quota page to prefer unused Claude, Codex, and Grok quota before reset.
- **Client setup:** discover account models and copy configuration for Claude Code, Codex, or an OpenAI-compatible cURL request. Client configuration files are not edited automatically.
- **Overview:** inspect the proxy’s account readiness, next weekly reset, and client endpoint.

Percentages always mean **remaining quota**. Provider totals add account percentages and treat each account equally; they are not token estimates or plan-weighted capacity. For example, 409% of 500% means five accounts have a combined 409 percentage points remaining.

“Soonest reset” changes the ledger’s order. Higher account priorities affect new sessions, while established session bindings take precedence when affinity is enabled.

## Auto-prioritize expiring quota

Turn on **Auto-prioritize · 15m** on the quota page. The server checks live Claude, Codex, and Grok quotas every minute, including while the browser is closed. An account with remaining quota and a reset within 15 minutes gets a temporary priority above the other accounts for that provider. When several accounts are due, the earliest reset gets the highest priority. This sends your normal requests to those accounts; it does not generate requests or change the requested model.

The console restores the saved priority after reset, depletion, pausing, a quota-check failure, or disabling the feature. Changing a boosted account's priority in the console changes the priority that will be restored. External priority edits take precedence for the current window. Existing affinity bindings stay bound to their accounts.

The setting is shared by connections to the same proxy. A configured proxy runs independently of browser sessions and resumes its saved automation preference after restart. Manual connections run until the last session disconnects or expires after 12 hours of inactivity; a server restart turns their automation off. Graceful shutdown restores priorities. After an interrupted shutdown, connecting to the proxy recovers journaled changes. The recovery file contains proxy URLs, credential names, and priorities, never management keys or provider tokens. It defaults to `~/Library/Application Support/CLIProxy Console/expiry-priorities.json` on macOS and `$XDG_STATE_HOME/cliproxy-console/expiry-priorities.json` elsewhere. Set `CONSOLE_EXPIRY_STATE` to override its location.

Claude Pro uses Fable through usage credits, as described in [Claude's plan documentation](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan). The Pro ledger and account dialog link to Claude's credit balance; Fable is excluded from included-quota windows and automatic expiry prioritization. Account summaries prefer the overall weekly limit. Unknown legacy Fable fields are not assigned an invented weekly period.

Quota checks distinguish rate limits from authentication failures. HTTP 429 retains dated usage and respects the provider's `Retry-After` header. Without a retry time, the backend waits five minutes and doubles the delay after consecutive limits, up to an hour. Background and manual refreshes share that cooldown, and concurrent refreshes share one request. HTTP 429 does not ask users to sign in again.

Live quota inspection supports **Claude, Codex, and Grok** through CLIProxyAPI’s authenticated upstream request endpoint. Other providers can be connected and managed but display unavailable quota in live mode. Demo quota values for other providers are examples. Upstream quota APIs may change or reject expired credentials; the dashboard reports those failures without inventing limits.

## Local data and credentials

Manually entered management keys and normalized quota caches stay in server memory. A configured proxy's key is read from its private connection file. A random HTTP-only, SameSite cookie identifies each browser session. Browser sessions expire after 12 hours; a configured proxy automatically creates a new session when needed. Disconnecting deletes the browser session immediately. Provider tokens remain in CLIProxyAPI; the console does not download credential files.

Client keys entered in the setup page stay in component memory. Email visibility and theme preferences are saved in browser storage. Fonts are bundled locally. No analytics or telemetry is included.

The backend exposes specific console actions, requires a custom request header, checks request origins, rejects upstream redirects, and limits upstream requests to 20 seconds. It does not expose an arbitrary upstream request forwarding endpoint. Avoid publishing this local console on the internet.

## Development and validation

```sh
npm test
npm run build
npm run format:check
```

Tests cover credential redaction, management authentication, request-origin checks, session invalidation, quota normalization and provider failures, unsupported accounts, v8 mutation payloads, model discovery, and OAuth callback validation. They use a mock proxy and do not make requests to your provider accounts.

The frontend uses React, TypeScript, Vite, and Lucide icons. The backend uses Express. The integration follows [CLIProxyAPI’s v8 contract](https://help.router-for.me/management/apiv8), its [management console’s quota implementations](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/tree/main/src/features/quota/providers), and the [official Codex configuration reference](https://developers.openai.com/codex/config-reference/).

## Source and migration

AccountDeck is the combined successor to `Sma-Das/cliproxyapi` and `Sma-Das/multi-github-account`. Their histories remain in the archived repositories. This public repository starts with a source-only commit. Private runtime configuration and credentials stay outside the checkout. See [migration details](docs/migration.md) for source revisions and package layout.

AccountDeck and the included GitHub router use the [MIT license](LICENSE).
