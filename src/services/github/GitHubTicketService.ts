import { injectable, inject } from 'tsyringe';
import type { ITicketService } from '../interfaces/ITicketService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { CreateTicketParams, Ticket, TicketComment } from '../../types';
import { TOKENS } from '../../tokens';
import { GitHubApiClient, GitHubApiError } from './GitHubApiClient';
import { resolveGithubToken } from '../../utils/ghCliAuth';

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  assignee: { login: string } | null;
  body: string | null;
  labels: Array<{ name: string }>;
  pull_request?: unknown;
}

interface GitHubIssueComment {
  id: number;
  body: string;
  user: { login: string } | null;
  created_at: string;
}

@injectable()
export class GitHubTicketService implements ITicketService {
  private readonly owner: string;
  private readonly repo: string;
  private readonly api: GitHubApiClient;

  constructor(@inject(TOKENS.ConfigService) config: IConfigService) {
    const gh = config.getProviderConfig('github');
    this.owner = gh.owner;
    this.repo  = gh.repo;
    this.api   = new GitHubApiClient({
      token:      resolveGithubToken(gh.token, gh.authMethod),
      baseUrl:    gh.baseUrl,
      graphqlUrl: gh.graphqlUrl,
    });
  }

  async getTicket(id: string): Promise<Ticket> {
    const issue = await this.api.request<GitHubIssue>(
      'GET',
      this.path(`/issues/${encodeURIComponent(id)}`),
    );
    return this.toTicket(issue);
  }

  async getTicketsForUser(user: string): Promise<Ticket[]> {
    const assignee = await this.resolveAssignee(user);
    const issues = await this.api.getPaginated<GitHubIssue>(
      this.path(`/issues?state=open&assignee=${encodeURIComponent(assignee)}`),
    );
    // Exclude pull requests (GitHub returns them in /issues).
    return issues.filter((issue) => !issue.pull_request).map((issue) => this.toTicket(issue));
  }

  async updateStatus(id: string, state: string): Promise<void> {
    // GitHub issues only support open/closed.
    const ghState = /^clos/i.test(state) ? 'closed' : 'open';
    await this.api.request(
      'PATCH',
      this.path(`/issues/${encodeURIComponent(id)}`),
      { state: ghState },
    );
  }

  async createTicket(params: CreateTicketParams): Promise<Ticket> {
    if (params.parentId) {
      throw new GitHubApiError(
        'GitHub issues have no parent work item. Remove `parentId` or use a project-management tool for hierarchy.',
      );
    }

    const labels = [...(params.labels ?? [])];
    // GitHub has no native issue type; expose `kind` as a leading label so it
    // maps back to `Ticket.type` and is visible in the issue list.
    if (params.kind && !labels.includes(params.kind)) labels.unshift(params.kind);

    const issue = await this.api.request<GitHubIssue>(
      'POST',
      this.path('/issues'),
      {
        title: params.title,
        body:  params.description ?? '',
        ...(params.assignee ? { assignee: params.assignee } : {}),
        ...(labels.length ? { labels } : {}),
      },
    );

    return this.toTicket(issue);
  }

  async addComment(id: string, text: string): Promise<TicketComment> {
    const comment = await this.api.request<GitHubIssueComment>(
      'POST',
      this.path(`/issues/${encodeURIComponent(id)}/comments`),
      { body: text },
    );
    return this.toComment(comment);
  }

  async getComments(id: string): Promise<TicketComment[]> {
    const comments = await this.api.getPaginated<GitHubIssueComment>(
      this.path(`/issues/${encodeURIComponent(id)}/comments`),
    );
    return comments
      .map((comment) => this.toComment(comment))
      .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
  }

  async closeTicket(id: string): Promise<void> {
    await this.updateStatus(id, 'Closed');
  }

  async reopenTicket(id: string): Promise<void> {
    await this.updateStatus(id, 'Open');
  }

  async addLabels(id: string, labels: string[]): Promise<void> {
    await this.api.request(
      'POST',
      this.path(`/issues/${encodeURIComponent(id)}/labels`),
      { labels },
    );
  }

  async assignTicket(id: string, assignee: string): Promise<void> {
    const login = await this.resolveAssignee(assignee);
    await this.api.request(
      'PATCH',
      this.path(`/issues/${encodeURIComponent(id)}`),
      { assignees: [login] },
    );
  }

  private async resolveAssignee(user: string): Promise<string> {
    const configuredUser = user.trim();

    // GitHub's assignee query accepts a login, not an email address or display name.
    if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(configuredUser)) {
      return configuredUser;
    }

    if (!this.api.hasToken) {
      throw new GitHubApiError(
        `GitHub ticket filtering requires a GitHub username, but the configured user ` +
        `"${configuredUser}" is not a valid login. Run ` +
        '`flowlane config set user <github-username>` or add a token so flowlane can resolve the authenticated user.',
      );
    }

    const currentUser = await this.api.request<{ login?: string }>('GET', '/user');
    if (!currentUser.login) {
      throw new GitHubApiError(
        'GitHub did not return a login for the authenticated user. Run `flowlane config set user <github-username>`.',
      );
    }
    return currentUser.login;
  }

  private path(suffix: string): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`;
  }

  private toTicket(issue: GitHubIssue): Ticket {
    return {
      id:          String(issue.number),
      title:       issue.title,
      status:      issue.state,
      url:         issue.html_url,
      assignee:    issue.assignee?.login,
      description: issue.body ?? undefined,
      type:        issue.labels[0]?.name,
    };
  }

  private toComment(comment: GitHubIssueComment): TicketComment {
    return {
      id:          String(comment.id),
      author:      comment.user?.login ?? 'Unknown',
      content:     comment.body,
      publishedAt: new Date(comment.created_at),
    };
  }
}
