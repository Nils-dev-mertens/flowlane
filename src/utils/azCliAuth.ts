import { execSync } from 'child_process';

/** Azure DevOps resource ID used by `az account get-access-token` */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

/**
 * Obtain a short-lived Bearer token from the Azure CLI.
 * Requires the user to be signed in via `az login`.
 * Tokens typically expire after ~1 hour; fine for CLI use since each
 * invocation fetches a fresh one.
 */
export function getAzCliToken(): string {
  try {
    const token = execSync(
      `az account get-access-token --resource ${ADO_RESOURCE_ID} --query accessToken -o tsv`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (!token) throw new Error('az returned an empty token');
    return token;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Azure CLI auth failed. Make sure you are signed in with "az login".\n${msg}`,
    );
  }
}
