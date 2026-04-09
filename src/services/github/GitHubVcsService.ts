import { injectable, inject } from 'tsyringe';
import type { IPRService, CommentOptions } from '../interfaces/IPRService';
import type { IConfigService } from '../interfaces/IConfigService';
import type {
  PullRequest,
  PRSummary,
  PRThread,
  PRFile,
  PRVote,
  MergeStrategy,
  CreatePRParams,
} from '../../types';
import { TOKENS } from '../../tokens';

// ── GitHub API shapes ─────────────────────────────────────────────────────────

interface GHPullRequest {
  number: number;
  title: string;
  html_url: string;
  state: string;
  user: { login: string };
  head: { ref: string; sha: string };
  base: { ref: string };
  draft: boolean;
  created_at: string;
  requested_reviewers: Array<{ login: string }>;
  body: string | null;
}

interface GHReview {
  id: number;
  user: { login: string };
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
}

interface GHReviewComment {
  id: number;
  in_reply_to_id?: number;
  user: { login: string };
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  created_at: string;
}

interface GHIssueComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
}

interface GHPullFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  previous_filename?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

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

  // ── Core PR operations ────────────────────────────────────────────────────

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

  async addComment(prId: string | number, comment: string, options?: CommentOptions): Promise<void> {
    if (options?.filePath) {
      // Inline review comment — requires the PR's head commit SHA.
      const pr = await this.request<{ head: { sha: string } }>(
        'GET',
        `/repos/${this.owner}/${this.repo}/pulls/${prId}`,
      );
      const payload: Record<string, unknown> = {
        body:      comment,
        commit_id: pr.head.sha,
        path:      options.filePath,
        side:      'RIGHT',
      };
      if (options.startLine !== undefined) {
        if (options.endLine !== undefined && options.endLine !== options.startLine) {
          payload.start_line = options.startLine;
          payload.start_side = 'RIGHT';
          payload.line       = options.endLine;
        } else {
          payload.line = options.startLine;
        }
      }
      await this.request('POST', `/repos/${this.owner}/${this.repo}/pulls/${prId}/comments`, payload);
    } else {
      await this.request('POST', `/repos/${this.owner}/${this.repo}/issues/${prId}/comments`, {
        body: comment,
      });
    }
  }

  async linkWorkItem(prId: string | number, ticketId: string): Promise<void> {
    // GitHub has no native work-item links — append the reference to the PR body.
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

  // ── PR management ─────────────────────────────────────────────────────────

  async listPRs(): Promise<PRSummary[]> {
    const prs = await this.request<GHPullRequest[]>(
      'GET',
      `/repos/${this.owner}/${this.repo}/pulls?state=open&per_page=100`,
    );

    // Fetch reviews for each PR concurrently to get vote states.
    const allReviews = await Promise.all(
      prs.map(pr =>
        this.request<GHReview[]>(
          'GET',
          `/repos/${this.owner}/${this.repo}/pulls/${pr.number}/reviews`,
        ),
      ),
    );

    return prs.map((pr, i) => ({
      id:           pr.number,
      title:        pr.title,
      url:          pr.html_url,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      author:       pr.user.login,
      authorEmail:  pr.user.login, // GitHub login is the identity — config.user should match
      isDraft:      pr.draft,
      createdAt:    new Date(pr.created_at),
      reviewers:    this.buildReviewers(pr.requested_reviewers, allReviews[i] ?? []),
    }));
  }

  async getPR(prId: number): Promise<PullRequest> {
    const pr = await this.request<GHPullRequest>(
      'GET',
      `/repos/${this.owner}/${this.repo}/pulls/${prId}`,
    );
    return { id: pr.number, title: pr.title, url: pr.html_url, status: pr.state };
  }

  async votePR(prId: number, vote: PRVote): Promise<void> {
    if (vote === 'reset') {
      // Dismiss the user's most recent approvable review.
      const myLogin = this.config.get<string>('user')!;
      const reviews = await this.request<GHReview[]>(
        'GET',
        `/repos/${this.owner}/${this.repo}/pulls/${prId}/reviews`,
      );
      const myReview = reviews
        .filter(r => r.user.login === myLogin &&
          (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED'))
        .pop();

      if (myReview) {
        await this.request(
          'PUT',
          `/repos/${this.owner}/${this.repo}/pulls/${prId}/reviews/${myReview.id}/dismissals`,
          { message: 'Vote reset via flowlane.' },
        );
      }
      return;
    }

    const eventMap: Record<Exclude<PRVote, 'reset'>, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
      'approve':                  'APPROVE',
      'approve-with-suggestions': 'APPROVE',
      'wait':                     'COMMENT',
      'reject':                   'REQUEST_CHANGES',
    };

    await this.request('POST', `/repos/${this.owner}/${this.repo}/pulls/${prId}/reviews`, {
      event: eventMap[vote],
      body:  vote === 'approve-with-suggestions' ? 'Approved with suggestions.' : '',
    });
  }

  async completePR(prId: number, strategy: MergeStrategy): Promise<void> {
    // GitHub supports merge / squash / rebase; rebase-merge maps to rebase.
    const methodMap: Record<MergeStrategy, 'merge' | 'squash' | 'rebase'> = {
      'squash':       'squash',
      'merge':        'merge',
      'rebase':       'rebase',
      'rebase-merge': 'rebase',
    };

    await this.request('PUT', `/repos/${this.owner}/${this.repo}/pulls/${prId}/merge`, {
      merge_method: methodMap[strategy],
    });
  }

  async abandonPR(prId: number): Promise<void> {
    await this.request('PATCH', `/repos/${this.owner}/${this.repo}/pulls/${prId}`, {
      state: 'closed',
    });
  }

  async getThreads(prId: number, _activeOnly = true): Promise<PRThread[]> {
    // Fetch inline review comments and general issue comments in parallel.
    const [reviewComments, issueComments] = await Promise.all([
      this.request<GHReviewComment[]>(
        'GET',
        `/repos/${this.owner}/${this.repo}/pulls/${prId}/comments?per_page=100`,
      ),
      this.request<GHIssueComment[]>(
        'GET',
        `/repos/${this.owner}/${this.repo}/issues/${prId}/comments?per_page=100`,
      ),
    ]);

    const threads: PRThread[] = [];

    // Group inline comments into threads using the reply chain.
    const rootComments = reviewComments.filter(c => !c.in_reply_to_id);
    const replyMap = new Map<number, GHReviewComment[]>();
    for (const c of reviewComments) {
      if (c.in_reply_to_id !== undefined) {
        const arr = replyMap.get(c.in_reply_to_id) ?? [];
        arr.push(c);
        replyMap.set(c.in_reply_to_id, arr);
      }
    }

    for (const root of rootComments) {
      const replies = replyMap.get(root.id) ?? [];
      const all = [root, ...replies].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      threads.push({
        id:        root.id,
        status:    'active',
        filePath:  root.path || undefined,
        startLine: root.line ?? root.original_line ?? undefined,
        comments:  all.map(c => ({
          author:      c.user.login,
          content:     c.body,
          publishedAt: new Date(c.created_at),
        })),
      });
    }

    // Each general issue comment is its own standalone thread.
    for (const c of issueComments) {
      threads.push({
        id:      c.id,
        status:  'active',
        comments: [{
          author:      c.user.login,
          content:     c.body,
          publishedAt: new Date(c.created_at),
        }],
      });
    }

    return threads;
  }

  async getChangedFiles(prId: number): Promise<PRFile[]> {
    const files = await this.request<GHPullFile[]>(
      'GET',
      `/repos/${this.owner}/${this.repo}/pulls/${prId}/files?per_page=100`,
    );

    return files.map(f => ({
      path:         f.filename,
      changeType:   this.mapFileStatus(f.status),
      originalPath: f.previous_filename,
    }));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private buildReviewers(
    requested: Array<{ login: string }>,
    reviews: GHReview[],
  ): PRSummary['reviewers'] {
    // Keep only the latest review per user.
    const latestByUser = new Map<string, GHReview>();
    for (const review of reviews) {
      latestByUser.set(review.user.login, review);
    }

    const result: PRSummary['reviewers'] = [];
    const seen = new Set<string>();

    for (const [login, review] of latestByUser) {
      seen.add(login);
      result.push({ name: login, email: login, vote: this.mapReviewState(review.state) });
    }

    // Add requested reviewers who haven't submitted a review yet.
    for (const r of requested) {
      if (!seen.has(r.login)) {
        result.push({ name: r.login, email: r.login, vote: 0 });
      }
    }

    return result;
  }

  private mapReviewState(state: GHReview['state']): number {
    if (state === 'APPROVED')          return 10;
    if (state === 'CHANGES_REQUESTED') return -10;
    return 0;
  }

  private mapFileStatus(status: GHPullFile['status']): PRFile['changeType'] {
    if (status === 'added')    return 'add';
    if (status === 'removed')  return 'delete';
    if (status === 'modified') return 'edit';
    if (status === 'renamed')  return 'rename';
    return 'other';
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        Authorization:          `Bearer ${this.token}`,
        Accept:                 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':         'application/json',
        'User-Agent':           'flowlane-cli',
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
