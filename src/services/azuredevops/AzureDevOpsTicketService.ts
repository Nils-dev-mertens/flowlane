import { injectable, inject } from 'tsyringe';
import * as azdev from 'azure-devops-node-api';
import type { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import type { WorkItem } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { ITicketService } from '../interfaces/ITicketService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { Ticket } from '../../types';
import { TOKENS } from '../../tokens';
import { getAzCliToken } from '../../utils/azCliAuth';

const TICKET_FIELDS = [
  'System.Id',
  'System.Title',
  'System.State',
  'System.BoardColumn',
  'System.WorkItemType',
  'System.AssignedTo',
  'System.TeamProject',
  'System.Parent',
];

const DEFAULT_CLOSED_STATES = ['Done', 'Removed', 'Closed', 'Resolved'];

@injectable()
export class AzureDevOpsTicketService implements ITicketService {
  private readonly connection: azdev.WebApi;
  private readonly project: string;
  private readonly closedStates: string[];
  private witApi: IWorkItemTrackingApi | null = null;
  /** Cached WEF field name for the board column (e.g. "WEF_xxx_Kanban.Column"). */
  private boardColumnField: string | null | undefined = undefined; // undefined = not yet fetched

  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {
    const token = config.get<string>('token')!;
    const org   = config.get<string>('org')!;
    this.project = config.get<string>('project')!;

    const closedRaw = config.get<string>('closedStates');
    this.closedStates = closedRaw
      ? closedRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_CLOSED_STATES;

    const authHandler = azdev.getPersonalAccessTokenHandler(token);
    this.connection   = new azdev.WebApi(`https://dev.azure.com/${org}`, authHandler);
  }
  
  async getTicket(id: string): Promise<Ticket> {
    const api = await this.api();
    const workItem = await api.getWorkItem(
      parseInt(id, 10),
      TICKET_FIELDS,
      undefined,
      undefined,
      this.project,
    );
    if (!workItem) {
      throw new Error(`Work item ${id} not found in project "${this.project}"`);
    }
    return this.map(workItem);
  }

  async getTicketsForUser(user: string): Promise<Ticket[]> {
    const api = await this.api();

    // Use single-quotes inside WIQL; escape any single-quotes in the user string.
    const safeUser = user.replace(/'/g, "''");
    const notClosed = this.closedStates.map((s) => `'${s}'`).join(', ');

    const wiql = {
      query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.TeamProject] = '${this.project}'
          AND [System.AssignedTo] = '${safeUser}'
          AND [System.State] NOT IN (${notClosed})
        ORDER BY [System.ChangedDate] DESC
      `,
    };

    const result = await api.queryByWiql(wiql, { project: this.project });

    const ids = (result.workItems ?? [])
      .map((wi) => wi.id)
      .filter((id): id is number => id !== undefined)
      .slice(0, 50);                         // cap at 50 for display performance

    if (ids.length === 0) return [];

    // SDK signature: getWorkItems(ids, fields?, asOf?, expand?, errorPolicy?, project?)
    const workItems = await api.getWorkItems(
      ids,
      TICKET_FIELDS,  // fields — 2nd param
      undefined,      // asOf
      undefined,      // expand
      undefined,      // errorPolicy
      this.project,   // project — 6th param
    );

    const assigned = (workItems ?? []).filter(Boolean).map((wi) => this.map(wi));

    // Fetch parent work items (e.g. User Stories) for grouping context.
    const assignedIds = new Set(assigned.map((t) => t.id));
    const parentIds = [
      ...new Set(
        assigned
          .map((t) => t.parentId)
          .filter((id): id is string => !!id && !assignedIds.has(id)),
      ),
    ]
      .map(Number)
      .filter(Boolean);

    if (parentIds.length === 0) return assigned;

    try {
      const parentItems = await api.getWorkItems(
        parentIds,
        TICKET_FIELDS,
        undefined,
        undefined,
        undefined,
        this.project,
      );
      const parents = (parentItems ?? [])
        .filter(Boolean)
        .map((wi) => ({ ...this.map(wi), isContext: true }));
      return [...parents, ...assigned];
    } catch {
      // Parent fetch is best-effort; return assigned items without grouping context.
      return assigned;
    }
  }

  async updateStatus(id: string, state: string, boardColumn?: string): Promise<void> {
    const api = await this.api();
    const patch: { op: string; path: string; value: string }[] = [
      { op: 'add', path: '/fields/System.State', value: state },
    ];

    if (boardColumn) {
      // System.BoardColumn is read-only. The writable field is a team-specific
      // WEF_{guid}_Kanban.Column field — fetch it once from the board definition.
      const columnField = await this.getBoardColumnField();
      if (columnField) {
        patch.push({ op: 'add', path: `/fields/${columnField}`, value: boardColumn });
      }
    }

    try {
      await api.updateWorkItem({}, patch, parseInt(id, 10), this.project);
    } catch (err: unknown) {
      throw new Error(extractApiError(err));
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async api(): Promise<IWorkItemTrackingApi> {
    if (!this.witApi) {
      this.witApi = await this.connection.getWorkItemTrackingApi();
    }
    return this.witApi;
  }

  /**
   * Returns the team-specific writable field for the board column
   * (e.g. "WEF_abc123_Kanban.Column"). Fetched once and cached.
   * Returns null if the team is not configured or the board can't be reached.
   */
  private async getBoardColumnField(): Promise<string | null> {
    if (this.boardColumnField !== undefined) return this.boardColumnField;

    const team = this.config.get<string>('team');
    if (!team) {
      this.boardColumnField = null;
      return null;
    }

    try {
      const workApi     = await this.connection.getWorkApi();
      const teamContext = { project: this.project, team };
      const boards      = await workApi.getBoards(teamContext);
      if (!boards || boards.length === 0) {
        this.boardColumnField = null;
        return null;
      }
      const board = await workApi.getBoard(teamContext, boards[0].id!);
      this.boardColumnField = board.fields?.columnField?.referenceName ?? null;
    } catch {
      this.boardColumnField = null;
    }

    return this.boardColumnField;
  }

  private map(wi: WorkItem): Ticket {
    const f = wi.fields ?? {};
    const assignee = f['System.AssignedTo'];
    return {
      id:          String(wi.id),
      title:       f['System.Title']       ?? '(No title)',
      status:      f['System.State']       ?? 'Unknown',
      boardColumn: f['System.BoardColumn'] as string | undefined,
      type:        f['System.WorkItemType'],
      url:         (wi._links as Record<string, { href: string }> | undefined)?.html?.href,
      assignee:    typeof assignee === 'object' ? assignee?.displayName : assignee,
      parentId:    f['System.Parent'] != null ? String(f['System.Parent']) : undefined,
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Azure DevOps API errors come back as JSON in the response body, e.g.:
 *   { "message": "VS402903: Work item type Task does not have a state 'X'. Valid states are: ..." }
 * The SDK surfaces this as an Error whose message may be a raw JSON string.
 * This helper unwraps the most useful human-readable text.
 */
function extractApiError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const raw = err.message;
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
  } catch {
    // not JSON — use as-is
  }
  return raw;
}
