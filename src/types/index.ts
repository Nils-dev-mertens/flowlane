export interface Ticket {
  id: string;
  title: string;
  status: string;
  type?: string;
  url?: string;
  assignee?: string;
  description?: string;
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
  platform: 'azuredevops' | 'jira';
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
