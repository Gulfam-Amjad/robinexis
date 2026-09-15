import type { SessionActor } from "@robinexis/api-contracts";
import { useSession } from "../state";

export type WorkspacePermissions = {
  isOperator: boolean;
  canAdministerPlatform: boolean;
  canCreateClients: boolean;
  canEditWorkspace: boolean;
  canPublishWorkspace: boolean;
  canActivateWorkspace: boolean;
  canManageMembers: boolean;
};

export function permissionsFor(actor?: SessionActor, clientId?: string): WorkspacePermissions {
  const isOperator = actor?.role === "operator";
  const workspaceRole = clientId ? actor?.clientRoles[clientId] : undefined;

  return {
    isOperator,
    canAdministerPlatform: Boolean(isOperator && actor?.capabilities?.administerPlatform !== false),
    canCreateClients: Boolean(isOperator && actor?.capabilities?.createClients !== false),
    canEditWorkspace: Boolean(isOperator || workspaceRole === "owner" || workspaceRole === "manager"),
    canPublishWorkspace: Boolean(isOperator || workspaceRole === "owner" || workspaceRole === "manager"),
    canActivateWorkspace: workspaceRole === "owner",
    canManageMembers: Boolean(isOperator || workspaceRole === "owner"),
  };
}

export function usePermissions(clientId?: string): WorkspacePermissions {
  const { actor } = useSession();
  return permissionsFor(actor, clientId);
}
