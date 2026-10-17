# Migration to AccountDeck

The public AccountDeck repository contains the combined application and the complete GitHub router package. The original repositories retain their Git histories as archives. Runtime configuration remains in its existing private locations and is excluded from this repository.

## Source revisions

- Combined application: `Sma-Das/cliproxyapi`, commit `050e10244e6be7c02fa6e87decd8a2fccc93550f` from `feat/unified-account-console`. Includes Cursor Enterprise tracking, limit visibility controls, the GitHub workspace, Claude Pro Fable credit handling, and quota-request backoff.
- GitHub router: `Sma-Das/multi-github-account`, commit `8151ac1a0e1a6a0c928281c8fb79c19e6594c07c` from `fix/tailscale-dashboard-auth`. Based on `main` at `16370c37489fa293f46bad6570d3ca660fed7c8d`. Includes browser pairing with signed HTTP-only cookies, cross-tab authentication, and restart persistence. This local feature commit was included before archiving the original repository.

## Layout

- Repository root: React frontend, Express API, macOS service installers, and application tests.
- `packages/github-router`: complete Python CLI and compatible dashboard service, its setup guide, tests, and static demo sources.
- `Formula/ghr.rb`: Homebrew HEAD installation from the router package in this repository.
- `server/github/vendor`: routing modules used by the installed React application's Python worker. These modules match the router package; browser authentication is implemented in the package's dashboard server.

## Existing installations

AccountDeck keeps the service label `com.cliproxy.console`, the `CLIProxy Console` data directory, and its current Tailscale endpoint. Existing GitHub router services, paired computers, credentials, folder mappings, and browser preferences continue to use their existing locations. Repository migration does not migrate credential stores.

The `sma-das/multi-github-account` Homebrew tap is deprecated and receives no updates. Move existing installations to the AccountDeck tap. First confirm that launch agents and Git credential helpers use Homebrew's stable `bin/ghr` or `opt/ghr` path, then reinstall:

```sh
brew tap Sma-Das/accountdeck https://github.com/Sma-Das/AccountDeck.git
brew uninstall sma-das/multi-github-account/ghr
brew install --HEAD Sma-Das/accountdeck/ghr
brew untap sma-das/multi-github-account
```

Restart any `ghr ui` launch agents afterwards. Run `ghr setup` for any credential helper that points at an older version-specific path. Folder routes, paired computers, and browser sessions are kept, because they live in `~/.config/ghr`.

The legacy static router demo remains a separate deployment. The source is included under the router package; it does not expose the live AccountDeck server.
