import { injectable, inject } from 'tsyringe';
import * as azdev from 'azure-devops-node-api';
import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type { GitPullRequest } from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { IPRService } from '../interfaces/IPRService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { PullRequest, CreatePRParams } from '../../types';
import { TOKENS } from '../../tokens';
import { getAzCliToken } from '../../utils/azCliAuth';

@injectable()
export class AzureDevOpsPRService implements IPRService {
  private readonly project: string;
  private readonly repo: string;
  private readonly org: string;
  private gitApi: IGitApi | null = null;

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

  async linkWorkItem(prId: string | number, ticketId: string): Promise<void> {
    const api = await this.api();
    await api.updatePullRequest(
      { workItemRefs: [{ id: String(ticketId), url: '' }] },
      this.repo,
      Number(prId),
      this.project,
    );
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async api(): Promise<IGitApi> {
    if (!this.gitApi) {
      this.gitApi = await this.createConnection().getGitApi();
    }
    return this.gitApi;
  }

  private prUrl(id: number): string {
    return `https://dev.azure.com/${this.org}/${this.project}/_git/${this.repo}/pullrequest/${id}`;
  }
}
