import { injectable, inject } from 'tsyringe';
import type { ITicketService } from '../interfaces/ITicketService';
import type { IConfigService } from '../interfaces/IConfigService';
import type { CreateTicketParams, Ticket, TicketComment, TicketKind } from '../../types';
import { TOKENS } from '../../tokens';
import { JiraApiClient, JiraApiError, type JiraIssue } from './JiraApiClient';

/**
 * Jira Cloud issue operations behind the provider-neutral ITicketService.
 *
 * Uses the Jira REST API v3. Jira is ticket-only: it does not host pull
 * requests, so there is intentionally no Jira PR service.
 *
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

const KIND_TO_ISSUE_TYPE: Record<TicketKind, string> = {
  issue: 'Task',
  task:  'Task',
  bug:   'Bug',
  story: 'Story',
};

/** Jira statuses that count as "not closed" for the open-ticket list. */
const OPEN_STATUS_CATEGORIES = ['new', 'indeterminate'];

@injectable()
export class JiraTicketService implements ITicketService {
  private readonly api: JiraApiClient;
  private readonly project: string;
  private readonly configuredUser: string;

  constructor(@inject(TOKENS.ConfigService) config: IConfigService) {
    const jira = config.getProviderConfig('jira');
    const email = jira.user ?? '';
    this.project = jira.project;
    this.configuredUser = email;
    this.api = new JiraApiClient({
      site:     jira.site,
      email,
      apiToken: jira.token ?? '',
    });
  }

  async getTicket(id: string): Promise<Ticket> {
    const issue = await this.api.request<JiraIssue>('GET', `/issue/${encodeURIComponent(id)}`);
    return this.toTicket(issue);
  }

  async getTicketsForUser(user: string): Promise<Ticket[]> {
    const assignee = (user || this.configuredUser).trim();
    if (!assignee) {
      throw new JiraApiError(
        'Jira ticket listing requires the account email. ' +
        'Run `flowlane config set jira.user you@example.com`.',
      );
    }

    // `assignee` in JQL matches account email, display name, or accountId.
    const jql =
      `assignee = ${jqlQuote(assignee)} ` +
      `AND statusCategory in (${OPEN_STATUS_CATEGORIES.join(', ')}) ` +
      'ORDER BY updated DESC';

    const issues = await this.api.search(jql);
    return issues.map((issue) => this.toTicket(issue));
  }

  async updateStatus(id: string, state: string, boardColumn?: string): Promise<void> {
    // Jira has no board-column concept — the workflow state IS the transition.
    // Refuse rather than silently ignore a requested column (capability error).
    if (boardColumn) {
      throw new JiraApiError(
        'Jira has no board-column concept. Set `jira.activeStatus`/`jira.reviewStatus` ' +
        'to transition names instead of configuring a column.',
      );
    }

    const transitions = await this.api.request<{ transitions?: JiraTransition[] }>(
      'GET',
      `/issue/${encodeURIComponent(id)}/transitions`,
    );

    const target = (transitions.transitions ?? []).find((t) =>
      (t.to?.name ?? t.name ?? '').toLowerCase() === state.toLowerCase(),
    );

    if (!target) {
      const available = (transitions.transitions ?? [])
        .map((t) => t.to?.name ?? t.name)
        .filter(Boolean);
      throw new JiraApiError(
        `Jira has no transition to status "${state}". ` +
        `Available transitions: ${available.length ? available.join(', ') : 'none'}.`,
      );
    }

    await this.api.request(
      'POST',
      `/issue/${encodeURIComponent(id)}/transitions`,
      { transition: { id: target.id } },
    );
  }

  /**
   * Transition a Jira issue to the first transition matching `predicate`.
   * Used by close/reopen where the target status name varies between projects.
   */
  private async transitionTo(
    id: string,
    predicate: (t: JiraTransition) => boolean,
    description: string,
  ): Promise<void> {
    const transitions = await this.api.request<{ transitions?: JiraTransition[] }>(
      'GET',
      `/issue/${encodeURIComponent(id)}/transitions`,
    );

    const target = (transitions.transitions ?? []).find(predicate);
    if (!target) {
      const available = (transitions.transitions ?? [])
        .map((t) => t.to?.name ?? t.name)
        .filter(Boolean);
      throw new JiraApiError(
        `Jira has no transition to ${description}. ` +
        `Available transitions: ${available.length ? available.join(', ') : 'none'}.`,
      );
    }

    await this.api.request(
      'POST',
      `/issue/${encodeURIComponent(id)}/transitions`,
      { transition: { id: target.id } },
    );
  }

  async createTicket(params: CreateTicketParams): Promise<Ticket> {
    const issueType = this.resolveIssueType(params);

    const fields: Record<string, unknown> = {
      project:  { key: params.project ?? this.project },
      summary:  params.title,
      issuetype: { name: issueType },
    };

    if (params.description) {
      fields.description = textToAdf(params.description);
    }
    if (params.labels && params.labels.length > 0) {
      fields.labels = params.labels;
    }
    if (params.assignee) {
      fields.assignee = { id: await this.resolveAccountId(params.assignee) };
    }
    if (params.parentId) {
      // Jira represents hierarchy as a subtask under a parent issue key.
      fields.parent = { key: params.parentId };
    }

    const created = await this.api.request<JiraIssue>('POST', '/issue', { fields });
    return this.toTicket(created);
  }

  async addComment(id: string, text: string): Promise<TicketComment> {
    const comment = await this.api.request<JiraComment>(
      'POST',
      `/issue/${encodeURIComponent(id)}/comment`,
      { body: textToAdf(text) },
    );
    return this.toComment(comment);
  }

  async getComments(id: string): Promise<TicketComment[]> {
    const page = await this.api.request<{ comments?: JiraComment[] }>(
      'GET',
      `/issue/${encodeURIComponent(id)}/comment`,
    );
    return (page.comments ?? [])
      .map((comment) => this.toComment(comment))
      .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
  }

  async closeTicket(id: string): Promise<void> {
    await this.transitionTo(
      id,
      (t) =>
        (t.to?.name ?? t.name ?? '').toLowerCase() === 'done' ||
        t.to?.statusCategory?.key === 'done',
      'Done (closed)',
    );
  }

  async reopenTicket(id: string): Promise<void> {
    await this.transitionTo(
      id,
      (t) => t.to?.statusCategory?.key === 'new' || t.to?.statusCategory?.key === 'indeterminate',
      'an open status',
    );
  }

  async addLabels(id: string, labels: string[]): Promise<void> {
    const issue = await this.api.request<JiraIssue>(
      'GET',
      `/issue/${encodeURIComponent(id)}?fields=labels`,
    );
    const existing = Array.isArray(issue.fields?.labels)
      ? (issue.fields.labels as string[])
      : [];
    const merged = [...new Set([...existing, ...labels])];
    await this.api.request('PUT', `/issue/${encodeURIComponent(id)}`, {
      fields: { labels: merged },
    });
  }

  async assignTicket(id: string, assignee: string): Promise<void> {
    const accountId = await this.resolveAccountId(assignee);
    await this.api.request('PUT', `/issue/${encodeURIComponent(id)}`, {
      fields: { assignee: { id: accountId } },
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private resolveIssueType(params: CreateTicketParams): string {
    // A subtask must use a subtask issue type, not task/bug/story.
    if (params.parentId) return 'Sub-task';
    return KIND_TO_ISSUE_TYPE[params.kind ?? 'task'];
  }

  /** Resolve an email or display name to a Jira accountId (required by the API). */
  private async resolveAccountId(assignee: string): Promise<string> {
    // Account IDs are alphanumeric (e.g. "5b10ac8d82e05b22cc7d4ef5").
    if (/^[a-f0-9]{24,}$/i.test(assignee.trim())) return assignee.trim();

    const results = await this.api.request<Array<{ accountId: string }>>(
      'GET',
      `/user/search?query=${encodeURIComponent(assignee.trim())}`,
    );
    const accountId = results[0]?.accountId;
    if (!accountId) {
      throw new JiraApiError(
        `Could not resolve Jira user "${assignee}" to an account ID. ` +
        'Pass the account ID directly or check the email with `flowlane config set jira.user`.',
      );
    }
    return accountId;
  }

  private toTicket(issue: JiraIssue): Ticket {
    const f = issue.fields ?? {};
    const status = (f.status as { name?: string } | undefined)?.name ?? 'Unknown';
    const issueType = (f.issuetype as { name?: string } | undefined)?.name;
    const assignee = f.assignee as { displayName?: string; emailAddress?: string } | null | undefined;
    const parent = f.parent as { key?: string } | undefined;

    return {
      id:          issue.key,
      title:       (f.summary as string) ?? '(No summary)',
      status,
      type:        issueType,
      url:         `${this.api.siteUrl}/browse/${encodeURIComponent(issue.key)}`,
      assignee:    assignee?.displayName ?? assignee?.emailAddress,
      description: adfToText(f.description),
      ...(parent?.key ? { parentId: parent.key } : {}),
    };
  }

  private toComment(comment: JiraComment): TicketComment {
    return {
      id:          comment.id,
      author:      comment.author?.displayName ?? comment.author?.emailAddress ?? 'Unknown',
      content:     adfToText(comment.body) ?? '',
      publishedAt: comment.created ? new Date(comment.created) : new Date(0),
    };
  }
}

// ── JQL / ADF helpers ─────────────────────────────────────────────────────────

interface JiraTransition {
  id: string;
  name?: string;
  to?: { name?: string; statusCategory?: { key?: string; name?: string } };
}

interface JiraComment {
  id: string;
  author?: { displayName?: string; emailAddress?: string };
  created?: string;
  body?: unknown;
}

/** Quote a JQL string literal, escaping embedded quotes and backslashes. */
function jqlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Convert plain text into a minimal Atlassian Document Format (ADF) document.
 * Jira Cloud v3 requires ADF for the description field.
 */
function textToAdf(text: string): Record<string, unknown> {
  const paragraphs = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: (paragraphs.length ? paragraphs : ['']).map((line) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    })),
  };
}

/** Flatten an ADF document (or plain string) back into plain text for display. */
function adfToText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;

  const chunks: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') {
      chunks.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (typeof obj.text === 'string') chunks.push(obj.text);
      if (obj.content) walk(obj.content);
    }
  };
  walk(value);
  const text = chunks.join('').trim();
  return text || undefined;
}
