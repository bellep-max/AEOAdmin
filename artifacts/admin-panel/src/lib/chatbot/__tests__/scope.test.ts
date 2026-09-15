import { describe, it, expect } from "vitest";
import { scopeFocus } from "../types";
import { buildNarrativeContext } from "../narrative";
import type { ChatScope, Dataset } from "../types";

const base: ChatScope = {
  clientId: 1,
  clientName: "Acme",
  businessId: null,
  businessName: null,
  aeoPlanId: null,
  campaignName: null,
};

describe("scopeFocus", () => {
  it("focuses the client when nothing deeper is selected", () => {
    expect(scopeFocus(base)).toEqual({ level: "client", name: "Acme" });
  });
  it("focuses the business when a business is selected", () => {
    expect(scopeFocus({ ...base, businessId: 2, businessName: "Downtown" })).toEqual({
      level: "business",
      name: "Downtown",
    });
  });
  it("focuses the campaign when selected (deepest wins)", () => {
    expect(
      scopeFocus({
        ...base,
        businessId: 2,
        businessName: "Downtown",
        aeoPlanId: 5,
        campaignName: "Fall Promo",
      }),
    ).toEqual({ level: "campaign", name: "Fall Promo" });
  });
});

describe("narrative context carries the focus", () => {
  it("passes the deepest focus (campaign) so the LLM names the right thing", () => {
    const ds: Dataset = {
      intentKind: "business_summary",
      scope: {
        ...base,
        businessId: 2,
        businessName: "Downtown",
        aeoPlanId: 5,
        campaignName: "Fall Promo",
      },
      coverage: { earliest: null, latest: null, rowCount: 0, platforms: [] },
      isEmpty: true,
    };
    const ctx = buildNarrativeContext(ds) as {
      focus: { level: string; name: string };
      campaign: string | null;
    };
    expect(ctx.focus).toEqual({ level: "campaign", name: "Fall Promo" });
    expect(ctx.campaign).toBe("Fall Promo");
  });
});
