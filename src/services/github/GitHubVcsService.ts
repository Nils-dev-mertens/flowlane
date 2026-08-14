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
import { GitHubApiClient, GitHubApiError } from './GitHubApiClient';

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
  user?: { login: string } | null;
  body: string;
  isDeleted?: boolean;
  path: string;
  line: number | null;
  original_line: number | null;
  created_at: string;
}

interface GHIssueComment {
  id: number;
  user?: { login: string } | null;
  body: string;
  isDeleted?: boolean;
  created_at: string;
}

interface GHPullFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  previous_filename?: string;
}

interface GHReviewThreadNode {
  id: string;
  isResolved: boolean;
  path: string | null;
  line: number | null;
  startLine: number | null;
  comments: {
    nodes: Array<{ databaseId: number | null }>;
  };
}

interface GHReviewThreadConnection {
  nodes: GHReviewThreadNode[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

interface GHReviewThreadsData {
  repository: {
    pullRequest: {
      reviewThreads: GHReviewThreadConnection;
    } | null;
  } | null;
}

const REVIEW_THREADS_QUERY = `
  query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          nodes {
            id
            isResolved
            path
            line
            startLine
            comments(first: 1) {
              nodes {
                databaseId
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const RESOLVE_REVIEW_THREAD_MUTATION = `
  mutation ResolveReviewThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
        isResolved
      }
    }
  }
`;

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class GitHubVcsService implements IPRService {
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

  // ── Core PR operations ────────────────────────────────────────────────────

  async createPR(params: CreatePRParams): Promise<PullRequest> {
    const { ticketId, title, description, sourceBranch, targetBranch } = params;

    await this.ensureBranchExists(sourceBranch, 'source');
    await this.ensureBranchExists(targetBranch, 'base');
    await this.ensureCommitsToMerge(sourceBranch, targetBranch);

    const existing = await this.findPRForBranch(sourceBranch);
    if (existing) {
      throw new GitHubApiError(
        `An open pull request already exists for branch "${sourceBranch}": #${existing.id} (${existing.url}).`,
      );
    }

    const body = await this.api.request<{
      number: number;
      title: string;
      html_url: string;
      state: string;
    }>('POST', this.path('/pulls'), {
      title: ticketId ? `[${ticketId}] ${title}` : title,
      body:  description ?? '',
      head:  sourceBranch,
      base:  targetBranch,
      draft: params.isDraft ?? false,
    });

    return { id: body.number, title: body.title, url: body.html_url, status: body.state };
  }

  async findPRForBranch(branch: string): Promise<PullRequest | null> {
    const prs = await this.api.getPaginated<{
      number: number;
      title: string;
      html_url: string;
      state: string;
    }>(this.path(`/pulls?state=open&head=${encodeURIComponent(`${this.owner}:${branch}`)}`));

    const pr = prs[0];
    if (!pr) return null;
    return { id: pr.number, title: pr.title, url: pr.html_url, status: pr.state };
  }

  async addComment(prId: string | number, comment: string, options?: CommentOptions): Promise<void> {
    if (options?.filePath) {
      // Inline review comments require the PR's current head commit SHA.
      const pr = await this.api.request<{ head: { sha: string } }>(
        'GET',
        this.path(`/pulls/${prId}`),
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
      } else {
        // GitHub supports a file-level review comment when no line is given.
        payload.subject_type = 'file';
      }

      await this.api.request('POST', this.path(`/pulls/${prId}/comments`), payload);
    } else {
      await this.api.request(
        'POST',
        this.path(`/issues/${prId}/comments`),
        { body: comment },
      );
    }
  }

  async linkWorkItem(prId: string | number, ticketId: string): Promise<void> {
    // GitHub has no native work-item links — append the reference to the PR body.
    const pr = await this.api.request<{ body: string | null }>(
      'GET',
      this.path(`/pulls/${prId}`),
    );

    const existing = pr.body ?? '';
    const ref      = `\n\n---\nLinked ticket: ${ticketId}`;
    if (existing.includes(ref)) return;

    await this.api.request('PATCH', this.path(`/pulls/${prId}`), {
      body: existing + ref,
    });
  }

  // ── PR management ─────────────────────────────────────────────────────────

  async listPRs(): Promise<PRSummary[]> {
    const prs = await this.api.getPaginated<GHPullRequest>(
      this.path('/pulls?state=open'),
    );

    // Fetch reviews for each PR concurrently to get the latest vote states.
    const allReviews = await Promise.all(
      prs.map((pr) => this.api.getPaginated<GHReview>(
        this.path(`/pulls/${pr.number}/reviews`),
      )),
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
      reviewers:    this.buildReviewers(pr.requested_reviewers ?? [], allReviews[i] ?? []),
    }));
  }

  async getPR(prId: number): Promise<PullRequest> {
    const pr = await this.api.request<GHPullRequest>(
      'GET',
      this.path(`/pulls/${prId}`),
    );
    return { id: pr.number, title: pr.title, url: pr.html_url, status: pr.state };
  }

  async votePR(prId: number, vote: PRVote): Promise<void> {
    if (vote === 'reset') {
      // Dismiss the user's most recent approvable review.
      const myLogin = (this.config.get<string>('user') ?? '').toLowerCase();
      const reviews = await this.api.getPaginated<GHReview>(
        this.path(`/pulls/${prId}/reviews`),
      );
      const myReview = reviews
        .filter((review) => review.user.login.toLowerCase() === myLogin &&
          (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED'))
        .pop();

      if (myReview) {
        await this.api.request(
          'PUT',
          this.path(`/pulls/${prId}/reviews/${myReview.id}/dismissals`),
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

    await this.api.request('POST', this.path(`/pulls/${prId}/reviews`), {
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

    await this.api.request('PUT', this.path(`/pulls/${prId}/merge`), {
      merge_method: methodMap[strategy],
    });
  }

  async abandonPR(prId: number): Promise<void> {
    await this.api.request('PATCH', this.path(`/pulls/${prId}`), { state: 'closed' });
  }

  async publishPR(prId: number): Promise<void> {
    await this.api.request('PATCH', this.path(`/pulls/${prId}`), { draft: false });
  }

  async getThreads(prId: number, activeOnly = true): Promise<PRThread[]> {
    // REST provides all comments and replies; GraphQL provides resolved state
    // and stable review-thread IDs, which REST does not expose consistently.
    const reviewThreadsPromise = this.api.hasToken
      ? this.getReviewThreadMetadata(prId)
      : Promise.resolve<GHReviewThreadNode[]>([]);
    const [reviewComments, issueComments, reviewThreads] = await Promise.all([
      this.api.getPaginated<GHReviewComment>(this.path(`/pulls/${prId}/comments`)),
      this.api.getPaginated<GHIssueComment>(this.path(`/issues/${prId}/comments`)),
      reviewThreadsPromise,
    ]);

    const metadataByRootComment = new Map<number, GHReviewThreadNode>();
    for (const thread of reviewThreads) {
      const rootCommentId = thread.comments.nodes[0]?.databaseId;
      if (rootCommentId != null) metadataByRootComment.set(rootCommentId, thread);
    }

    const rootComments = reviewComments.filter((comment) =>
      !comment.isDeleted && comment.in_reply_to_id === undefined,
    );
    const replyMap = new Map<number, GHReviewComment[]>();
    for (const comment of reviewComments) {
      if (!comment.isDeleted && comment.in_reply_to_id !== undefined) {
        const replies = replyMap.get(comment.in_reply_to_id) ?? [];
        replies.push(comment);
        replyMap.set(comment.in_reply_to_id, replies);
      }
    }

    const threads: PRThread[] = [];
    for (const root of rootComments) {
      const metadata = metadataByRootComment.get(root.id);
      const status: PRThread['status'] = metadata?.isResolved ? 'resolved' : 'active';
      if (activeOnly && status !== 'active') continue;

      const comments = [root, ...(replyMap.get(root.id) ?? [])].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      threads.push({
        id:         root.id,
        providerId: metadata?.id,
        status,
        filePath:   root.path || metadata?.path || undefined,
        startLine:  root.line ?? root.original_line ?? metadata?.startLine ?? metadata?.line ?? undefined,
        comments:   comments.map((comment) => ({
          author:      comment.user?.login ?? 'Unknown',
          content:     comment.body,
          publishedAt: new Date(comment.created_at),
        })),
      });
    }

    // General issue comments are standalone active threads.
    for (const comment of issueComments.filter((candidate) => !candidate.isDeleted)) {
      threads.push({
        id:      comment.id,
        status:  'active',
        comments: [{
          author:      comment.user?.login ?? 'Unknown',
          content:     comment.body,
          publishedAt: new Date(comment.created_at),
        }],
      });
    }

    return threads;
  }

  async resolveThread(prId: number, threadId: number): Promise<void> {
    if (!this.api.hasToken) {
      throw new GitHubApiError(
        'Resolving GitHub review threads requires a token. Add one with `flowlane init` or `flowlane config set token`.',
      );
    }

    const threads = await this.getThreads(prId, false);
    const thread = threads.find((candidate) => candidate.id === threadId);

    if (!thread) {
      throw new Error(`Thread #${threadId} was not found on PR #${prId}.`);
    }
    if (!thread.providerId) {
      throw new Error('Only inline GitHub review threads can be resolved; general comments cannot be resolved.');
    }
    if (thread.status === 'resolved') return;

    await this.api.graphql(RESOLVE_REVIEW_THREAD_MUTATION, { threadId: thread.providerId });
  }

  async replyToThread(prId: number, threadId: number, comment: string): Promise<void> {
    await this.api.request('POST', this.path(`/pulls/${prId}/comments`), {
      body:        comment,
      in_reply_to: threadId,
    });
  }

  async getChangedFiles(prId: number): Promise<PRFile[]> {
    const files = await this.api.getPaginated<GHPullFile>(
      this.path(`/pulls/${prId}/files`),
    );

    return files.map((file) => ({
      path:         file.filename,
      changeType:   this.mapFileStatus(file.status),
      originalPath: file.previous_filename,
    }));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private path(suffix: string): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`;
  }

  private async ensureCommitsToMerge(sourceBranch: string, targetBranch: string): Promise<void> {
    const comparison = await this.api.request<{ ahead_by?: number }>(
      'GET',
      this.path(`/compare/${encodeURIComponent(targetBranch)}...${encodeURIComponent(sourceBranch)}`),
    );

    if ((comparison.ahead_by ?? 0) === 0) {
      throw new GitHubApiError(
        `There are no commits on "${sourceBranch}" that are not already in "${targetBranch}". ` +
        'Create or commit changes on the source branch before opening a pull request.',
      );
    }
  }

  private async ensureBranchExists(branch: string, kind: 'source' | 'base'): Promise<void> {
    try {
      await this.api.request(
        'GET',
        this.path(`/branches/${encodeURIComponent(branch)}`),
      );
    } catch (err: unknown) {
      if (err instanceof GitHubApiError && err.status === 404) {
        const guidance = kind === 'source'
          ? `Push it first with \`git push -u origin ${branch}\`.`
          : 'Set `baseBranch` to an existing branch in the configuration.';
        throw new GitHubApiError(
          `GitHub ${kind} branch "${branch}" was not found in ${this.owner}/${this.repo}. ${guidance}`,
          { status: 404 },
        );
      }
      throw err;
    }
  }

  private async getReviewThreadMetadata(prId: number): Promise<GHReviewThreadNode[]> {
    const threads: GHReviewThreadNode[] = [];
    let after: string | null = null;

    for (;;) {
      const data: GHReviewThreadsData = await this.api.graphql<GHReviewThreadsData>(REVIEW_THREADS_QUERY, {
        owner: this.owner,
        repo: this.repo,
        number: prId,
        after,
      });
      const connection: GHReviewThreadConnection | undefined = data.repository?.pullRequest?.reviewThreads;
      if (!connection) {
        throw new Error(`Pull request #${prId} was not found or review threads are unavailable.`);
      }

      threads.push(...connection.nodes);
      if (!connection.pageInfo.hasNextPage) return threads;
      after = connection.pageInfo.endCursor;
      if (!after) throw new Error('GitHub returned a review-thread page without a cursor.');
    }
  }

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
      seen.add(login.toLowerCase());
      result.push({ name: login, email: login, vote: this.mapReviewState(review.state) });
    }

    // Add requested reviewers who have not submitted a review yet.
    for (const reviewer of requested) {
      if (!seen.has(reviewer.login.toLowerCase())) {
        result.push({ name: reviewer.login, email: reviewer.login, vote: 0 });
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
}
