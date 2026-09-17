import { describe, expect, it } from "vitest";
import { guestEmailFromPhone, normalizeSpokenPhone, toDialableE164 } from "./phone.js";

describe("normalizeSpokenPhone", () => {
  it("maps UK and Pakistan national numbers", () => {
    expect(normalizeSpokenPhone("07911 123456")).toBe("+447911123456");
    expect(normalizeSpokenPhone("020 7929 6680")).toBe("+442079296680");
    expect(normalizeSpokenPhone("03424432411")).toBe("+923424432411");
  });

  it("expands spoken digits", () => {
    expect(normalizeSpokenPhone("plus four four seven four four six eight six eight zero six seven")).toBe(
      "+447446868067",
    );
  });
});

describe("toDialableE164", () => {
  it("rejects Twilio placeholders", () => {
    expect(toDialableE164("+15555550100")).toBeUndefined();
    expect(toDialableE164("+442079296680")).toBe("+442079296680");
  });
});

describe("guestEmailFromPhone", () => {
  it("builds a stable guest address from the mobile", () => {
    expect(guestEmailFromPhone("+447446868067")).toBe("guest+447446868067@book.robinexis.test");
  });
});
