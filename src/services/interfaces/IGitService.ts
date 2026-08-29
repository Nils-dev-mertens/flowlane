import type { BranchInfo } from '../../types';

export interface IGitService {
  /** Create a new local branch and check it out. */
  createBranch(name: string): BranchInfo;
  /** Push the branch to the remote and set upstream tracking. */
  publishBranch(name: string): void;
  /** Return the name of the currently checked-out branch. */
  getCurrentBranch(): string;
  /** Return all local branches, optionally filtered by ticket ID prefix. */
  listBranches(ticketId?: string): string[];
  /** Switch to an existing local branch. */
  switchBranch(name: string): void;
}
