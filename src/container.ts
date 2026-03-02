/**
 * Dependency-injection container.
 *
 * Services are registered via lazy factories so the container is valid before
 * the config file exists (e.g. on first run before `flowlane init` completes).
 * The factory reads the platform from the already-saved config at resolution
 * time, not at registration time.
 */
import 'reflect-metadata';
import { container, instanceCachingFactory } from 'tsyringe';

import { ConfigService }               from './config/ConfigService';
import { GitService }                   from './services/git/GitService';
import { AzureDevOpsTicketService }     from './services/azuredevops/AzureDevOpsTicketService';
import { AzureDevOpsPRService }         from './services/azuredevops/AzureDevOpsPRService';
import { JiraTicketService }            from './services/jira/JiraTicketService';
import { JiraPRService }                from './services/jira/JiraPRService';
import { TOKENS }                       from './tokens';

import type { IConfigService } from './services/interfaces/IConfigService';
import type { ITicketService } from './services/interfaces/ITicketService';
import type { IPRService }     from './services/interfaces/IPRService';

let initialised = false;

export function setupContainer(): void {
  if (initialised) return;
  initialised = true;

  // ── Config & Git — always available, no platform dependency ───────────────
  container.registerSingleton(TOKENS.ConfigService, ConfigService);
  container.registerSingleton(TOKENS.GitService,    GitService);

  // ── Ticket service — resolved lazily based on configured platform ─────────
  container.register<ITicketService>(
    TOKENS.TicketService,
    {
      useFactory: instanceCachingFactory((c) => {
        const cfg      = c.resolve<IConfigService>(TOKENS.ConfigService);
        const platform = cfg.get<string>('platform');

        switch (platform) {
          case 'azuredevops':
            return new AzureDevOpsTicketService(cfg);
          case 'jira':
            return new JiraTicketService(cfg);
          default:
            throw new Error(
              `Unknown platform "${platform ?? '(not set)'}". ` +
              'Run `flowlane init` to configure.',
            );
        }
      }),
    },
  );

  // ── PR service — resolved lazily based on configured platform ─────────────
  container.register<IPRService>(
    TOKENS.PRService,
    {
      useFactory: instanceCachingFactory((c) => {
        const cfg      = c.resolve<IConfigService>(TOKENS.ConfigService);
        const platform = cfg.get<string>('platform');

        switch (platform) {
          case 'azuredevops':
            return new AzureDevOpsPRService(cfg);
          case 'jira':
            return new JiraPRService(cfg);
          default:
            throw new Error(
              `Unknown platform "${platform ?? '(not set)'}". ` +
              'Run `flowlane init` to configure.',
            );
        }
      }),
    },
  );
}

export { container };
