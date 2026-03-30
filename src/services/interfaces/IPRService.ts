import type { PullRequest, CreatePRParams } from '../../types';

export interface CommentOptions {
  /** File path for an inline comment (e.g. "src/foo.ts"). */
  filePath?: string;
  /** 1-based start line for an inline comment. */
  startLine?: number;
  /** 1-based end line for a multi-line inline comment. Defaults to startLine. */
  endLine?: number;
}

export interface IPRService {
  /** Open a pull request for the given params. */
  createPR(params: CreatePRParams): Promise<PullRequest>;
  /** Attach a work item link to an existing pull request. */
  linkWorkItem(prId: string | number, ticketId: string): Promise<void>;
  /** Find the active PR for a given source branch. Returns null if not found. */
  findPRForBranch(branch: string): Promise<PullRequest | null>;
  /** Add a comment (optionally inline) to an existing pull request. */
  addComment(prId: string | number, comment: string, options?: CommentOptions): Promise<void>;
}
