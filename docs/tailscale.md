# Access through Tailscale and MagicDNS

The console can run as a persistent macOS service and accept HTTPS connections from devices on your tailnet. Your Mac must be awake, logged in, and connected to Tailscale. Each client device must also be connected to the tailnet and allowed to reach the selected HTTPS port by your Tailscale access policy.

## Install on macOS

Connect the Mac to Tailscale and enable MagicDNS in your tailnet's DNS settings. HTTPS certificates must also be enabled; Tailscale will show an activation link if they are not available. The console uses the full MagicDNS hostname so its HTTPS certificate is valid.

From a checkout with Node.js 22 or newer, Python 3.9 or newer, GitHub CLI, and npm dependencies installed:

```sh
npm ci
npm run service:install
```

The installer checks Python, GitHub CLI, Tailscale, and existing Serve routes, builds the production app, installs production dependencies in a separate release directory, and starts a macOS launch agent. It forwards HTTPS port **8443** to the console's loopback port **4319**. The separate ports let the local development server and existing services keep running.

Open the printed URL on your other devices. It has the form `https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443`. The hostname comes from `tailscale status --json`. To choose other ports before the first installation:

```sh
CLIPROXY_SERVICE_PORT=4320 CLIPROXY_HTTPS_PORT=9443 npm run service:install
```

The installer refuses to overwrite an existing Serve endpoint or use a port with Funnel enabled. To change ports after installation, uninstall first and install again with the new values. Serve uses a background configuration that persists across Tailscale restarts. See the [official Serve CLI documentation](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Manage the service

```sh
npm run service:status
npm run service:restart
```

`service:install` also updates an existing installation. Each update builds a new release before switching the launch agent. Releases live under `~/Library/Application Support/CLIProxy Console/releases/`; the installed app keeps working when a git worktree is removed or a checkout changes branches.

The launch agent is `~/Library/LaunchAgents/com.cliproxy.console.plist`. It starts when you log in and restarts the process if it exits. Logs are:

```text
~/Library/Application Support/CLIProxy Console/stdout.log
~/Library/Application Support/CLIProxy Console/stderr.log
```

To verify the route:

```sh
tailscale serve status
curl --fail https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443/
curl --fail \
  -H 'X-Console-Request: 1' \
  -H 'Origin: https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443' \
  https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443/api/session
```

The second request creates an independent AccountDeck workspace session and a live AI browser session when the console has a saved local connection at `~/Library/Application Support/CLIProxyAPI/connection.json`. New browsers and devices use that configured proxy automatically. Set `CONSOLE_CONNECTION_FILE` when installing to use another private connection file, or `none` to require manual connections.

Without a configured connection, select **Connect proxy** and enter the existing CLIProxyAPI instance's URL and management key. `localhost` in that form refers to the Mac hosting the console because its backend makes the connection, not the phone or tablet viewing the page. Client setup snippets must use a proxy API URL reachable from the machine where the coding client runs.

The installer pins `CONSOLE_ORIGIN` to the HTTPS MagicDNS URL and any origins in `CLIPROXY_PUBLIC_ORIGINS`. This allows valid browser requests through the reverse proxy while rejecting other origins. Session cookies use Secure when every configured origin uses HTTPS. No provider or management keys are placed in the launch agent or deployment state.

## Use a custom domain

A domain such as `account.example.com` can point at the same backend while staying reachable only over Tailscale:

1. Create a DNS-only A record (not proxied through a CDN) for the hostname with this Mac's Tailscale IPv4 address from `tailscale ip -4`. Devices outside the tailnet can resolve the name but cannot connect to it.
2. Terminate TLS for the hostname with a reverse proxy on loopback that gets its certificate by DNS-01 challenge, such as Caddy with the Cloudflare DNS module, and proxy to `127.0.0.1:4319`. Preserve the `Host` header.
3. Forward the tailnet's HTTPS port to that proxy, for example `tailscale serve --bg --tcp=443 tcp://127.0.0.1:9443`. Keep the MagicDNS route on port 8443.
4. Reinstall with the extra origin. The installer saves it, so later updates keep it:

```sh
CLIPROXY_PUBLIC_ORIGINS=https://account.example.com npm run service:install
```

Separate several origins with commas. Set `CLIPROXY_PUBLIC_ORIGINS=` to an empty value to remove them.

To stop sharing and remove the launch agent:

```sh
npm run service:uninstall
```

Only this console's unchanged Serve endpoint is removed. Other Serve routes remain in place. Archived releases and logs are retained for inspection.

## Other operating systems

Use the production build with your operating system's service manager and configure an explicit HTTPS origin:

```sh
npm ci
npm run build
PORT=4319 CONSOLE_ORIGIN=https://YOUR-MAGICDNS-NAME:8443 npm start
tailscale serve --bg --https=8443 http://127.0.0.1:4319
```

Replace `YOUR-MAGICDNS-NAME` with the full DNS name reported by Tailscale. A service manager must keep `npm start` running independently of your shell. The supplied installer manages macOS launch agents only.

## GitHub routing in AccountDeck

The installed release includes the GitHub routing library and reads the existing `~/.config/ghr/config.json` and `machines.json`. GitHub CLI is invoked from the launch agent's explicit PATH; Python uses the interpreter checked during installation. Routes and computer pairings are shared with the existing `ghr` CLI.

Existing GitHub dashboard services, custom domains, and Tailscale routes remain in place. Paired computers still use those services for remote metadata and route management. AccountDeck serves the combined interface from its existing HTTPS port 8443. No GitHub credentials are copied into the console's release or launch agent.
