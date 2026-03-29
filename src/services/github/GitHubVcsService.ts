import { injectable, inject } from 'tsyringe';
import type { IPRService }     from '../interfaces/IPRService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { PullRequest, CreatePRParams } from '../../types';
import { TOKENS } from '../../tokens';

@injectable()
export class GitHubVcsService implements IPRService {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly baseUrl = 'https://api.github.com';

  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {
    this.owner = config.get<string>('org')!;
    this.repo  = config.get<string>('repo') ?? config.get<string>('project')!;
    this.token = config.get<string>('token')!;
  }

  async createPR(params: CreatePRParams): Promise<PullRequest> {
    const { ticketId, title, description, sourceBranch, targetBranch } = params;

    const body = await this.request<{
      number: number;
      title: string;
      html_url: string;
      state: string;
    }>('POST', `/repos/${this.owner}/${this.repo}/pulls`, {
      title: ticketId ? `[${ticketId}] ${title}` : title,
      body:  description ?? '',
      head:  sourceBranch,
      base:  targetBranch,
    });

    return { id: body.number, title: body.title, url: body.html_url, status: body.state };
  }

  async findPRForBranch(branch: string): Promise<PullRequest | null> {
    const prs = await this.request<Array<{
      number: number;
      title: string;
      html_url: string;
      state: string;
    }>>('GET', `/repos/${this.owner}/${this.repo}/pulls?state=open&head=${this.owner}:${branch}`);

    const pr = prs[0];
    if (!pr) return null;
    return { id: pr.number, title: pr.title, url: pr.html_url, status: pr.state };
  }

  async addComment(prId: string | number, comment: string): Promise<void> {
    await this.request('POST', `/repos/${this.owner}/${this.repo}/issues/${prId}/comments`, {
      body: comment,
    });
  }

  async linkWorkItem(prId: string | number, ticketId: string): Promise<void> {
    // GitHub PRs don't have native work-item links.
    // Append the ticket reference to the PR body.
    const pr = await this.request<{ body: string | null }>(
      'GET',
      `/repos/${this.owner}/${this.repo}/pulls/${prId}`,
    );

    const existing = pr.body ?? '';
    const ref      = `\n\n---\nLinked ticket: ${ticketId}`;
    if (existing.includes(ref)) return;

    await this.request('PATCH', `/repos/${this.owner}/${this.repo}/pulls/${prId}`, {
      body: existing + ref,
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

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
        const json = JSON.parse(text) as { message?: string; errors?: unknown[] };
        if (json.message) message += `: ${json.message}`;
        if (json.errors)  message += ` ${JSON.stringify(json.errors)}`;
      } catch { /* use raw text */ }
      throw new Error(message);
    }

    return text ? (JSON.parse(text) as T) : ({} as T);
  }
}
