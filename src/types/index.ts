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

export type TicketProvider = 'azuredevops' | 'jira' | 'github';

export type VcsProvider = 'github' | 'azuredevops';

/** Any provider id (ticket or VCS). */
export type ProviderId = TicketProvider | VcsProvider;

/** Fields shared across all provider config blocks. */
export interface ProviderConfigBase {
  /** Authentication token / API key. */
  token?: string;
  /** Identity used to filter or assign work (login or email). */
  user?: string;
  /** Default base branch for pull requests (VCS providers). */
  baseBranch?: string;
}

/** GitHub-specific config (owner/repo based). */
export interface GitHubProviderConfig extends ProviderConfigBase {
  /** GitHub owner (user or organization). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Auth source: stored PAT or the GitHub CLI (`gh auth token`). */
  authMethod?: 'pat' | 'gh-cli';
  /** Optional API base URL for GitHub Enterprise. */
  baseUrl?: string;
  /** Optional GraphQL URL for GitHub Enterprise. */
  graphqlUrl?: string;
}

/** Azure DevOps-specific config (org/project based). */
export interface AzureDevOpsProviderConfig extends ProviderConfigBase {
  org: string;
  project: string;
  repo?: string;
  authMethod?: 'pat' | 'az-cli';
  /** Azure DevOps team name (used to read board columns). */
  team?: string;
  activeStatus?: string;
  activeColumn?: string;
  reviewStatus?: string;
  reviewColumn?: string;
  closedStates?: string;
}

/** Jira-specific config (site/project-key based). */
export interface JiraProviderConfig extends ProviderConfigBase {
  /** Atlassian site subdomain, e.g. "acme.atlassian.net". */
  site: string;
  /** Project key, e.g. "PRJ". */
  project: string;
  /** Transition target name used by `flowlane start`, e.g. "In Progress". */
  activeStatus?: string;
  /** Transition target name used by `flowlane review`, e.g. "In Review". */
  reviewStatus?: string;
}

/** Maps each provider id to its typed config block. */
export interface ProviderBlocks {
  github: GitHubProviderConfig;
  azuredevops: AzureDevOpsProviderConfig;
  jira: JiraProviderConfig;
}

/** Provider-neutral ticket type used by `createTicket`. */
export type TicketKind = 'issue' | 'task' | 'bug' | 'story';

/**
 * Provider-neutral parameters for creating a ticket/work item.
 * Providers map these fields to their own capabilities and must report
 * unsupported fields clearly instead of silently dropping them.
 */
export interface CreateTicketParams {
  title: string;
  description?: string;
  kind?: TicketKind;
  /** Override the configured project/repo (where the provider supports it). */
  project?: string;
  /** Parent work item ID, where the provider has a native hierarchy. */
  parentId?: string;
  assignee?: string;
  labels?: string[];
}

export interface FlowlaneConfig {
  /** Ticket/work-item provider; falls back to `platform` when omitted. */
  ticketProvider?: TicketProvider;
  /** Pull-request/VCS provider; falls back to `platform` when omitted. */
  vcsProvider?: VcsProvider;

  /** Per-provider config blocks (canonical form). */
  github?: Partial<GitHubProviderConfig>;
  azuredevops?: Partial<AzureDevOpsProviderConfig>;
  jira?: Partial<JiraProviderConfig>;

  // ── Legacy flat fields (deprecated) ───────────────────────────────────────
  // Auto-mapped into the matching provider block on read so existing configs
  // keep working. New profiles should use the nested blocks above.

  /**
   * @deprecated Selects both the ticket and VCS providers at once.
   * Prefer `ticketProvider` and `vcsProvider`.
   */
  platform?: 'azuredevops' | 'jira' | 'github';
  /** @deprecated Mapped to `github.owner`, `azuredevops.org`, or `jira.site`. */
  org?: string;
  /** @deprecated Mapped to `azuredevops.project`, `jira.project`, or GitHub repo. */
  project?: string;
  /** @deprecated Mapped to the provider's `repo`. */
  repo?: string;
  /** @deprecated Mapped to the provider's `token`. */
  token?: string;
  /** @deprecated Mapped to the provider's `user`. */
  user?: string;
  /** @deprecated Mapped to the provider's `baseBranch`. */
  baseBranch?: string;
  /** @deprecated Mapped to `github.baseUrl`. */
  baseUrl?: string;
  /** @deprecated Mapped to `github.graphqlUrl`. */
  githubGraphqlUrl?: string;
  /** @deprecated Mapped to the provider's `authMethod`. */
  authMethod?: 'pat' | 'az-cli' | 'gh-cli';
  /** @deprecated Mapped to `azuredevops.team`. */
  team?: string;
  /** @deprecated Mapped to `azuredevops.activeStatus`. */
  activeStatus?: string;
  /** @deprecated Mapped to `azuredevops.activeColumn`. */
  activeColumn?: string;
  /** @deprecated Mapped to `azuredevops.reviewStatus`. */
  reviewStatus?: string;
  /** @deprecated Mapped to `azuredevops.reviewColumn`. */
  reviewColumn?: string;
  /** @deprecated Mapped to `azuredevops.closedStates`. */
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
  /** Command used to open files/diffs in an editor (e.g. `code`). Defaults to `code`. */
  editor?: string;
}

/** Vote options for a pull request reviewer. */
export type PRVote = 'approve' | 'approve-with-suggestions' | 'wait' | 'reject' | 'reset';

/** Merge strategy when completing a pull request. */
export type MergeStrategy = 'squash' | 'merge' | 'rebase' | 'rebase-merge';

/** Aggregate state of the CI checks that apply to a pull request head commit. */
export type PRCheckState = 'success' | 'failure' | 'pending' | 'error' | 'neutral' | 'unknown';

/** CI/check status for a pull request. */
export interface PRCheckStatus {
  /** Aggregated status across all evaluated checks. */
  state: PRCheckState;
  /** Total number of checks evaluated on the head commit. */
  total: number;
}

/** Summary of a pull request returned by the list command. */
export interface PRSummary {
  id: number;
  title: string;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  /** Display name or email of the PR author. */
  author: string;
  /** Email/uniqueName of the PR author — used to match against the configured user. */
  authorEmail: string;
  isDraft: boolean;
  createdAt: Date;
  reviewers: Array<{
    name: string;
    email: string;
    vote: number;
  }>;
  /** CI check status for the PR head commit, when the provider can report it. */
  checks?: PRCheckStatus;
}

/** A single comment thread on a pull request. */
export interface PRThread {
  /** Stable provider-facing comment/thread identifier used by direct commands. */
  id: number;
  /** Optional opaque provider thread ID (for APIs such as GitHub GraphQL). */
  providerId?: string;
  /**
   * Provenance of the thread. Inline code-review threads are `review`;
   * flat comments on the PR/issue timeline are `issue`. Used to route replies.
   */
  kind?: 'review' | 'issue';
  status: 'active' | 'resolved' | 'pending' | 'closed' | 'other';
  /** File path for inline threads. Undefined for general comments. */
  filePath?: string;
  startLine?: number;
  comments: Array<{
    author: string;
    content: string;
    publishedAt: Date;
  }>;
}

/** A single file changed in a pull request. */
export interface PRFile {
  path: string;
  changeType: 'add' | 'edit' | 'delete' | 'rename' | 'other';
  /** Original path before rename, if applicable. */
  originalPath?: string;
  /** Unified diff patch provided by the VCS provider (when available). */
  patch?: string;
  /** Lines added in the new file version. */
  additions?: number;
  /** Lines deleted from the old file version. */
  deletions?: number;
}

export interface CreatePRParams {
  ticketId: string;
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch: string;
  isDraft?: boolean;
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
