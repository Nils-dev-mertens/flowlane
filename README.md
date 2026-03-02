# flowlane

> **Ticket → Branch → PR** — Agile board workflow automation for the command line.

`flowlane` automates the daily developer loop: browse your board, create a
well-named branch, push it, open a pull request, link the work item, and
transition the ticket to *In Review* — all without leaving the terminal.

---

## Name candidates

| Name | Rationale |
|------|-----------|
| **flowlane** ✓ | Kanban *lanes* + forward *flow*; short, vendor-agnostic |
| `tickflow` | Ticket pipeline, very direct |
| `kanrun` | Kanban + run/execute |
| `swimlane` | Classic kanban term |
| `boardctl` | Board control, kubectl-style |

`flowlane` was chosen as the strongest: it captures the lane-progression
metaphor without referencing any vendor.

---

## Features

- **Interactive TUI** — searchable ticket picker with action menu (`@clack/prompts`)
- **Auto branch naming** — `feature/<id>-<slugified-title>` from ticket metadata
- **Full workflow** — one command to branch + push + PR + set to review
- **Provider-agnostic** — Azure DevOps fully implemented; Jira stub ready to extend
- **Dependency injection** — `tsyringe` + interfaces; swap providers without touching commands
- **Auto-init** — first run launches the setup wizard automatically

---

## Installation

```bash
# From source
git clone <repo>
cd flowlane
npm install
npm run build
npm link          # makes `flowlane` available globally
```

---

## Quick start

```bash
# First run — launches the setup wizard automatically
flowlane tickets

# Or run the wizard explicitly
flowlane init
```

---

## Commands

| Command | Description |
|---------|-------------|
| `flowlane` | Alias for `flowlane tickets` (interactive TUI) |
| `flowlane tickets [--user <u>]` | Browse & act on assigned tickets |
| `flowlane branch <ticketId>` | Fetch ticket, create branch, push to origin |
| `flowlane pr <ticketId>` | Create PR and link work item |
| `flowlane review <ticketId> [--status <s>]` | Set ticket status (default: *In Review*) |
| `flowlane start <ticketId>` | Full workflow: branch → PR → review |
| `flowlane init` | Interactive setup wizard |
| `flowlane config list` | Print all config values |
| `flowlane config get <key>` | Print one config value |
| `flowlane config set <key> <value>` | Update a config value |

---

## Configuration

Config is stored at `~/.config/flowlane/config.json`.

Run `flowlane init` to create it interactively, or copy
`example.config.json` and edit manually.

### Fields

| Key | Required | Description |
|-----|----------|-------------|
| `platform` | ✓ | Provider: `azuredevops` or `jira` |
| `org` | ✓ | Azure DevOps org name (or Jira subdomain) |
| `project` | ✓ | Project / board name |
| `repo` | — | Git repository name (defaults to `project`) |
| `token` | ✓ | Personal Access Token / API token |
| `user` | ✓ | Your identity string (email or display name) |
| `baseBranch` | — | PR target branch (default: `main`) |
| `baseUrl` | — | Self-hosted ADO / Jira URL |

### Azure DevOps PAT scopes required

- **Work Items** — Read & Write
- **Code** — Read & Write
- **Pull Request Threads** — Read & Write

### Example config

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

---

## Architecture

```
src/
├── index.ts                        Entry point & Commander setup
├── container.ts                    tsyringe DI container (lazy factories)
├── tokens.ts                       DI injection tokens
├── types/
│   └── index.ts                    Shared domain types
├── config/
│   └── ConfigService.ts            IConfigService — reads/writes ~/.config/flowlane/config.json
├── services/
│   ├── interfaces/
│   │   ├── IConfigService.ts
│   │   ├── ITicketService.ts       get/list/updateStatus
│   │   ├── IGitService.ts          createBranch/publishBranch/getCurrentBranch
│   │   └── IPRService.ts           createPR/linkWorkItem
│   ├── azuredevops/
│   │   ├── AzureDevOpsTicketService.ts   WIQL queries + work item updates
│   │   └── AzureDevOpsPRService.ts       Git PR API + work item refs
│   ├── jira/
│   │   ├── JiraTicketService.ts    Stub — contribute to activate
│   │   └── JiraPRService.ts        Stub
│   └── git/
│       └── GitService.ts           Wraps `git` CLI via child_process
├── commands/
│   ├── init.ts                     Setup wizard
│   ├── tickets.ts                  Interactive TUI picker
│   ├── branch.ts                   Branch creation flow
│   ├── pr.ts                       PR creation flow
│   ├── review.ts                   Status transition flow
│   ├── start.ts                    Orchestrates branch + pr + review
│   └── config.ts                   Config get/set/list
└── utils/
    ├── branch.ts                   generateBranchName()
    └── display.ts                  Chalk formatting helpers
```

### Dependency injection

Services are registered in `src/container.ts` using `instanceCachingFactory`
(lazy singletons).  The factory reads `platform` from `ConfigService` at first
resolution, so the container is always valid — even before `flowlane init` has
run.

To add a new provider:

1. Create `src/services/<provider>/MyTicketService.ts` implementing `ITicketService`
2. Add a `case '<provider>':` branch in the two factories in `container.ts`
3. Done — no command code changes needed.

---

## Adding Jira support

The stubs in `src/services/jira/` implement the correct interfaces.  Replace
the method bodies with calls to the [Jira REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/):

```ts
// Example: getTicket
async getTicket(id: string): Promise<Ticket> {
  const baseUrl = this.config.get<string>('baseUrl')
    ?? `https://${this.config.get('org')}.atlassian.net`;
  const resp = await fetch(`${baseUrl}/rest/api/3/issue/${id}`, {
    headers: { Authorization: `Basic ${btoa(`${user}:${token}`)}` },
  });
  const json = await resp.json();
  return { id: json.key, title: json.fields.summary, status: json.fields.status.name };
}
```

Because `JiraTicketService` already implements `ITicketService`, the rest of
the codebase requires zero changes.

---

## Development

```bash
npm run dev -- tickets          # run via ts-node
npm run build                   # compile to dist/
npm run build:watch             # watch mode
```
