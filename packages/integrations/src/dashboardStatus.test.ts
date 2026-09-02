import { describe, expect, it } from "vitest";
import { bladesHairSeed } from "@robinexis/database";
import { calcomTenantFromClient } from "./dashboardStatus.js";

describe("tenant calendar resolution", () => {
  it("uses only the credential reference assigned to the tenant", () => {
    const client = bladesHairSeed();
    expect(calcomTenantFromClient(client, () => "tenant-key")).toEqual({
      apiKey: "tenant-key",
      username: client.calendar.username,
    });
  });

  it("fails closed instead of falling back to another tenant's shared key", () => {
    const client = bladesHairSeed();
    client.calendar.credentialRef = "MISSING_TENANT_KEY";
    expect(calcomTenantFromClient(client, () => undefined)).toEqual({
      apiKey: "",
      username: client.calendar.username,
    });
  });
});
