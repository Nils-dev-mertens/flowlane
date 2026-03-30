# flowlane

**Ticket → Branch → PR** — command-line workflow automation for Azure DevOps Boards.

flowlane bridges your Azure DevOps board and your local git workflow. Instead of switching between a browser, terminal, and IDE to manage tickets, create branches, and update statuses — flowlane lets you do all of that from a single CLI.

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

```bash
flowlane init
```

The interactive wizard asks for your platform, organisation, project, token, and user identity, then saves everything to `~/.config/flowlane/config.json`.

For per-repository overrides (e.g. a different profile or base branch):

```bash
flowlane profile local
```

This creates a `.flowlane` file in the current repo that takes precedence over the global profile.

---

## Commands

### `flowlane tickets` — interactive ticket browser

Running `flowlane` with no arguments opens the ticket browser automatically.

```bash
flowlane
flowlane tickets
flowlane tickets --user jane.doe@company.com
```

Opens an interactive TUI that lists your open tickets. From there you can move a ticket to a column, start the full workflow, create a branch, or open a PR — without leaving the terminal.

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

Fetches the ticket, generates a branch name, creates it locally, and pushes it to origin.

```bash
flowlane branch 1234
```

---

### `flowlane pr [ticketId]`

Creates a pull request linked to the work item. The ticket ID is inferred from the current branch name if not provided. Falls back to the interactive picker if neither is available.

```bash
flowlane pr          # infer ticket from current branch
flowlane pr 1234
```

> You must be on a feature branch (not detached HEAD) to create a PR.

---

### `flowlane pr comment <text>`

Adds a comment to the open PR for the current branch. Supports inline comments targeting a specific file and line range.

```bash
flowlane pr comment "LGTM, just one nit below"

# Inline comment on a specific file and line
flowlane pr comment "Extract this into a helper" --file src/utils/branch.ts --line 42

# Multi-line inline comment
flowlane pr comment "This whole block should be simplified" \
  --file src/commands/pr.ts --line 10 --end-line 25
```

| Option | Description |
|--------|-------------|
| `--file <path>` | File path for an inline comment |
| `--line <n>` | Start line (1-based) |
| `--end-line <n>` | End line for a multi-line comment (defaults to `--line`) |

---

### `flowlane review [ticketId]`

Moves a ticket to the "Ready for Review" column (or a custom status). Infers the ticket from the current branch if not provided.

```bash
flowlane review
flowlane review 1234
flowlane review 1234 --status "In Review"
```

---

### `flowlane describe [ticketId]`

Prints the full details of a ticket — ID, title, type, board column, assignee, URL, and description. Infers the ticket from the current branch if not provided.

```bash
flowlane describe
flowlane describe 1234
```

---

### `flowlane init`

Runs the interactive setup wizard. If profiles already exist, it offers to add a new one, configure a local repo override, or list existing profiles.

---

### `flowlane profile`

Manage named profiles. Each profile holds a separate set of credentials and project settings, useful when working across multiple organisations or projects.

```bash
flowlane profile list           # list all profiles
flowlane profile use <name>     # switch the active profile
flowlane profile add [name]     # add a new profile (interactive)
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

Global config is stored at `~/.config/flowlane/config.json` and supports multiple named profiles. A `.flowlane` file in the repo root overrides any value for that repo.

### Core settings

| Key | Required | Description |
|-----|----------|-------------|
| `platform` | ✓ | `azuredevops` (Jira support planned) |
| `org` | ✓ | Azure DevOps organisation name |
| `project` | ✓ | Project name |
| `token` | ✓ | Personal Access Token |
| `user` | ✓ | Your email or display name — used to filter assigned tickets |
| `authMethod` | — | `pat` (default) or `az-cli` — how to authenticate |
| `repo` | — | Git repository name. Defaults to `project` |
| `baseBranch` | — | PR target branch. Defaults to `main` |
| `baseUrl` | — | Self-hosted Azure DevOps URL |
| `team` | — | Azure DevOps team name. Required for board column operations |

### Workflow status mapping

| Key | Description |
|-----|-------------|
| `activeStatus` | `System.State` set when starting work (e.g. `Active`) |
| `activeColumn` | Board column set when starting work (e.g. `Doing`) |
| `reviewStatus` | `System.State` set when moving to review (e.g. `Active`) |
| `reviewColumn` | Board column set when moving to review (e.g. `Ready for Review`) |
| `closedStates` | Comma-separated states excluded from the ticket list. Defaults to `Done,Removed,Closed,Resolved` |

### Post-action hooks

Shell commands to run automatically after a flowlane action completes. Hooks are optional and never block or roll back the main action if they fail.

| Key | Runs after | Available placeholders |
|-----|------------|------------------------|
| `hookAfterBranch` | `flowlane branch` | `{{branch}}`, `{{ticketId}}` |
| `hookAfterPR` | `flowlane pr` | `{{prUrl}}`, `{{prId}}`, `{{ticketId}}`, `{{branch}}` |
| `hookAfterReview` | `flowlane review` | `{{ticketId}}` |
| `hookAfterStart` | `flowlane start` | `{{branch}}`, `{{ticketId}}` — note: `hookAfterBranch` also fires during `start` |
| `hookAfterComment` | `flowlane pr comment` | `{{prId}}`, `{{branch}}` |

```bash
# Open the PR in your browser after creating it
flowlane config set hookAfterPR "open {{prUrl}}"

# Post a Slack message when a branch is pushed
flowlane config set hookAfterBranch "curl -s -X POST $SLACK_WEBHOOK -d '{\"text\":\"Branch {{branch}} is ready\"}'"

# Open VS Code when starting work
flowlane config set hookAfterStart "code ."

# Clear a hook
flowlane config set hookAfterPR ""
```

---

## Example config

### `~/.config/flowlane/config.json`

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
      "reviewColumn": "Ready for Review",
      "hookAfterPR": "open {{prUrl}}"
    }
  }
}
```

### `.flowlane` — repo-level override

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
