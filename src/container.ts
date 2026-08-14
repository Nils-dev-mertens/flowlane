/**
 * Dependency-injection container.
 *
 * Services are registered via lazy factories so the container is valid before
 * the config file exists (e.g. on first run before `flowlane init` completes).
 * The factory reads the provider from the already-saved config at resolution
 * time, not at registration time.
 *
 * Ticketing and VCS/PR providers are resolved independently so combinations
 * such as Jira + GitHub are supported without a Jira PR stub.
 */
import 'reflect-metadata';
import { container, instanceCachingFactory } from 'tsyringe';

import { ConfigService }               from './config/ConfigService';
import { GitService }                   from './services/git/GitService';
import { AzureDevOpsTicketService }     from './services/azuredevops/AzureDevOpsTicketService';
import { AzureDevOpsPRService }         from './services/azuredevops/AzureDevOpsPRService';
import { JiraTicketService }            from './services/jira/JiraTicketService';
import { GitHubTicketService }          from './services/github/GitHubTicketService';
import { GitHubVcsService }             from './services/github/GitHubVcsService';
import { TOKENS }                       from './tokens';

import type { IConfigService } from './services/interfaces/IConfigService';
import type { ITicketService } from './services/interfaces/ITicketService';
import type { IPRService }     from './services/interfaces/IPRService';

let initialised = false;

export function setupContainer(): void {
  if (initialised) return;
  initialised = true;

  // ── Config & Git — always available, no provider dependency ───────────────
  container.registerSingleton(TOKENS.ConfigService, ConfigService);
  container.registerSingleton(TOKENS.GitService,    GitService);

  // ── Ticket service — resolved lazily from the configured ticket provider ──
  container.register<ITicketService>(
    TOKENS.TicketService,
    {
      useFactory: instanceCachingFactory((c) => {
        const cfg = c.resolve<IConfigService>(TOKENS.ConfigService);

        switch (cfg.getTicketProvider()) {
          case 'azuredevops':
            return new AzureDevOpsTicketService(cfg);
          case 'jira':
            return new JiraTicketService(cfg);
          case 'github':
            return new GitHubTicketService(cfg);
        }
      }),
    },
  );

  // ── PR service — resolved lazily from the configured VCS provider ─────────
  container.register<IPRService>(
    TOKENS.PRService,
    {
      useFactory: instanceCachingFactory((c) => {
        const cfg = c.resolve<IConfigService>(TOKENS.ConfigService);

        switch (cfg.getVcsProvider()) {
          case 'azuredevops':
            return new AzureDevOpsPRService(cfg);
          case 'github':
            return new GitHubVcsService(cfg);
        }
      }),
    },
  );
}

export { container };
