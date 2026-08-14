import { injectable, inject } from 'tsyringe';
import type { ITicketService } from '../interfaces/ITicketService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { Ticket } from '../../types';
import { TOKENS } from '../../tokens';
import { GitHubApiClient } from './GitHubApiClient';

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

@injectable()
export class GitHubTicketService implements ITicketService {
  private readonly owner: string;
  private readonly repo: string;
  private readonly api: GitHubApiClient;

  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {
    this.owner = config.get<string>('org')!;
    this.repo  = config.get<string>('repo') ?? config.get<string>('project')!;
    this.api   = new GitHubApiClient({
      token:      config.get<string>('token'),
      baseUrl:    config.get<string>('baseUrl'),
      graphqlUrl: config.get<string>('githubGraphqlUrl'),
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
    const issues = await this.api.getPaginated<GitHubIssue>(
      this.path(`/issues?state=open&assignee=${encodeURIComponent(user)}`),
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
}
