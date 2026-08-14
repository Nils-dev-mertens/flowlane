# Development

This guide covers local setup, project architecture, and how to contribute to flowlane.

---

## Local setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd flowlane

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Link globally so the `flowlane` command is available everywhere
npm link
```

To verify:

```bash
flowlane --version
```

---

## Scripts

```bash
npm run dev -- tickets     # run via ts-node without building
npm run build              # compile TypeScript to dist/
npm run build:watch        # watch mode
npm test                   # discover and run all tests under tests/
npm run clean              # remove dist/
```

---

## Publishing boundary

Production TypeScript lives under `src/` and is compiled to `dist/`. Tests live under `tests/` and are intentionally outside the production compiler input. `npm test` discovers every `*.test.ts` file under `tests/` through `tests/run.ts`, so new tests do not require changing the npm script. The `package.json` `files` allowlist publishes only `dist/`, `README.md`, and `LICENSE.md`; `npm run build` clears `dist/` first so stale test output cannot be published.

Verify the package contents without creating an archive:

```bash
npm pack --dry-run
```

---

## Architecture

```
src/
├── index.ts              Entry point & CLI command definitions
├── container.ts          tsyringe DI — lazy ticket + VCS provider factories
├── tokens.ts             DI injection tokens
├── types/index.ts        Shared types (Ticket, PullRequest, FlowlaneConfig, …)
├── config/
│   ├── ConfigService.ts       Multi-profile config — reads/writes config.json
│   ├── providerRegistry.ts    Declarative provider specs (fields, legacy mapping)
│   └── providers.ts           Pure provider resolution + `platform` fallback
├── services/
│   ├── interfaces/       ITicketService, IPRService, IGitService, IConfigService
│   ├── azuredevops/      Azure DevOps ticket + PR service implementations
│   ├── github/           GitHub REST/GraphQL client, issue, and PR services
│   ├── jira/             Jira REST v3 client and ticket service (ticket-only)
│   └── git/              GitService — wraps git CLI via child_process
├── commands/             One file per CLI command
└── utils/
    ├── branch.ts         Branch name generation and ticket ID parsing
    ├── azureBoard.ts     Fetch board columns via Azure DevOps Work API
    └── boardStatusFix.ts Interactive recovery when a status update fails
```

Ticketing and VCS/PR providers are resolved independently via `ticketProvider`/`vcsProvider` (with `platform` as a backward-compatible alias). Each provider has a typed, nested config block (`github`, `azuredevops`, `jira`); legacy flat keys are auto-mapped into those blocks on read. The provider registry (`src/config/providerRegistry.ts`) is the single source of truth for wizard prompts, `config set`, and validation. To add a provider, implement the relevant interface under `src/services/<provider>/`, add a registry entry and a `case` in the matching factory in `src/container.ts` — no command changes are needed. See [docs/adding-a-provider.md](./docs/adding-a-provider.md) for the full checklist. Provider tests belong under `tests/`, are automatically included by `npm test`, mock `fetch`, and must never contact a live repository.

---

## Publishing

Publishing to npm is handled automatically by the GitHub Actions workflow on every push to `main`. The workflow authenticates with the `NPM_TOKEN` GitHub secret, verifies npm access, runs all tests and the build, publishes only when those steps pass, and only then persists the version bump. If a previous publish failed after its version bump was pushed, the workflow reuses that unpublished version instead of incrementing again.

Create a **granular npm access token** with read/write access to the `flowlane` package and enable 2FA bypass if npm requires it for automation publishing. Store the token in the GitHub repository under **Settings → Secrets and variables → Actions → New repository secret** with the exact name `NPM_TOKEN`. Never commit the token or print it in logs. The workflow passes it through `NODE_AUTH_TOKEN` only to npm commands.

If tests fail, the publish step is never reached. The version commit and push also happen only after npm publish succeeds.

If you need to bump a minor or major version, update `package.json` manually before merging to `main`.
