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
  'System.WorkItemType',
  'System.AssignedTo',
  'System.TeamProject',
];

const CLOSED_STATES = ['Done', 'Removed', 'Closed', 'Resolved'];

@injectable()
export class AzureDevOpsTicketService implements ITicketService {
  private readonly connection: azdev.WebApi;
  private readonly project: string;
  private witApi: IWorkItemTrackingApi | null = null;

  constructor(@inject(TOKENS.ConfigService) private readonly config: IConfigService) {
    const org        = config.get<string>('org')!;
    const authMethod = config.get<string>('authMethod') ?? 'pat';
    this.project     = config.get<string>('project')!;

    const authHandler = authMethod === 'az-cli'
      ? azdev.getBearerHandler(getAzCliToken())
      : azdev.getPersonalAccessTokenHandler(config.get<string>('token')!);

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
    const notClosed = CLOSED_STATES.map((s) => `'${s}'`).join(', ');

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

    return (workItems ?? []).filter(Boolean).map((wi) => this.map(wi));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const api = await this.api();
    const patch = [
      { op: 'add', path: '/fields/System.State', value: status },
    ];
    // SDK signature: updateWorkItem(customHeaders, document, id, project?, ...)
    await api.updateWorkItem({}, patch, parseInt(id, 10), this.project);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async api(): Promise<IWorkItemTrackingApi> {
    if (!this.witApi) {
      this.witApi = await this.connection.getWorkItemTrackingApi();
    }
    return this.witApi;
  }

  private map(wi: WorkItem): Ticket {
    const f = wi.fields ?? {};
    const assignee = f['System.AssignedTo'];
    return {
      id:       String(wi.id),
      title:    f['System.Title']      ?? '(No title)',
      status:   f['System.State']      ?? 'Unknown',
      type:     f['System.WorkItemType'],
      url:      (wi._links as Record<string, { href: string }> | undefined)?.html?.href,
      assignee: typeof assignee === 'object' ? assignee?.displayName : assignee,
    };
  }
}
