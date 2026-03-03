import * as azdev from 'azure-devops-node-api';

export interface BoardColumnInfo {
  name: string;
  /** true = Outgoing (Done) column — should be excluded from active ticket list */
  isOutgoing: boolean;
  /** Unique System.State values this column maps to, per work-item type */
  states: string[];
}

/**
 * Fetch the columns of the main board for a given Azure DevOps team.
 * Returns null if the board cannot be reached (caller can fall back to manual input).
 */
export async function fetchBoardColumns(
  org: string,
  project: string,
  token: string,
  team: string,
): Promise<BoardColumnInfo[]> {
  const authHandler = azdev.getPersonalAccessTokenHandler(token);
  const connection  = new azdev.WebApi(`https://dev.azure.com/${org}`, authHandler);
  const workApi     = await connection.getWorkApi();

  const teamContext = { project, team };

  const boards = await workApi.getBoards(teamContext);
  if (!boards || boards.length === 0) {
    throw new Error(`No boards found for team "${team}" in project "${project}".`);
  }

  // Use the first board (the primary backlog board)
  const board = await workApi.getBoard(teamContext, boards[0].id!);

  return (board.columns ?? [])
    .filter((col) => col.name)
    .map((col) => {
      const mappings = col.stateMappings ?? {};
      const states   = [...new Set(Object.values(mappings).filter(Boolean))] as string[];
      return {
        name:       col.name!,
        isOutgoing: col.columnType === 2, // BoardColumnType.Outgoing
        states,
      };
    });
}
