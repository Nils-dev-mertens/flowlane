import { injectable, inject } from 'tsyringe';
import type { IPRService, CommentOptions } from '../interfaces/IPRService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { PullRequest, CreatePRParams } from '../../types';
import { TOKENS } from '../../tokens';

/**
 * Stub PR service for Jira.
 *
 * Jira does not natively host pull requests — those live in the connected
 * VCS (GitHub, GitLab, Bitbucket).  A future implementation could use the
 * Jira Software development-panel API to link remote PRs to issues.
 */
@injectable()
export class JiraPRService implements IPRService {
  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {}

  async createPR(_params: CreatePRParams): Promise<PullRequest> {
    throw new Error(
      'Jira does not host pull requests. ' +
      'Configure a VCS provider (GitHub, GitLab, Bitbucket) for PR creation.',
    );
  }

  async linkWorkItem(_prId: string | number, _ticketId: string): Promise<void> {
    throw new Error(
      'Jira PR linking is not yet implemented. ' +
      'See src/services/jira/JiraPRService.ts to contribute.',
    );
  }

  async findPRForBranch(_branch: string): Promise<null> {
    throw new Error('Jira does not host pull requests.');
  }

  async addComment(_prId: string | number, _comment: string, _options?: CommentOptions): Promise<void> {
    throw new Error('Jira does not host pull requests.');
  }
}
