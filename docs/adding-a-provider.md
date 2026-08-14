# Adding a provider

flowlane separates **ticketing** (`ITicketService`) from **pull requests / VCS** (`IPRService`). A provider can implement either or both, so combinations such as Jira + GitHub or Jira + Azure DevOps are supported without fake PR stubs.

## Where things live

```text
src/
├── container.ts                  Registers each service for the configured provider
├── config/
│   ├── providerRegistry.ts       Declarative provider specs (fields, legacy mapping)
│   └── providers.ts              Pure provider-resolution helpers + fallback
├── services/
│   ├── interfaces/
│   │   ├── ITicketService.ts     Ticket contract (read, list, update, create)
│   │   └── IPRService.ts         Pull-request contract (create, review, merge, …)
│   ├── github/                   GitHub REST/GraphQL client + ticket + PR services
│   ├── azuredevops/              Azure DevOps ticket + PR services
│   └── jira/                     Jira REST v3 client + ticket service
└── types/index.ts                Ticket, PRThread, FlowlaneConfig, CreateTicketParams, …
```

Tests live under `tests/`, are discovered automatically by `npm test`, mock `fetch`, and must never contact a live repository.

## Steps to add a ticket provider

1. Implement `ITicketService` under `src/services/<provider>/<Provider>TicketService.ts`:

   ```ts
   import { injectable, inject } from 'tsyringe';
   import type { ITicketService } from '../interfaces/ITicketService';
   import type { IConfigService } from '../interfaces/IConfigService';
   import type { CreateTicketParams, Ticket } from '../../types';
   import { TOKENS } from '../../tokens';

   @injectable()
   export class ExampleTicketService implements ITicketService {
     constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {}

     async getTicket(id: string): Promise<Ticket> { /* … */ }
     async getTicketsForUser(user: string): Promise<Ticket[]> { /* … */ }
     async updateStatus(id: string, state: string, boardColumn?: string): Promise<void> { /* … */ }
     async createTicket(params: CreateTicketParams): Promise<Ticket> { /* … */ }
   }
   ```

2. Add a `ProviderSpec` entry in `src/config/providerRegistry.ts` (id, kind, label, config fields, and legacy mapping), extend `TicketProvider`/`ProviderBlocks` in `src/types/index.ts`, and add the ticket factory case in `src/container.ts`. The setup wizard, `config set`, and validation pick the new provider up automatically.

3. `createTicket` must map the provider-neutral `kind` (`issue` | `task` | `bug` | `story`) and optional fields to the provider's own model. If a field cannot be represented, throw a clear error naming the field — never silently drop it.

4. If the provider has a native work-item hierarchy (e.g. Jira subtasks, Azure DevOps parent-child links), map `parentId` to that hierarchy. Jira uses a `Sub-task` issue type plus a `parent` key; Azure DevOps adds a `System.LinkTypes.Hierarchy-Reverse` relation. Providers without hierarchy (GitHub) throw a clear error.

## Steps to add a VCS/PR provider

1. Implement `IPRService` under `src/services/<provider>/<Provider>PRService.ts` (see `GitHubVcsService` and `AzureDevOpsPRService` for reference implementations).

2. Add a `ProviderSpec` entry in `src/config/providerRegistry.ts` with kind `vcs` (or `both`), extend `VcsProvider`/`ProviderBlocks` in `src/types/index.ts`, and add the PR factory case in `src/container.ts`.

   A ticket-only provider (such as Jira) must **not** implement `IPRService`. The `resolveVcsProvider` helper already refuses to resolve a ticket-only platform as a VCS.

## Configuration

Providers are selected independently and each has its own typed, nested config block:

```json
{
  "ticketProvider": "jira",
  "vcsProvider": "github",
  "jira":   { "site": "acme.atlassian.net", "project": "PRJ", "token": "…", "user": "jane@acme.com" },
  "github": { "owner": "acme", "repo": "web", "token": "…", "user": "janedoe" }
}
```

- `FlowlaneConfig` holds a `Partial<…>` block per provider (`github`, `azuredevops`, `jira`).
- The provider registry declares each provider's fields and how legacy flat keys (`org`, `project`, `token`, …) map into its block.
- `IConfigService.getProviderConfig(provider)` returns the resolved block; services read **only** their own block.
- Legacy flat fields are auto-mapped on read so existing configs keep working; new profiles use nested blocks.

To add a provider, extend the registry and the `ProviderBlocks`/`FlowlaneConfig` types — the setup wizard, `config set`, and validation all pick it up automatically.

## Tests

- Add tests under `tests/<provider>/` using mocked `fetch` (or the provider's HTTP client) so no live credentials or repositories are contacted.
- `npm test` discovers them automatically.
- `npm run build` must stay clean — tests must not be emitted into `dist/`.

## Error and secret hygiene

- Surface provider API errors with the useful part of the message (see `GitHubApiClient.restError` and `extractApiError` in the Azure DevOps service).
- Never log tokens, authorization headers, or credentials.
- For writes and privileged operations, fail locally with a clear "credential required" message before making an unauthenticated request.
