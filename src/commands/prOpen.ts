import * as p from '@clack/prompts';
import chalk from 'chalk';
import { errMsg } from '../utils/errors';
import { execSync } from 'child_process';
import { container } from '../container';
import { TOKENS }    from '../tokens';
import type { IPRService } from '../services/interfaces/IPRService';
import { resolvePRId }     from '../utils/prResolve';
import { safeSpinner }     from '../utils/tty';

/**
 * Open a pull request in the default browser.
 * Falls back to printing the URL if the OS open command fails.
 */
export async function prOpenCommand(prId?: string): Promise<void> {
  p.intro(chalk.bgCyan.black('  flowlane pr open  '));

  const prSvc = container.resolve<IPRService>(TOKENS.PRService);

  let id: number;
  try {
    id = await resolvePRId(prSvc, prId);
  } catch (err: unknown) {
    p.outro(chalk.red(errMsg(err)));
    process.exit(1);
  }

  // Fetch full PR to get the URL (in case it was resolved from branch).
  const spinner = safeSpinner();
  spinner.start(`Fetching PR #${chalk.cyan(id)}…`);

  let url: string;
  try {
    const pr = await prSvc.getPR(id);
    url = pr.url;
    spinner.stop(`${chalk.bold(pr.title)}`);
  } catch (err: unknown) {
    spinner.stop(chalk.red('Failed to fetch PR.'));
    throw new Error(errMsg(err));
  }

  openInBrowser(url);
  p.outro(`${chalk.green('✓')} Opened ${chalk.blue.underline(url)}`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function openInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32'  ? `start "" "${url}"` :
                                    `xdg-open "${url}"`;
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch {
    // Non-fatal — URL is printed in outro regardless.
  }
}
