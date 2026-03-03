# flowlane

> **Ticket → Branch → PR** — Agile board workflow automation for the command line.

Build a TypeScript CLI tool that automates the daily developer workflow from agile board item to pull request. Platform-agnostic, designed to support Azure DevOps Boards and Jira.

---

## Name

| Candidate | Rationale |
|-----------|-----------|
| **flowlane** ✓ | Kanban *lanes* + forward *flow*; short, vendor-agnostic |
| `tickflow` | Ticket pipeline |
| `kanrun` | Kanban + run/execute |
| `swimlane` | Classic kanban term |
| `boardctl` | Board control, kubectl-style |

`flowlane` chosen: lane-progression metaphor, no vendor reference, works as a CLI command.

---

## Core workflow

`view ticket → create branch → push → open PR → link work item → set ticket to "Ready for Review"`

---

## Commands

| Command | Description |
|---------|-------------|
| `flowlane` | Alias for `flowlane tickets` |
| `flowlane tickets [--user <u>]` | Interactive TUI ticket picker |
| `flowlane branch <ticketId>` | Fetch ticket, generate branch name, create & push |
| `flowlane pr <ticketId>` | Create PR and link work item |
| `flowlane review <ticketId> [--status <s>]` | Set ticket status (default: *Ready for Review*) |
| `flowlane start <ticketId>` | Full workflow: branch → PR → review |
| `flowlane init` | Interactive setup wizard |
| `flowlane config get <key>` | Print one config value |
| `flowlane config set <key> <value>` | Update a config value |
| `flowlane config list` | Print all config values |

---

## Interactive TUI (`@clack/prompts`)

Triggered by `flowlane tickets` or any command run without arguments:

- Styled header showing configured project and current user
- Searchable/filterable list of open tickets assigned to the user (id, title, status)
- After selecting a ticket, action menu: create branch · create PR · set to review · view details · full start flow
- Spinners during API calls
- Clear success/error feedback with details (branch name, PR URL)
- Keyboard navigation and ESC cancellation

---

## Configuration

Stored at `~/.config/flowlane/config.json`. Auto-created on first run via `init` wizard.

| Key | Required | Description |
|-----|----------|-------------|
| `platform` | ✓ | `azuredevops` or `jira` |
| `org` | ✓ | ADO org name or Jira subdomain |
| `project` | ✓ | Project / board name |
| `repo` | — | Git repo name (defaults to `project`) |
| `token` | ✓ | PAT / API token |
| `user` | ✓ | Email or display name |
| `baseBranch` | — | PR target (default: `main`) |
| `baseUrl` | — | Self-hosted ADO / Jira URL |

If config is missing, auto-run `init`. Validate required fields before API calls; provide actionable errors.

Azure DevOps PAT scopes: **Work Items** Read+Write · **Code** Read+Write · **Pull Request Threads** Read+Write

---

## Architecture

```
src/
├── index.ts              Entry point & Commander setup
├── container.ts          tsyringe DI — lazy platform factories
├── tokens.ts             DI injection tokens
├── types/index.ts        Shared domain types (Ticket, PR, …)
├── config/
│   └── ConfigService.ts  IConfigService — reads/writes config.json
├── services/
│   ├── interfaces/
│   │   ├── IConfigService.ts   get<T>, set, exists, validate
│   │   ├── ITicketService.ts   getTicket, getTicketsForUser, updateStatus
│   │   ├── IGitService.ts      createBranch, publishBranch, getCurrentBranch
│   │   └── IPRService.ts       createPR, linkWorkItem
│   ├── azuredevops/
│   │   ├── AzureDevOpsTicketService.ts   WIQL + work item updates
│   │   └── AzureDevOpsPRService.ts       Git PR API + work item refs
│   ├── jira/
│   │   ├── JiraTicketService.ts   Stub
│   │   └── JiraPRService.ts       Stub
│   └── git/
│       └── GitService.ts    Wraps `git` CLI via child_process
├── commands/
│   ├── init.ts       Setup wizard
│   ├── tickets.ts    Interactive TUI picker
│   ├── branch.ts     Branch creation flow
│   ├── pr.ts         PR creation flow
│   ├── review.ts     Status transition
│   ├── start.ts      Orchestrates branch + pr + review
│   └── config.ts     Config get/set/list
└── utils/
    ├── branch.ts     generateBranchName() → feature/<id>-<slug>
    └── display.ts    Chalk formatting helpers
```

### Dependency injection

Use `tsyringe` with `instanceCachingFactory` (lazy singletons). Register services in `src/container.ts` based on `platform` from config. Container is valid before `init` runs — factories read platform at resolution time, not registration time.

To add a provider: implement the interfaces under `src/services/<provider>/`, add a `case` in the two factories in `container.ts`. No command changes needed.

---

## Tech stack

`typescript` · `commander` · `@clack/prompts` · `tsyringe` · `reflect-metadata` · `chalk` · `azure-devops-node-api`

```json
{
  "compilerOptions": {
    "target": "ES2020", "module": "CommonJS",
    "experimentalDecorators": true, "emitDecoratorMetadata": true,
    "strict": true, "esModuleInterop": true
  }
}
```

---

## Installation

```bash
git clone <repo> && cd flowlane
bun install        # or npm install
bun run build      # or npm run build
npm link           # makes `flowlane` available globally
```

## Development

```bash
bun run dev -- tickets     # run via ts-node
bun run build              # compile to dist/
```

## Example config

```json
{
  "platform": "azuredevops",
  "org": "my-company",
  "project": "MyProject",
  "repo": "MyRepo",
  "token": "<pat>",
  "user": "jane.doe@my-company.com",
  "baseBranch": "main"
}
```
