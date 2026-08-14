/**
 * Small provider boundary for the Jira Cloud REST API v3.
 *
 * Keeps Basic-auth headers, JSON parsing, error parsing, and search pagination
 * in one place so JiraTicketService stays focused on domain mapping and is easy
 * to test with a mocked `fetch`.
 *
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

export interface JiraApiClientOptions {
  /** Atlassian site subdomain, e.g. "acme.atlassian.net". */
  site: string;
  /** Account email used for Basic auth (paired with the API token). */
  email: string;
  /** Atlassian API token (id.atlassian.com → Security → API tokens). */
  apiToken: string;
  /** Override the API base path for tests or proxies. */
  baseUrl?: string;
}

const DEFAULT_API_PATH = '/rest/api/3';

/** Error raised for an unsuccessful Jira REST request. */
export class JiraApiError extends Error {
  readonly status?: number;
  readonly responseBody?: string;

  constructor(message: string, details: { status?: number; responseBody?: string } = {}) {
    super(message);
    this.name = 'JiraApiError';
    this.status = details.status;
    this.responseBody = details.responseBody;
  }
}

interface JiraErrorBody {
  errorMessages?: string[];
  errors?: Record<string, string>;
  message?: string;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
  total?: number;
  startAt?: number;
  maxResults?: number;
}

/** Raw issue shape returned by /rest/api/3/issue and /search. */
export interface JiraIssue {
  id: string;
  key: string;
  fields?: Record<string, unknown>;
  self?: string;
}

export class JiraApiClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(options: JiraApiClientOptions) {
    const site = options.site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.baseUrl = (options.baseUrl ?? `https://${site}${DEFAULT_API_PATH}`).replace(/\/$/, '');
    this.authHeader = `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString('base64')}`;
  }

  /** Base URL (without the /rest/api/3 path) used to build browser links. */
  get siteUrl(): string {
    return this.baseUrl.replace(/\/rest\/api\/3\/?$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const parsed = parseJson<T>(text);

    if (!response.ok) {
      throw this.restError(response, text, parsed);
    }
    if (text && parsed === undefined) {
      throw new JiraApiError('Jira API response was not valid JSON.', {
        status: response.status,
        responseBody: text,
      });
    }

    return (text ? parsed : {}) as T;
  }

  /** Run a JQL search and page through all results up to `maxResults`. */
  async search(jql: string, maxResults = 50): Promise<JiraIssue[]> {
    const items: JiraIssue[] = [];
    let startAt = 0;

    for (;;) {
      const params = new URLSearchParams({
        jql,
        startAt: String(startAt),
        maxResults: String(Math.min(maxResults - startAt, 50)),
      });
      const page = await this.request<JiraSearchResponse>('GET', `/search?${params.toString()}`);
      const issues = page.issues ?? [];
      items.push(...issues);

      const total = page.total ?? 0;
      startAt += issues.length;
      if (issues.length === 0 || startAt >= total || items.length >= maxResults) break;
    }

    return items.slice(0, maxResults);
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: this.authHeader,
      'User-Agent': 'flowlane-cli',
    };
  }

  private restError(response: Response, text: string, parsed: unknown): JiraApiError {
    const body = parsed && typeof parsed === 'object' ? (parsed as JiraErrorBody) : undefined;
    const detail = [
      body?.message,
      body?.errorMessages && body.errorMessages.length > 0 ? body.errorMessages.join('; ') : undefined,
      body?.errors && Object.keys(body.errors).length > 0
        ? Object.entries(body.errors).map(([k, v]) => `${k}: ${v}`).join('; ')
        : undefined,
    ]
      .filter(Boolean)
      .join('. ');

    return new JiraApiError(
      `Jira API error ${response.status}${detail ? `: ${detail}` : ''}.`,
      { status: response.status, responseBody: text },
    );
  }
}

function parseJson<T>(text: string): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
