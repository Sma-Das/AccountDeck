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

Existing Homebrew installations can continue to run from the archived tap. New installs use the AccountDeck tap. To switch an existing installation, first confirm that its launch agents and Git credential helpers use Homebrew's stable `opt/ghr` path. Then install the AccountDeck formula and run `ghr setup` for any helper that points at an older version-specific path.

The legacy static router demo remains a separate deployment. The source is included under the router package; it does not expose the live AccountDeck server.
