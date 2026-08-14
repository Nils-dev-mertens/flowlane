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
├── container.ts          tsyringe DI — lazy platform service factories
├── tokens.ts             DI injection tokens
├── types/index.ts        Shared types (Ticket, PullRequest, FlowlaneConfig, …)
├── config/
│   └── ConfigService.ts  Multi-profile config — reads/writes config.json
├── services/
│   ├── interfaces/       ITicketService, IPRService, IGitService, IConfigService
│   ├── azuredevops/      Azure DevOps ticket + PR service implementations
│   ├── github/           GitHub REST/GraphQL client, issue, and PR services
│   ├── jira/             Jira stubs (planned)
│   └── git/              GitService — wraps git CLI via child_process
├── commands/             One file per CLI command
└── utils/
    ├── branch.ts         Branch name generation and ticket ID parsing
    ├── azureBoard.ts     Fetch board columns via Azure DevOps Work API
    └── boardStatusFix.ts Interactive recovery when a status update fails
```

To add a new platform: implement the interfaces under `src/services/<platform>/` and add a `case` in the two factories in `src/container.ts`. No changes to commands are needed. Provider tests belong under `tests/`, are automatically included by `npm test`, mock `fetch`, and must never contact a live repository.

---

## Publishing

Publishing to npm is handled automatically by the GitHub Actions workflow on every push to `main`. The workflow verifies the `NPM_TOKEN` GitHub secret with `npm whoami`, builds, publishes, and only then persists the version bump. If a previous publish failed after its version bump was pushed, the workflow reuses that unpublished version instead of incrementing again.

`NPM_TOKEN` must belong to an npm account that owns or can publish the `flowlane` package and must have publish/write permission. A missing, expired, or unauthorized token commonly appears as an npm `E404` during `PUT /flowlane`; check the `Verify npm authentication` step first.

If you need to bump a minor or major version, update `package.json` manually before merging to `main`.
