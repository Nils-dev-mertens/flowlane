import type { FlowlaneConfig, TicketProvider } from '../types';
import { resolveProviderConfig } from '../config/providers';

export type WorkflowAction = 'start' | 'review';

export interface WorkflowTarget {
  /** Status/state to set (e.g. System.State for ADO, transition name for Jira). */
  state?: string;
  /** Board column (Azure DevOps only). */
  column?: string;
}

/**
 * Resolve the status (and optional column) a workflow action should move a
 * ticket to, based on the *ticket* provider.
 *
 * Returns null when the provider has no concept of this action, so callers
 * can report a clear capability error instead of silently no-oping.
 *
 * - `azuredevops` → reads active/review status + column from its block.
 * - `jira`         → reads active/review transition name from its block.
 * - `github`       → always null (issues only support open/closed).
 */
export function workflowTarget(
  provider: TicketProvider,
  config: Partial<FlowlaneConfig>,
  action: WorkflowAction,
): WorkflowTarget | null {
  switch (provider) {
    case 'azuredevops': {
      const ado = resolveProviderConfig(config, 'azuredevops');
      if (action === 'start') {
        const state  = ado.activeStatus ?? 'Active';
        const column = ado.activeColumn;
        return { state, column };
      }
      const state  = ado.reviewStatus;
      const column = ado.reviewColumn;
      if (!state && !column) return null;
      return { state, column };
    }

    case 'jira': {
      const jira = resolveProviderConfig(config, 'jira');
      const state = action === 'start' ? jira.activeStatus : jira.reviewStatus;
      return state ? { state } : null;
    }

    case 'github':
      return null;
  }
}
