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
  org: string;
  project: string;
  repo?: string;
  token: string;
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
