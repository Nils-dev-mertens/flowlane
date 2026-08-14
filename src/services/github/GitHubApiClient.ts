export interface GitHubApiClientOptions {
  /** Optional for anonymous public reads; required for writes and GraphQL. */
  token?: string;
  /** REST API base URL, defaulting to GitHub.com. */
  baseUrl?: string;
  /** Override the GraphQL endpoint for GitHub Enterprise deployments or tests. */
  graphqlUrl?: string;
  userAgent?: string;
}

export interface GitHubGraphQLError {
  message: string;
  type?: string;
  path?: Array<string | number>;
}

interface GitHubGraphQLResponse<T> {
  data?: T;
  errors?: GitHubGraphQLError[];
}

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_USER_AGENT = 'flowlane-cli';
const PAGE_SIZE = 100;

/**
 * Error raised for an unsuccessful GitHub REST or GraphQL request.
 * The message is safe for terminal display and includes rate-limit context
 * when GitHub provides it.
 */
export class GitHubApiError extends Error {
  readonly status?: number;
  readonly responseBody?: string;
  readonly rateLimitRemaining?: string | null;
  readonly rateLimitReset?: string | null;

  constructor(message: string, details: {
    status?: number;
    responseBody?: string;
    rateLimitRemaining?: string | null;
    rateLimitReset?: string | null;
  } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = details.status;
    this.responseBody = details.responseBody;
    this.rateLimitRemaining = details.rateLimitRemaining;
    this.rateLimitReset = details.rateLimitReset;
  }
}

/**
 * Small provider boundary shared by GitHub issue and pull-request services.
 * Keeping fetch, auth, pagination, and error parsing here makes the services
 * easier to test and keeps provider behavior consistent.
 */
export class GitHubApiClient {
  private readonly baseUrl: string;
  private readonly graphqlUrl: string;
  private readonly token: string | undefined;
  private readonly userAgent: string;

  constructor(options: GitHubApiClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.graphqlUrl = (options.graphqlUrl ?? `${this.baseUrl}/graphql`).replace(/\/$/, '');
    this.token = options.token;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  /** True when requests will use GitHub's authenticated rate limit. */
  get hasToken(): boolean {
    return Boolean(this.token);
  }

  async request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
    return (await this.requestWithResponse<T>(method, pathOrUrl, body)).value;
  }

  private async requestWithResponse<T>(
    method: string,
    pathOrUrl: string,
    body?: unknown,
  ): Promise<{ value: T; response: Response }> {
    if (method.toUpperCase() !== 'GET' && !this.token) {
      throw this.credentialError(`GitHub ${method.toUpperCase()} requests`);
    }

    const url = this.toUrl(pathOrUrl);
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
      throw new GitHubApiError('GitHub API response was not valid JSON.', {
        status: response.status,
        responseBody: text,
      });
    }

    return {
      value: text ? parsed as T : ({} as T),
      response,
    };
  }

  /** Fetch all pages of a GitHub REST collection. */
  async getPaginated<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    let nextUrl: string | undefined;

    do {
      const requestPath = nextUrl ?? addQuery(path, {
        per_page: String(PAGE_SIZE),
        page: String(page),
      });
      const result = await this.requestWithResponse<T[]>('GET', requestPath);
      const response = result.value;

      if (!Array.isArray(response)) {
        throw new GitHubApiError(`Expected a GitHub list response from ${requestPath}.`);
      }

      items.push(...response);
      nextUrl = undefined;
      page += 1;

      // GitHub's Link header is authoritative. Fall back to the conservative
      // short-page rule for mocks and compatible GitHub installations that do
      // not return pagination headers.
      nextUrl = getNextLink(result.response.headers.get('link'));
      if (!nextUrl && response.length === PAGE_SIZE) {
        nextUrl = addQuery(path, {
          per_page: String(PAGE_SIZE),
          page: String(page),
        });
      }
    } while (nextUrl);

    return items;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.token) {
      throw this.credentialError('GitHub GraphQL operations');
    }

    const response = await fetch(this.graphqlUrl, {
      method: 'POST',
      headers: {
        ...this.headers(),
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await response.text();
    const parsed = parseJson<GitHubGraphQLResponse<T>>(text);

    if (!response.ok) {
      throw this.restError(response, text, parsed);
    }

    if (!parsed) {
      throw new GitHubApiError('GitHub GraphQL response was not valid JSON.', {
        status: response.status,
        responseBody: text,
      });
    }

    if (parsed.errors && parsed.errors.length > 0) {
      const message = parsed.errors.map((error) => error.message).join('; ');
      throw new GitHubApiError(`GitHub GraphQL error: ${message}`, {
        status: response.status,
        responseBody: text,
        rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
        rateLimitReset: response.headers.get('x-ratelimit-reset'),
      });
    }

    if (parsed.data === undefined) {
      throw new GitHubApiError('GitHub GraphQL response did not contain data.', {
        status: response.status,
        responseBody: text,
      });
    }

    return parsed.data;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private credentialError(operation: string): GitHubApiError {
    return new GitHubApiError(
      `${operation} require a GitHub token. Public reads can run anonymously, ` +
      'but add a token with `flowlane init` or `flowlane config set token` for writes and the higher rate limit.',
    );
  }

  private toUrl(pathOrUrl: string): string {
    return pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
  }

  private restError(
    response: Response,
    text: string,
    parsed: unknown,
  ): GitHubApiError {
    const body = parsed && typeof parsed === 'object'
      ? parsed as { message?: string; errors?: unknown[] }
      : undefined;
    const detail = body?.message ?? (body?.errors ? ` ${JSON.stringify(body.errors)}` : '');
    const rateRemaining = response.headers.get('x-ratelimit-remaining');
    const rateReset = response.headers.get('x-ratelimit-reset');
    const retryAfter = response.headers.get('retry-after');
    const rateContext = response.status === 403 && rateRemaining === '0'
      ? ` GitHub rate limit resets at ${formatReset(rateReset)}.`
      : response.status === 429
      ? ` GitHub asked the client to retry after ${retryAfter ?? 'a short delay'}.`
      : '';

    return new GitHubApiError(
      `GitHub API error ${response.status}${detail ? `: ${detail}` : ''}.${rateContext}`,
      {
        status: response.status,
        responseBody: text,
        rateLimitRemaining: rateRemaining,
        rateLimitReset: rateReset,
      },
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

function addQuery(path: string, values: Record<string, string>): string {
  const url = new URL(path, DEFAULT_BASE_URL);
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, value);
  }
  return path.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`;
}

function getNextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  const next = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => /;\s*rel="next"/.test(part));
  if (!next) return undefined;
  return next.match(/^<([^>]+)>/)?.[1];
}

function formatReset(value: string | null): string {
  if (!value) return 'soon';
  const epoch = Number(value);
  if (!Number.isFinite(epoch)) return value;
  return new Date(epoch * 1000).toISOString();
}
