# Git worktrees

When changing a repository that has a remote, fetch `origin main` and create a task branch and worktree under `/tmp` from `origin/main`. Work and commit there. Reuse an existing `/tmp` worktree for the same task. Do not create worktrees under `~/.codex/worktrees`.

Commit as work progresses. For a private repository, push and open a PR when done. For a public repository, ask before opening a PR. Remove the task worktree after committing and pushing. Skip worktrees for read-only questions.

# Runtime instructions

When asked to start or share AccountDeck on this Mac, use the production launch agent and Tailscale Serve:

```sh
npm run service:install
npm run service:status
```

The installer builds the app, copies a complete release outside the repository, and installs `com.cliproxy.console` in the current user's macOS launch agents. It starts at login and restarts on exit. Tailscale Serve provides HTTPS through the machine's MagicDNS hostname. The default backend is `127.0.0.1:4319`; the default Tailscale HTTPS port is `8443`.

Preserve existing Tailscale Serve endpoints. The installer refuses port conflicts. Use a separate port instead of replacing another app's route. Keep the backend bound to loopback. Use tailnet-only Serve; do not enable public Funnel unless the user explicitly requests public access.

Run installation from the task worktree, then verify the printed HTTPS URL and a same-origin `/api/session` request. The installed release must not depend on the worktree, so it can be removed after the code is committed and pushed. Deployment does not require merging the PR.

Use `npm run service:restart` to restart the installed release and `npm run service:uninstall` to remove this console's service and Serve endpoint. A service update uses `npm run service:install` again. The installer prepares the new release before stopping the existing service and restores the previous launch agent if startup fails.

See [docs/tailscale.md](docs/tailscale.md) for setup, logs, verification, and other operating systems. Follow the user's git worktree instructions for repository changes.

## Repository layout

The React and Express application lives at the repository root. `packages/github-router` contains the `ghr` CLI, credential helper, and paired-computer service, including persistent browser authentication. `server/github/vendor` is the routing-library snapshot used by the production app. Keep these shared modules consistent when changing routing behavior. The root Homebrew formula installs the Python package from `packages/github-router`.

Run `npm test`, `npm run build`, and `npm run format:check` for application changes. Run `python3 -m unittest discover -s tests -v` from `packages/github-router` for router changes. Tests use isolated configuration and fixture accounts. Never copy runtime connection files, session secrets, or provider credentials into this repository.
