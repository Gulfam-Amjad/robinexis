import { describe, expect, it } from "vitest";
import type { SessionActor } from "@robinexis/api-contracts";
import { permissionsFor } from "./permissions.js";

const operator: SessionActor = {
  email: "operator@robinexis.test",
  role: "operator",
  clientRoles: {},
  capabilities: { administerPlatform: true, createClients: true },
};

describe("workspace permissions", () => {
  it("grants platform actions only to operators", () => {
    expect(permissionsFor(operator, "client_1")).toMatchObject({
      isOperator: true,
      canAdministerPlatform: true,
      canCreateClients: true,
      canEditWorkspace: true,
      canPublishWorkspace: true,
      canActivateWorkspace: false,
      canManageMembers: true,
    });
  });

  it("maps salon membership roles to workspace actions", () => {
    const owner: SessionActor = {
      email: "owner@salon.test",
      role: "salon",
      clientRoles: { client_1: "owner" },
    };
    const viewer: SessionActor = {
      email: "viewer@salon.test",
      role: "salon",
      clientRoles: { client_1: "viewer" },
    };
    const manager: SessionActor = {
      email: "manager@salon.test",
      role: "salon",
      clientRoles: { client_1: "manager" },
    };

    expect(permissionsFor(owner, "client_1")).toMatchObject({
      isOperator: false,
      canAdministerPlatform: false,
      canEditWorkspace: true,
      canPublishWorkspace: true,
      canActivateWorkspace: true,
      canManageMembers: true,
    });
    expect(permissionsFor(manager, "client_1")).toMatchObject({
      canEditWorkspace: true,
      canPublishWorkspace: true,
      canActivateWorkspace: false,
      canManageMembers: false,
    });
    expect(permissionsFor(viewer, "client_1")).toMatchObject({
      canEditWorkspace: false,
      canPublishWorkspace: false,
      canActivateWorkspace: false,
      canManageMembers: false,
    });
  });

  it("honours disabled operator capabilities", () => {
    expect(permissionsFor({
      ...operator,
      capabilities: { administerPlatform: false, createClients: false },
    })).toMatchObject({
      canAdministerPlatform: false,
      canCreateClients: false,
    });
  });

  it("grants no workspace or platform permissions to pending signups", () => {
    expect(permissionsFor({
      email: "new@business.test",
      role: "pending",
      clientRoles: {},
    }, "client_1")).toEqual({
      isOperator: false,
      canAdministerPlatform: false,
      canCreateClients: false,
      canEditWorkspace: false,
      canPublishWorkspace: false,
      canActivateWorkspace: false,
      canManageMembers: false,
    });
  });
});
