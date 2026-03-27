import type { PullRequest, CreatePRParams } from '../../types';

export interface IPRService {
  /** Open a pull request for the given params. */
  createPR(params: CreatePRParams): Promise<PullRequest>;
  /** Attach a work item link to an existing pull request. */
  linkWorkItem(prId: string | number, ticketId: string): Promise<void>;
  /** Find the active PR for a given source branch. Returns null if not found. */
  findPRForBranch(branch: string): Promise<PullRequest | null>;
  /** Add a comment to an existing pull request. */
  addComment(prId: string | number, comment: string): Promise<void>;
}
