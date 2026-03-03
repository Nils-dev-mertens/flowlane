import * as p from '@clack/prompts';
import chalk from 'chalk';
import { fetchBoardColumns } from './azureBoard';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { FlowlaneConfig } from '../types';

export interface ColumnFix {
  state:  string;
  column: string;
}

/**
 * When a status update fails, offer an interactive prompt so the user can
 * pick the correct board column and retry.
 *
 * - Fetches live board columns when `team` is configured.
 * - Falls back to free-text input when the board can't be reached.
 * - Returns null when the user declines or cancels (caller should skip / continue).
 */
export async function offerColumnFix(
  cfg: IConfigService,
  opts: {
    /** Prompt shown in the column picker. */
    message:   string;
    /** Config key for System.State (e.g. 'activeStatus' | 'reviewStatus'). */
    stateKey:  keyof FlowlaneConfig;
    /** Config key for System.BoardColumn (e.g. 'activeColumn' | 'reviewColumn'). */
    columnKey: keyof FlowlaneConfig;
  },
): Promise<ColumnFix | null> {
  const org     = cfg.get<string>('org');
  const project = cfg.get<string>('project');
  const token   = cfg.get<string>('token');
  const team    = cfg.get<string>('team');

  let columns: Awaited<ReturnType<typeof fetchBoardColumns>> = [];
  if (org && project && token && team) {
    try {
      columns = await fetchBoardColumns(org, project, token, team);
    } catch { /* fall through to manual input */ }
  }

  const wantFix = await p.confirm({
    message: 'Would you like to set the correct status now?',
    initialValue: true,
  });

  if (p.isCancel(wantFix) || !wantFix) {
    if (columns.length > 0) {
      const lines = columns
        .map((c) => `  ${chalk.cyan(c.name.padEnd(22))} state: ${c.states.join(', ') || chalk.dim('(none)')}`)
        .join('\n');
      p.log.info(`Available columns:\n${lines}`);
    }
    p.log.warn(
      `Run ${chalk.cyan(`flowlane config set ${String(opts.columnKey)} "<column>"`)} ` +
      `and ${chalk.cyan(`flowlane config set ${String(opts.stateKey)} "<state>"`)} to fix manually.`,
    );
    return null;
  }

  if (columns.length > 0) {
    const pick = await p.select({
      message: opts.message,
      options: columns.map((col) => ({
        value: col.name,
        label: col.name,
        hint:  col.states.length > 0 ? `state: ${col.states.join(', ')}` : '',
      })),
    }) as string;
    if (p.isCancel(pick)) return null;

    const col = columns.find((c) => c.name === pick)!;
    return { state: col.states[0] ?? pick, column: pick };
  }

  // No board data available — ask for free text.
  const columnInput = await p.text({
    message: 'Board column name (as shown on your board):',
    placeholder: 'Doing',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(columnInput)) return null;

  const stateInput = await p.text({
    message: 'Underlying System.State for that column:',
    placeholder: 'Active',
    validate: (v) => v.trim() ? undefined : 'Required',
  }) as string;
  if (p.isCancel(stateInput)) return null;

  return { state: stateInput.trim(), column: columnInput.trim() };
}
