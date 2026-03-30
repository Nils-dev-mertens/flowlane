export interface Ticket {
  id: string;
  title: string;
  status: string;
  /** Board column name (may differ from the workflow state). */
  boardColumn?: string;
  type?: string;
  url?: string;
  assignee?: string;
  description?: string;
  /** ID of the parent work item (e.g. User Story this Task belongs to). */
  parentId?: string;
  /** True for work items fetched only to provide grouping context (not directly assigned to the user). */
  isContext?: boolean;
}

export interface PullRequest {
  id: number | string;
  title: string;
  url: string;
  status: string;
}

export interface BranchInfo {
  name: string;
  remote?: string;
}

export interface FlowlaneConfig {
  platform: 'azuredevops' | 'jira' | 'github';
  /** How to authenticate. Defaults to 'pat' if omitted. */
  authMethod?: 'pat' | 'az-cli';
  org: string;
  project: string;
  repo?: string;
  /** Required when authMethod is 'pat' (or unset). Not used with 'az-cli'. */
  token?: string;
  user: string;
  baseBranch?: string;
  baseUrl?: string;
  /** Azure DevOps team name (used to read board columns). */
  team?: string;
  /** System.State value set when starting work (e.g. "Active"). */
  activeStatus?: string;
  /** System.BoardColumn value set when starting work (e.g. "Doing"). */
  activeColumn?: string;
  /** System.State value set when moving to review (e.g. "Active"). */
  reviewStatus?: string;
  /** System.BoardColumn value set when moving to review (e.g. "Ready for Review"). */
  reviewColumn?: string;
  /** Comma-separated list of states considered closed/done (excluded from ticket listing). */
  closedStates?: string;
  // ── Post-action hooks ──────────────────────────────────────────────────────
  /** Shell command to run after a branch is created. Supports {{branch}}, {{ticketId}}. */
  hookAfterBranch?: string;
  /** Shell command to run after a PR is created. Supports {{prUrl}}, {{prId}}, {{ticketId}}, {{branch}}. */
  hookAfterPR?: string;
  /** Shell command to run after a ticket is moved to review. Supports {{ticketId}}. */
  hookAfterReview?: string;
  /** Shell command to run after `flowlane start` completes. Supports {{branch}}, {{ticketId}}. */
  hookAfterStart?: string;
  /** Shell command to run after a PR comment is posted. Supports {{prId}}, {{branch}}. */
  hookAfterComment?: string;
}

export interface CreatePRParams {
  ticketId: string;
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch: string;
}

// ── Multi-profile config file format ─────────────────────────────────────────

/** Shape of ~/.config/flowlane/config.json */
export interface ProfilesFile {
  activeProfile: string;
  profiles: Record<string, Partial<FlowlaneConfig>>;
}

/**
 * Shape of .flowlane in a git repo root.
 * `profile` selects which global profile to use.
 * All other keys override that profile's values for this repo.
 */
export interface LocalRepoConfig extends Partial<FlowlaneConfig> {
  profile?: string;
}
