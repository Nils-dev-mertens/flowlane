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
npm run clean              # remove dist/
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
│   ├── jira/             Jira stubs (planned)
│   └── git/              GitService — wraps git CLI via child_process
├── commands/             One file per CLI command
└── utils/
    ├── branch.ts         Branch name generation and ticket ID parsing
    ├── azureBoard.ts     Fetch board columns via Azure DevOps Work API
    └── boardStatusFix.ts Interactive recovery when a status update fails
```

To add a new platform: implement the interfaces under `src/services/<platform>/` and add a `case` in the two factories in `src/container.ts`. No changes to commands are needed.

---

## Publishing

Publishing to npm is handled automatically by the GitHub Actions workflow on every push to `main`. The patch version is bumped automatically — no manual `npm publish` needed.

If you need to bump a minor or major version, update `package.json` manually before merging to `main`.
