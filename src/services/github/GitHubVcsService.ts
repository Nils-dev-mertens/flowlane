import { injectable, inject } from 'tsyringe';
import type { IPRService }     from '../interfaces/IPRService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { PullRequest, CreatePRParams } from '../../types';
import { TOKENS } from '../../tokens';

/**
 * GitHub VCS service stub.
 *
 * Implements IPRService so the DI container wires correctly.
 * Replace method bodies with calls to the GitHub REST API v3 or GraphQL API.
 *
 * Suggested library: @octokit/rest  →  npm install @octokit/rest
 *
 * Docs: https://docs.github.com/en/rest/pulls/pulls
 *
 * Implementation outline:
 *
 *   import { Octokit } from '@octokit/rest';
 *
 *   const octokit = new Octokit({ auth: this.config.get('vcsToken') ?? this.config.get('token') });
 *
 *   async createPR(params): Promise<PullRequest> {
 *     const { data } = await octokit.pulls.create({
 *       owner: this.config.get('org')!,
 *       repo:  this.config.get('repo') ?? this.config.get('project')!,
 *       title: `[${params.ticketId}] ${params.title}`,
 *       body:  params.description,
 *       head:  params.sourceBranch,
 *       base:  params.targetBranch,
 *     });
 *     return { id: data.number, title: data.title, url: data.html_url, status: data.state };
 *   }
 */
@injectable()
export class GitHubVcsService implements IPRService {
  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {}

  async createPR(_params: CreatePRParams): Promise<PullRequest> {
    throw new Error(
      'GitHub VCS service is not yet implemented. ' +
      'See src/services/github/GitHubVcsService.ts — add @octokit/rest to activate.',
    );
  }

  async linkWorkItem(_prId: string | number, _ticketId: string): Promise<void> {
    // GitHub PRs don't have native work-item links.
    // For Jira + GitHub: use the Jira API to post a remote link to the PR URL.
    throw new Error(
      'GitHub work-item linking is not yet implemented. ' +
      'See src/services/github/GitHubVcsService.ts to contribute.',
    );
  }
}
