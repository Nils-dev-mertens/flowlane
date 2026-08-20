import { injectable, inject } from 'tsyringe';
import * as azdev from 'azure-devops-node-api';
import type { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import type { Comment as AzWorkItemComment, WorkItem } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { ITicketService } from '../interfaces/ITicketService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { CreateTicketParams, Ticket, TicketComment, TicketKind } from '../../types';
import { TOKENS } from '../../tokens';
import { getAzCliToken } from '../../utils/azCliAuth';
import { extractApiError, stripHtml } from './mappers';

const KIND_TO_WORK_ITEM_TYPE: Record<TicketKind, string> = {
  issue: 'Issue',
  task:  'Task',
  bug:   'Bug',
  story: 'User Story',
};

const TICKET_FIELDS = [
  'System.Id',
  'System.Title',
  'System.State',
  'System.BoardColumn',
  'System.WorkItemType',
  'System.AssignedTo',
  'System.TeamProject',
  'System.Parent',
  'System.Description',
];

const DEFAULT_CLOSED_STATES = ['Done', 'Removed', 'Closed', 'Resolved'];

@injectable()
export class AzureDevOpsTicketService implements ITicketService {
  private readonly connection: azdev.WebApi;
  private readonly org: string;
  private readonly project: string;
  private readonly team?: string;
  private readonly closedStates: string[];
  private witApi: IWorkItemTrackingApi | null = null;
  /** Cached WEF field name for the board column (e.g. "WEF_xxx_Kanban.Column"). */
  private boardColumnField: string | null | undefined = undefined; // undefined = not yet fetched

  constructor(@inject(TOKENS.ConfigService) config: IConfigService) {
    const ado        = config.getProviderConfig('azuredevops');
    const authMethod = ado.authMethod ?? 'pat';
    const org        = ado.org;
    this.org         = org;
    this.project     = ado.project;
    this.team        = ado.team;

    this.closedStates = ado.closedStates
      ? ado.closedStates.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_CLOSED_STATES;

    const authHandler = authMethod === 'az-cli'
      ? azdev.getBearerHandler(getAzCliToken())
      : azdev.getPersonalAccessTokenHandler(ado.token!);
    this.connection = new azdev.WebApi(`https://dev.azure.com/${org}`, authHandler);
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
    const notClosed = this.closedStates.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

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

  async createTicket(params: CreateTicketParams): Promise<Ticket> {
    const api = await this.api();
    const project = params.project ?? this.project;
    const workItemType = KIND_TO_WORK_ITEM_TYPE[params.kind ?? 'task'];

    const patch: { op: string; path: string; value: unknown }[] = [
      { op: 'add', path: '/fields/System.Title', value: params.title },
    ];
    if (params.description) {
      patch.push({ op: 'add', path: '/fields/System.Description', value: params.description });
    }
    if (params.assignee) {
      patch.push({ op: 'add', path: '/fields/System.AssignedTo', value: params.assignee });
    }
    if (params.labels && params.labels.length > 0) {
      patch.push({ op: 'add', path: '/fields/System.Tags', value: params.labels.join('; ') });
    }
    if (params.parentId) {
      // Link the new work item as a child of the parent via the hierarchy relation.
      patch.push({
        op:   'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `https://dev.azure.com/${encodeURIComponent(this.org)}/${encodeURIComponent(project)}/_apis/wit/workItems/${encodeURIComponent(params.parentId)}`,
        },
      });
    }

    try {
      const created = await api.createWorkItem({}, patch, project, workItemType);
      const fields = created.fields ?? {};
      const assignee = fields['System.AssignedTo'];
      return {
        id:          String(created.id),
        title:       fields['System.Title'] ?? params.title,
        status:      fields['System.State'] ?? 'New',
        type:        workItemType,
        url:         (created._links as Record<string, { href: string }> | undefined)?.html?.href,
        assignee:    typeof assignee === 'object' ? assignee?.displayName : assignee,
        description: params.description,
        parentId:    params.parentId,
      };
    } catch (err: unknown) {
      throw new Error(extractApiError(err));
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

  async addComment(id: string, text: string): Promise<TicketComment> {
    const api = await this.api();
    try {
      const comment = await api.addComment({ text }, this.project, parseInt(id, 10));
      return this.toComment(comment);
    } catch (err: unknown) {
      throw new Error(extractApiError(err));
    }
  }

  async getComments(id: string): Promise<TicketComment[]> {
    const api = await this.api();
    try {
      const list = await api.getComments(this.project, parseInt(id, 10), 100);
      return (list.comments ?? [])
        .map((comment) => this.toComment(comment))
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
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

    const team = this.team;
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
    const rawDescription = f['System.Description'] as string | undefined;
    return {
      id:          String(wi.id),
      title:       f['System.Title']       ?? '(No title)',
      status:      f['System.State']       ?? 'Unknown',
      boardColumn: f['System.BoardColumn'] as string | undefined,
      type:        f['System.WorkItemType'],
      url:         (wi._links as Record<string, { href: string }> | undefined)?.html?.href,
      assignee:    typeof assignee === 'object' ? assignee?.displayName : assignee,
      parentId:    f['System.Parent'] != null ? String(f['System.Parent']) : undefined,
      description: rawDescription ? stripHtml(rawDescription) : undefined,
    };
  }

  private toComment(comment: AzWorkItemComment): TicketComment {
    const author = comment.createdBy as { displayName?: string; uniqueName?: string } | undefined;
    return {
      id:          String(comment.id),
      author:      author?.displayName ?? author?.uniqueName ?? 'Unknown',
      content:     comment.text ?? '',
      publishedAt: comment.createdDate ?? new Date(0),
    };
  }
}
