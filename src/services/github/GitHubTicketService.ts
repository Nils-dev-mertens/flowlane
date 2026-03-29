import { injectable, inject } from 'tsyringe';
import type { ITicketService } from '../interfaces/ITicketService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { Ticket } from '../../types';
import { TOKENS } from '../../tokens';

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
  private readonly token: string;
  private readonly baseUrl = 'https://api.github.com';

  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {
    this.owner = config.get<string>('org')!;
    this.repo  = config.get<string>('repo') ?? config.get<string>('project')!;
    this.token = config.get<string>('token')!;
  }

  async getTicket(id: string): Promise<Ticket> {
    const issue = await this.request<GitHubIssue>(
      'GET',
      `/repos/${this.owner}/${this.repo}/issues/${id}`,
    );
    return this.toTicket(issue);
  }

  async getTicketsForUser(user: string): Promise<Ticket[]> {
    const issues = await this.request<GitHubIssue[]>(
      'GET',
      `/repos/${this.owner}/${this.repo}/issues?state=open&assignee=${encodeURIComponent(user)}&per_page=100`,
    );
    // Exclude pull requests (GitHub returns them in /issues)
    return issues.filter((i) => !i.pull_request).map((i) => this.toTicket(i));
  }

  async updateStatus(id: string, state: string): Promise<void> {
    // GitHub issues only support open/closed
    const ghState = /^clos/i.test(state) ? 'closed' : 'open';
    await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/${id}`, {
      state: ghState,
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        Authorization:  `Bearer ${this.token}`,
        Accept:         'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent':   'flowlane-cli',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();

    if (!res.ok) {
      let message = `GitHub API error ${res.status}`;
      try {
        const json = JSON.parse(text) as { message?: string };
        if (json.message) message += `: ${json.message}`;
      } catch { /* use raw text */ }
      throw new Error(message);
    }

    return text ? (JSON.parse(text) as T) : ({} as T);
  }
}
