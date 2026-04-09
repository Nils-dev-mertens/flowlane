import { injectable, inject } from 'tsyringe';
import type { IPRService, CommentOptions } from '../interfaces/IPRService';
import type { IConfigService } from '../interfaces/IConfigService';
import type {
  PullRequest,
  PRSummary,
  PRThread,
  PRFile,
  PRVote,
  MergeStrategy,
  CreatePRParams,
} from '../../types';
import { TOKENS } from '../../tokens';

const NOT_IMPLEMENTED = 'Jira does not host pull requests. ' +
  'Configure a VCS provider (GitHub, GitLab, Bitbucket) for PR operations.';

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
    throw new Error(NOT_IMPLEMENTED);
  }

  async linkWorkItem(_prId: string | number, _ticketId: string): Promise<void> {
    throw new Error(
      'Jira PR linking is not yet implemented. ' +
      'See src/services/jira/JiraPRService.ts to contribute.',
    );
  }

  async findPRForBranch(_branch: string): Promise<null> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async addComment(_prId: string | number, _comment: string, _options?: CommentOptions): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async listPRs(): Promise<PRSummary[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getPR(_prId: number): Promise<PullRequest> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async votePR(_prId: number, _vote: PRVote): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async completePR(_prId: number, _strategy: MergeStrategy): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async abandonPR(_prId: number): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getThreads(_prId: number, _activeOnly?: boolean): Promise<PRThread[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getChangedFiles(_prId: number): Promise<PRFile[]> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
