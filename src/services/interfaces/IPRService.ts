import type { PullRequest, CreatePRParams } from '../../types';

export interface IPRService {
  /** Open a pull request for the given params. */
  createPR(params: CreatePRParams): Promise<PullRequest>;
  /** Attach a work item link to an existing pull request. */
  linkWorkItem(prId: string | number, ticketId: string): Promise<void>;
}
