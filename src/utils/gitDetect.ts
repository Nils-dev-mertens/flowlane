import { execSync } from 'child_process';
import type { FlowlaneConfig } from '../types';

export interface GitDetectedConfig extends Partial<FlowlaneConfig> {
  /** True when we found at least one useful field. */
  detected: boolean;
}

/** Run a git command and return stdout, or undefined on failure. */
function gitTry(cmd: string): string | undefined {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Parse a GitHub remote URL into { org, repo }. */
function parseGitHubUrl(
  url: string,
): { org: string; repo: string } | undefined {
  // HTTPS: https://github.com/{owner}/{repo}(.git)
  const https = url.match(/github\.com\/([^/]+)\/([^/\s.]+?)(?:\.git)?$/);
  if (https) return { org: https[1], repo: https[2] };

  // SSH: git@github.com:{owner}/{repo}(.git)
  const ssh = url.match(/git@github\.com:([^/]+)\/([^/\s.]+?)(?:\.git)?$/);
  if (ssh) return { org: ssh[1], repo: ssh[2] };

  return undefined;
}

/** Parse an Azure DevOps remote URL into { org, project, repo }. */
function parseAzureDevOpsUrl(
  url: string,
): { org: string; project: string; repo: string } | undefined {
  // HTTPS:  https://dev.azure.com/{org}/{project}/_git/{repo}
  const https = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/);
  if (https) return { org: https[1], project: https[2], repo: https[3] };

  // SSH:    git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const ssh = url.match(/ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+)/);
  if (ssh) return { org: ssh[1], project: ssh[2], repo: ssh[3] };

  // Legacy: https://{org}.visualstudio.com/{project}/_git/{repo}
  const legacy = url.match(/([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?#]+)/);
  if (legacy) return { org: legacy[1], project: legacy[2], repo: legacy[3] };

  return undefined;
}

/**
 * Inspect the current git repo and return whatever config fields can be
 * inferred automatically.  All fields are optional — never throws.
 */
export function detectFromGit(): GitDetectedConfig {
  const result: GitDetectedConfig = { detected: false };

  // ── Remote URL ──────────────────────────────────────────────────────────────
  const remoteUrl =
    gitTry('git remote get-url origin') ??
    gitTry('git remote get-url upstream');

  if (remoteUrl) {
    // Azure DevOps
    const ado = parseAzureDevOpsUrl(remoteUrl);
    if (ado) {
      result.platform = 'azuredevops';
      result.org      = ado.org;
      result.project  = ado.project;
      result.repo     = ado.repo;
      result.detected = true;
    }

    // GitHub
    const gh = parseGitHubUrl(remoteUrl);
    if (gh) {
      result.platform = 'github';
      result.org      = gh.org;
      result.repo     = gh.repo;
      result.project  = gh.repo; // project = repo for GitHub
      result.detected = true;
    }
  }

  // ── Default branch ──────────────────────────────────────────────────────────
  // Try symbolic-ref first (works after `git fetch`)
  const symref = gitTry('git symbolic-ref refs/remotes/origin/HEAD --short');
  if (symref) {
    // e.g. "origin/main" → "main"
    result.baseBranch = symref.replace(/^origin\//, '');
    result.detected   = true;
  } else {
    // Fallback: read the local HEAD branch name as a reasonable default
    const head = gitTry('git rev-parse --abbrev-ref HEAD');
    if (head && head !== 'HEAD') {
      // Only use HEAD if it looks like a main/master/trunk style branch
      if (/^(main|master|trunk|develop)$/.test(head)) {
        result.baseBranch = head;
        result.detected   = true;
      }
    }
  }

  // ── User email from git config ───────────────────────────────────────────────
  const email = gitTry('git config user.email');
  if (email) {
    result.user     = email;
    result.detected = true;
  }

  return result;
}
