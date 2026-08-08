import * as db from "../db";
import { consoleScope, requireWorkspaceForUser } from "../workspace";
import type { ConversationScope } from "../workspace";

export type McpUserContext = {
  id: number;
  workspaceId: number;
  /** The MCP server always acts as the workspace owner in their own console. */
  scope: ConversationScope;
};

export async function getMcpUserContext(): Promise<McpUserContext> {
  const rawUserId = process.env.MCP_USER_ID;
  const userId = rawUserId ? Number(rawUserId) : NaN;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(
      "MCP_USER_ID must be set to an existing numeric user id before starting the MCP server"
    );
  }

  const user = await db.getUserById(userId);
  if (!user) {
    throw new Error(`MCP_USER_ID ${userId} does not match an existing user`);
  }

  const workspace = await requireWorkspaceForUser(user);

  return {
    id: user.id,
    workspaceId: workspace.id,
    scope: consoleScope(workspace),
  };
}
