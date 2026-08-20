/**
 * Obtain a token from the GitHub CLI.
 * Requires the user to be signed in via `gh auth login`.
 * The token is fetched fresh on every invocation so flowlane never stores it.
 */
export function getGhCliToken(): string {
  try {
    // `require` at call time (not a destructured import) so tests can mock
    // child_process.execSync and the CLI stays a thin git/gh wrapper.
    const token = require('child_process').execSync('gh auth token', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!token) throw new Error('gh returned an empty token');
    return token;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `GitHub CLI auth failed. Make sure you are signed in with "gh auth login".\n${msg}`,
    );
  }
}

/**
 * Resolve the effective GitHub token: the GitHub CLI token when the provider
 * is configured with `authMethod: gh-cli`, otherwise the stored PAT.
 */
export function resolveGithubToken(
  token: string | undefined,
  authMethod: 'pat' | 'gh-cli' | undefined,
): string | undefined {
  if (authMethod === 'gh-cli') return getGhCliToken();
  return token;
}