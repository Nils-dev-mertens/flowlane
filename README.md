# flowlane

**Ticket → Branch → PR** — command-line workflow automation for Azure DevOps Boards.

flowlane bridges your Azure DevOps board and your local git workflow. Instead of switching between a browser, terminal, and IDE to manage tickets, create branches, and update statuses, flowlane lets you do all of that from a single CLI.

---

## Installation

```bash
npm install -g flowlane
```

Verify:

```bash
flowlane --version
```

---

## Prerequisites

- **Node.js** 18 or later
- **git** installed and on your `PATH`
- An **Azure DevOps Personal Access Token** with the following scopes:
  - Work Items — Read & Write
  - Code — Read & Write
  - Pull Request Threads — Read & Write

---

## First-time setup

Run the interactive setup wizard:

```bash
flowlane init
```

This will ask for your platform, organisation, project, token, and user identity, then save everything to `~/.config/flowlane/config.json`.

For per-repository overrides (e.g. a different profile or base branch), run:

```bash
flowlane profile local
```

This creates a `.flowlane` file in the current directory that takes precedence over the global profile.

---

## Commands

### Default — interactive ticket picker

```bash
flowlane
# or
flowlane tickets
flowlane tickets --user jane.doe@company.com
```

Opens a TUI that lists your open tickets, lets you filter them, and offers actions: move to a column, start the full workflow, create a branch, or open a PR.

---

### `flowlane start <ticketId>`

Full workflow in one command:

1. Sets the ticket state + board column to the configured "active" values
2. Creates a branch named `<ticketId>-<title-slug>` and pushes it to origin

```bash
flowlane start 1234
```

---

### `flowlane branch <ticketId>`

Fetches the ticket, generates a branch name, creates the branch locally, and pushes it.

```bash
flowlane branch 1234
```

---

### `flowlane pr [ticketId]`

Creates a pull request linked to the work item. If no ticket ID is given, it is inferred from the current branch name. Falls back to the interactive picker if neither is available.

```bash
flowlane pr          # infer ticket from branch name
flowlane pr 1234     # explicit ticket ID
```

> You must be on a git branch (not in a detached HEAD state) to create a PR.

---

### `flowlane review [ticketId]`

Moves a ticket to the "Ready for Review" column (or a custom status via `--status`).

```bash
flowlane review          # infer ticket from branch name
flowlane review 1234
flowlane review 1234 --status "In Review"
```

---

### `flowlane init`

Runs the interactive setup wizard. If profiles already exist, offers to add a new one, configure a local repo override, or list existing profiles.

---

### `flowlane profile`

Manage named profiles (each profile holds a separate set of credentials and project settings).

```bash
flowlane profile list           # list all profiles
flowlane profile add [name]     # add a new profile
flowlane profile use <name>     # switch the active profile
flowlane profile remove <name>  # delete a profile
flowlane profile local          # write a .flowlane file for the current repo
```

---

### `flowlane config`

Read or update individual config values in the active profile.

```bash
flowlane config list
flowlane config get baseBranch
flowlane config set baseBranch develop
```

---

## Configuration reference

Global config is stored at `~/.config/flowlane/config.json` and supports multiple named profiles. A `.flowlane` file in a repo root can override any value for that repo.

| Key | Required | Description |
|-----|----------|-------------|
| `platform` | ✓ | `azuredevops` (Jira support is planned) |
| `org` | ✓ | Azure DevOps organisation name |
| `project` | ✓ | Project name |
| `token` | ✓ | Personal Access Token |
| `user` | ✓ | Your email or display name (used to filter assigned tickets) |
| `repo` | — | Git repository name. Defaults to `project` |
| `baseBranch` | — | PR target branch. Defaults to `main` |
| `team` | — | Azure DevOps team name. Required for board column operations |
| `activeStatus` | — | `System.State` value set when starting work (e.g. `Active`) |
| `activeColumn` | — | Board column set when starting work (e.g. `Doing`) |
| `reviewStatus` | — | `System.State` value set on review (e.g. `Active`) |
| `reviewColumn` | — | Board column set on review (e.g. `Ready for Review`) |
| `closedStates` | — | Comma-separated states to exclude from ticket list (default: `Done,Removed,Closed,Resolved`) |
| `baseUrl` | — | Self-hosted Azure DevOps URL |

### Example config (single profile)

```json
{
  "activeProfile": "work",
  "profiles": {
    "work": {
      "platform": "azuredevops",
      "org": "my-company",
      "project": "MyProject",
      "repo": "MyRepo",
      "token": "<pat>",
      "user": "jane.doe@my-company.com",
      "baseBranch": "main",
      "team": "MyProject Team",
      "activeStatus": "Active",
      "activeColumn": "Doing",
      "reviewStatus": "Active",
      "reviewColumn": "Ready for Review"
    }
  }
}
```

### Example `.flowlane` (repo-level override)

```json
{
  "profile": "work",
  "repo": "some-other-repo",
  "baseBranch": "develop"
}
```

---

## Contributing

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local setup, architecture, and contribution guidelines.

---

## License

MIT
