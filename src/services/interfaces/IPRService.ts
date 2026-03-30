import type {
  PullRequest,
  PRSummary,
  PRThread,
  PRVote,
  MergeStrategy,
  CreatePRParams,
} from '../../types';

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

  // ── PR management ──────────────────────────────────────────────────────────

  /** List all active PRs for the configured repository. */
  listPRs(): Promise<PRSummary[]>;
  /** Fetch a single PR by ID. */
  getPR(prId: number): Promise<PullRequest>;
  /** Cast a reviewer vote on a PR. */
  votePR(prId: number, vote: PRVote): Promise<void>;
  /** Complete (merge) a PR with the specified merge strategy. */
  completePR(prId: number, strategy: MergeStrategy): Promise<void>;
  /** Abandon a PR. */
  abandonPR(prId: number): Promise<void>;
  /** Fetch comment threads. Pass activeOnly=true (default) to skip resolved threads. */
  getThreads(prId: number, activeOnly?: boolean): Promise<PRThread[]>;
}
