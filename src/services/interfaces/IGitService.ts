import type { BranchInfo } from '../../types';

export interface IGitService {
  /** Create a new local branch and check it out. */
  createBranch(name: string): BranchInfo;
  /** Push the branch to the remote and set upstream tracking. */
  publishBranch(name: string): void;
  /** Return the name of the currently checked-out branch. */
  getCurrentBranch(): string;
}
