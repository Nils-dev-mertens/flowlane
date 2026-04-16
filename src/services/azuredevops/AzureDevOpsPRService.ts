import { injectable, inject } from 'tsyringe';
import * as azdev from 'azure-devops-node-api';
import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type { GitPullRequest, CommentThreadStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
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
import { getAzCliToken } from '../../utils/azCliAuth';

// Azure DevOps numeric constants (avoid importing const enums at runtime)
const PR_STATUS_ACTIVE    = 1;
const PR_STATUS_ABANDONED = 2;
const PR_STATUS_COMPLETED = 3;

const THREAD_STATUS_ACTIVE  = 1 as CommentThreadStatus;
const THREAD_STATUS_PENDING = 6;

const MERGE_STRATEGY: Record<MergeStrategy, number> = {
  'merge':        1, // noFastForward — merge commit
  'squash':       2,
  'rebase':       3,
  'rebase-merge': 4,
};

const VOTE_VALUE: Record<PRVote, number> = {
  'approve':                  10,
  'approve-with-suggestions':  5,
  'reset':                     0,
  'wait':                     -5,
  'reject':                  -10,
};

@injectable()
export class AzureDevOpsPRService implements IPRService {
  private readonly project: string;
  private readonly repo: string;
  private readonly org: string;
  private gitApi: IGitApi | null = null;
  private currentUserId: string | null = null;

  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {
    this.org     = config.get<string>('org')!;
    this.project = config.get<string>('project')!;
    // Fall back to project name when no dedicated repo name is configured.
    this.repo    = config.get<string>('repo') || this.project;
  }

  /** Create a fresh connection with a current token (az-cli tokens expire after ~1 hour). */
  private createConnection(): azdev.WebApi {
    const authMethod  = this.config.get<string>('authMethod') ?? 'pat';
    const authHandler = authMethod === 'az-cli'
      ? azdev.getBearerHandler(getAzCliToken())
      : azdev.getPersonalAccessTokenHandler(this.config.get<string>('token')!);
    return new azdev.WebApi(`https://dev.azure.com/${this.org}`, authHandler);
  }

  async createPR(params: CreatePRParams): Promise<PullRequest> {
    const { ticketId, title, description, sourceBranch, targetBranch } = params;
    const api = await this.api();

    const prRequest: GitPullRequest = {
      title:         `[${ticketId}] ${title}`,
      description:   description ?? `Linked to work item #${ticketId}`,
      sourceRefName: `refs/heads/${sourceBranch}`,
      targetRefName: `refs/heads/${targetBranch}`,
      workItemRefs:  [{ id: String(ticketId), url: '' }],
      isDraft:       params.isDraft ?? false,
    };

    const pr = await api.createPullRequest(prRequest, this.repo, this.project);

    if (!pr.pullRequestId) {
      throw new Error('Pull request was created but no ID was returned from the API.');
    }

    return {
      id:     pr.pullRequestId,
      title:  pr.title ?? prRequest.title ?? '',
      url:    this.prUrl(pr.pullRequestId),
      status: String(pr.status ?? 'active'),
    };
  }

  async findPRForBranch(branch: string): Promise<PullRequest | null> {
    const api = await this.api();
    const prs = await api.getPullRequests(
      this.repo,
      { sourceRefName: `refs/heads/${branch}` },
      this.project,
    );
    const pr = prs[0];
    if (!pr?.pullRequestId) return null;
    return {
      id:     pr.pullRequestId,
      title:  pr.title ?? '',
      url:    this.prUrl(pr.pullRequestId),
      status: String(pr.status ?? 'active'),
    };
  }

  async addComment(prId: string | number, comment: string, options?: CommentOptions): Promise<void> {
    const api = await this.api();

    const thread: Parameters<IGitApi['createThread']>[0] = {
      comments: [{ content: comment, commentType: 1 }],
      status: THREAD_STATUS_ACTIVE,
    };

    if (options?.filePath) {
      const line    = options.startLine ?? 1;
      const endLine = options.endLine ?? line;
      // Azure DevOps expects the path to start with '/'.
      const filePath = options.filePath.startsWith('/') ? options.filePath : `/${options.filePath}`;
      thread.threadContext = {
        filePath,
        rightFileStart: { line, offset: 1 },
        rightFileEnd:   { line: endLine, offset: 1 },
      };
    }

    await api.createThread(thread, this.repo, Number(prId), this.project);
  }

  async linkWorkItem(prId: string | number, ticketId: string): Promise<void> {
    const api = await this.api();
    await api.updatePullRequest(
      { workItemRefs: [{ id: String(ticketId), url: '' }] },
      this.repo,
      Number(prId),
      this.project,
    );
  }

  // ── New PR management methods ─────────────────────────────────────────────

  async listPRs(): Promise<PRSummary[]> {
    const api = await this.api();
    const prs = await api.getPullRequests(
      this.repo,
      { status: PR_STATUS_ACTIVE },
      this.project,
      undefined, undefined, 100,
    );

    return prs
      .filter(pr => pr.pullRequestId != null)
      .map(pr => ({
        id:           pr.pullRequestId!,
        title:        pr.title ?? '',
        url:          this.prUrl(pr.pullRequestId!),
        sourceBranch: (pr.sourceRefName ?? '').replace('refs/heads/', ''),
        targetBranch: (pr.targetRefName ?? '').replace('refs/heads/', ''),
        author:       pr.createdBy?.displayName ?? pr.createdBy?.uniqueName ?? 'Unknown',
        authorEmail:  pr.createdBy?.uniqueName ?? '',
        isDraft:      pr.isDraft ?? false,
        createdAt:    pr.creationDate ?? new Date(),
        reviewers:    (pr.reviewers ?? []).map(r => ({
          name:  r.displayName ?? r.uniqueName ?? '',
          email: r.uniqueName ?? '',
          vote:  r.vote ?? 0,
        })),
      }));
  }

  async getPR(prId: number): Promise<PullRequest> {
    const api = await this.api();
    const pr  = await api.getPullRequest(this.repo, prId, this.project);
    if (!pr.pullRequestId) throw new Error(`PR #${prId} not found.`);
    return {
      id:     pr.pullRequestId,
      title:  pr.title ?? '',
      url:    this.prUrl(pr.pullRequestId),
      status: String(pr.status ?? 'active'),
    };
  }

  async votePR(prId: number, vote: PRVote): Promise<void> {
    const api    = await this.api();
    const userId = await this.getCurrentUserId();
    await api.createPullRequestReviewer(
      { id: userId, vote: VOTE_VALUE[vote] },
      this.repo,
      prId,
      userId,
      this.project,
    );
  }

  async completePR(prId: number, strategy: MergeStrategy): Promise<void> {
    const api = await this.api();
    // Fetch current PR to obtain the last merge source commit — required by the API.
    const pr = await api.getPullRequest(this.repo, prId, this.project);
    await api.updatePullRequest(
      {
        status: PR_STATUS_COMPLETED,
        lastMergeSourceCommit: pr.lastMergeSourceCommit,
        completionOptions: {
          mergeStrategy:       MERGE_STRATEGY[strategy],
          deleteSourceBranch:  false,
          transitionWorkItems: true,
        },
      },
      this.repo,
      prId,
      this.project,
    );
  }

  async abandonPR(prId: number): Promise<void> {
    const api = await this.api();
    await api.updatePullRequest(
      { status: PR_STATUS_ABANDONED },
      this.repo,
      prId,
      this.project,
    );
  }

  async publishPR(prId: number): Promise<void> {
    const api = await this.api();
    await api.updatePullRequest(
      { isDraft: false },
      this.repo,
      prId,
      this.project,
    );
  }

  async getThreads(prId: number, activeOnly = true): Promise<PRThread[]> {
    const api     = await this.api();
    const threads = await api.getThreads(this.repo, prId, this.project);

    return threads
      .filter(t => t.isDeleted !== true)
      .filter(t => !activeOnly || t.status === THREAD_STATUS_ACTIVE || t.status === THREAD_STATUS_PENDING)
      .map(t => ({
        id:        t.id!,
        status:    mapThreadStatus(t.status),
        filePath:  t.threadContext?.filePath?.replace(/^\//, '') ?? undefined,
        startLine: t.threadContext?.rightFileStart?.line ?? undefined,
        comments: (t.comments ?? [])
          .filter(c => !c.isDeleted)
          .map(c => ({
            author:      c.author?.displayName ?? c.author?.uniqueName ?? 'Unknown',
            content:     c.content ?? '',
            publishedAt: c.publishedDate ?? new Date(),
          })),
      }))
      .filter(t => t.comments.length > 0);
  }

  async getChangedFiles(prId: number): Promise<PRFile[]> {
    const api = await this.api();

    // Get the latest iteration of the PR.
    const iterations = await api.getPullRequestIterations(this.repo, prId, this.project);
    if (!iterations.length) return [];
    const latestIteration = iterations[iterations.length - 1];
    const iterationId = latestIteration.id;
    if (!iterationId) return [];

    const changes = await api.getPullRequestIterationChanges(
      this.repo, prId, iterationId, this.project,
    );

    return (changes.changeEntries ?? [])
      .filter(c => c.item?.path)
      .map(c => ({
        path:         (c.item!.path!).replace(/^\//, ''),
        changeType:   mapChangeType(c.changeType ?? 0),
        originalPath: c.originalPath?.replace(/^\//, '') ?? undefined,
      }));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async api(): Promise<IGitApi> {
    if (!this.gitApi) {
      this.gitApi = await this.createConnection().getGitApi();
    }
    return this.gitApi;
  }

  private async getCurrentUserId(): Promise<string> {
    if (this.currentUserId) return this.currentUserId;
    const data = await this.createConnection().connect();
    const id   = data.authenticatedUser?.id;
    if (!id) throw new Error('Could not resolve current user identity from Azure DevOps.');
    this.currentUserId = id;
    return id;
  }

  private prUrl(id: number): string {
    return `https://dev.azure.com/${this.org}/${this.project}/_git/${this.repo}/pullrequest/${id}`;
  }
}

function mapChangeType(changeType: number): PRFile['changeType'] {
  // VersionControlChangeType flags: 1=add, 2=edit, 4=delete, 8=rename, 16=undelete, 32=branch
  if (changeType & 4)  return 'delete';
  if (changeType & 8)  return 'rename';
  if (changeType & 1)  return 'add';
  if (changeType & 2)  return 'edit';
  return 'other';
}

function mapThreadStatus(status?: number): PRThread['status'] {
  switch (status) {
    case 1: return 'active';
    case 2:
    case 3:
    case 5: return 'resolved';
    case 4: return 'closed';
    case 6: return 'pending';
    default: return 'other';
  }
}
