import * as p from '@clack/prompts';
import chalk from 'chalk';
import { fetchBoardColumns } from './azureBoard';
import type { IConfigService } from '../services/interfaces/IConfigService';

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
    /** Azure DevOps field name for System.State (e.g. 'reviewStatus'). */
    stateKey:  string;
    /** Azure DevOps field name for System.BoardColumn (e.g. 'reviewColumn'). */
    columnKey: string;
  },
): Promise<ColumnFix | null> {
  const ado     = cfg.getProviderConfig('azuredevops');
  const org     = ado.org;
  const project = ado.project;
  const token   = ado.token;
  const team    = ado.team;

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
      `Run ${chalk.cyan(`flowlane config set azuredevops.${opts.columnKey} "<column>"`)} ` +
      `and ${chalk.cyan(`flowlane config set azuredevops.${opts.stateKey} "<state>"`)} to fix manually.`,
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
