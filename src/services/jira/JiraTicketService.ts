import { injectable, inject } from 'tsyringe';
import type { ITicketService } from '../interfaces/ITicketService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { Ticket } from '../../types';
import { TOKENS } from '../../tokens';

/**
 * Stub implementation for Jira.
 *
 * Implements ITicketService so the DI container wires correctly.
 * Replace method bodies with calls to the Jira REST API v3 to activate.
 *
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */
@injectable()
export class JiraTicketService implements ITicketService {
  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {}

  async getTicket(_id: string): Promise<Ticket> {
    throw new Error(
      'Jira provider is not yet implemented. ' +
      'See src/services/jira/JiraTicketService.ts to contribute.',
    );
  }

  async getTicketsForUser(_user: string): Promise<Ticket[]> {
    throw new Error(
      'Jira provider is not yet implemented. ' +
      'See src/services/jira/JiraTicketService.ts to contribute.',
    );
  }

  async updateStatus(_id: string, _status: string): Promise<void> {
    throw new Error(
      'Jira provider is not yet implemented. ' +
      'See src/services/jira/JiraTicketService.ts to contribute.',
    );
  }
}
