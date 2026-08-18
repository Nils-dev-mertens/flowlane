import chalk from 'chalk';
import { execFileSync, execSync, spawn } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PRFile, PRSummary } from '../types';

export interface EditorOptions {
  /** Editor command to run (default: config `editor` or `code`). */
  command?: string;
}

/**
 * Open a per-file diff of a pull request in the configured editor using
 * `--diff`. Materializes the base and head versions of the file from the
 * remote refs into temp files so the diff is always correct, without needing
 * to check out the PR branch. Falls back to opening the head version alone
 * for added files.
 */
export function openDiffInEditor(file: PRFile, pr: PRSummary, options: EditorOptions = {}): boolean {
  if (file.changeType === 'delete') {
    console.log(chalk.yellow(`  File was deleted — no diff to open for ${file.path}.`));
    return false;
  }

  const command = options.command ?? 'code';

  if (!isCommandAvailable(command)) {
    console.log(
      chalk.yellow(`  No editor found: "${command}" is not on your PATH. `) +
      chalk.dim(`Install it or configure one with \`flowlane config set editor <cmd>\`.`),
    );
    return false;
  }

  const base    = `origin/${pr.targetBranch}`;
  const head    = `origin/${pr.sourceBranch}`;

  const baseContent = gitShow(base, file.path);
  const headContent = gitShow(head, file.path);

  if (headContent === undefined && baseContent === undefined) {
    console.log(chalk.dim(`  Cannot resolve remote refs for ${file.path}.`));
    return false;
  }

  const dir = mkdtempSync(join(tmpdir(), 'flowlane-diff-'));
  let opened = false;
  try {
    const baseFile = join(dir, 'base-' + file.path.replace(/\//g, '_'));
    const headFile = join(dir, 'head-' + file.path.replace(/\//g, '_'));
    if (baseContent !== undefined) writeFileSync(baseFile, baseContent);
    if (headContent !== undefined) writeFileSync(headFile, headContent);

    const args = ['--diff'];
    if (baseContent !== undefined) args.push(baseFile);
    if (headContent !== undefined) args.push(headFile);

    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.unref();
      child.on('error', () => {
        console.log(chalk.yellow(`  No editor found: "${command}" is not on your PATH.`));
      });
      opened = true;
      console.log(`  ${chalk.green('✓')} Opened ${chalk.cyan(file.path)} in ${chalk.bold(command)}`);
    } catch {
      console.log(chalk.yellow(`  No editor found: "${command}" could not be launched.`));
    }
  } finally {
    // Temp files live under the OS temp dir and are cleaned up by the system.
    if (!opened) rmSync(dir, { recursive: true, force: true });
  }

  return opened;
}

/** True when the given command is resolvable on the current PATH. */
function isCommandAvailable(command: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v "${command}"`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Read a file version from a remote ref; returns undefined when unavailable. */
function gitShow(ref: string, path: string): string | undefined {
  try {
    return execSync(`git show "${ref}:${path}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}