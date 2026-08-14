import type { PRFile, PRThread } from '../../types';

/**
 * Azure DevOps VersionControlChangeType flags → provider-neutral change type.
 * Flags: 1=add, 2=edit, 4=delete, 8=rename, 16=undelete, 32=branch.
 */
export function mapChangeType(changeType: number): PRFile['changeType'] {
  if (changeType & 4) return 'delete';
  if (changeType & 8) return 'rename';
  if (changeType & 1) return 'add';
  if (changeType & 2) return 'edit';
  return 'other';
}

/**
 * Azure DevOps CommentThreadStatus → provider-neutral thread status.
 * 1=active, 2=fixed, 3=won't fix, 4=closed, 5=by design, 6=pending.
 */
export function mapThreadStatus(status?: number): PRThread['status'] {
  switch (status) {
    case 1: return 'active';
    case 2:
    case 3:
    case 5: return 'resolved';
    case 4: return 'closed';
    case 6: return 'pending';
    default: return 'other';
  }
}

/**
 * Strips HTML tags and decodes common entities for terminal display.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Azure DevOps API errors come back as JSON in the response body, e.g.:
 *   { "message": "VS402903: Work item type Task does not have a state 'X'. ..." }
 * The SDK surfaces this as an Error whose message may be a raw JSON string.
 * This helper unwraps the most useful human-readable text.
 */
export function extractApiError(err: unknown): string {
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
