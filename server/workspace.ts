import type { User, Workspace } from "../drizzle/schema";
import * as db from "./db";

/**
 * Every account owns exactly one workspace and there is no cross-workspace
 * administrator. The workspace is provisioned lazily on first authenticated
 * access so existing accounts, OAuth sign-ups and password sign-ups all
 * converge on the same path without a separate bootstrap step.
 */

const MAX_WORKSPACE_NAME_LENGTH = 80;

export const buildDefaultWorkspaceName = (user: {
  name?: string | null;
  email?: string | null;
}) => {
  const base =
    user.name?.trim() || user.email?.split("@")[0]?.trim() || "我";
  return `${base} 的客服`.slice(0, MAX_WORKSPACE_NAME_LENGTH);
};

export async function requireWorkspaceForUser(
  user: Pick<User, "id" | "name" | "email">
): Promise<Workspace> {
  const existing = await db.getWorkspaceByOwner(user.id);
  if (existing) return existing;

  return db.createWorkspaceForOwner({
    userId: user.id,
    name: buildDefaultWorkspaceName(user),
  });
}

export type WorkspaceContext = {
  workspace: Workspace;
  /** The signed-in owner; used as the actor for writes and quota accounting. */
  ownerUserId: number;
};

/**
 * Identifies who the agent is answering inside a workspace.
 * `contactId` unset means the owner testing from the console, which may see and
 * act on every ticket. A contact only ever sees its own tickets.
 */
export type ConversationScope = {
  workspaceId: number;
  ownerUserId: number;
  contactId?: number | null;
  channelId?: number | null;
};

export const consoleScope = (workspace: {
  id: number;
  ownerUserId: number;
}): ConversationScope => ({
  workspaceId: workspace.id,
  ownerUserId: workspace.ownerUserId,
  contactId: null,
  channelId: null,
});

export const isConsoleScope = (scope: ConversationScope) =>
  scope.contactId == null;
