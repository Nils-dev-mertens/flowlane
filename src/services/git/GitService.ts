import { injectable } from 'tsyringe';
import { execFileSync } from 'child_process';
import type { IGitService } from '../interfaces/IGitService';
import type { BranchInfo } from '../../types';

@injectable()
export class GitService implements IGitService {
  createBranch(name: string): BranchInfo {
    try {
      this.exec(['checkout', '-b', name]);
      return { name };
    } catch (err: unknown) {
      const msg = this.errMsg(err);
      if (msg.includes('already exists')) {
        // Branch already exists locally — switch to it instead.
        this.exec(['checkout', name]);
        return { name };
      }
      throw new Error(`Failed to create branch "${name}": ${msg}`);
    }
  }

  publishBranch(name: string): void {
    try {
      this.exec(['push', '-u', 'origin', name]);
    } catch (err: unknown) {
      throw new Error(`Failed to push branch "${name}": ${this.errMsg(err)}`);
    }
  }

  getCurrentBranch(): string {
    try {
      return this.exec(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    } catch (err: unknown) {
      throw new Error(`Failed to get current branch: ${this.errMsg(err)}`);
    }
  }

  private exec(args: string[]): string {
    return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' });
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error) {
      const e = err as Error & { stderr?: string };
      return (e.stderr || e.message).trim();
    }
    return String(err);
  }
}
