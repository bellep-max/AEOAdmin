import { describe, it, expect } from "vitest";
import { parseIntent, buildRouterMessages } from "../intents";
import type { ChatScope } from "../types";

const scope: ChatScope = {
  clientId: 1,
  clientName: "Acme",
  businessId: null,
  businessName: null, aeoPlanId: null, campaignName: null,
};

describe("parseIntent", () => {
  it("accepts a well-formed business_summary intent", () => {
    const intent = parseIntent({
      kind: "business_summary",
      params: {},
      confidence: 0.9,
      needsClarification: false,
      echo: "overall summary",
    });
    expect(intent.kind).toBe("business_summary");
    expect(intent.needsClarification).toBe(false);
    expect(intent.confidence).toBe(0.9);
  });

  it("clamps confidence into [0,1]", () => {
    expect(
      parseIntent({ kind: "keyword_list", confidence: 5 }).confidence,
    ).toBe(1);
    expect(
      parseIntent({ kind: "keyword_list", confidence: -3 }).confidence,
    ).toBe(0);
  });

  it("normalizes platform casing and drops invalid platforms", () => {
    const ok = parseIntent({
      kind: "platform_comparison",
      confidence: 0.8,
      params: { platform: "ChatGPT" },
    });
    expect(ok.params.platform).toBe("chatgpt");
    const bad = parseIntent({
      kind: "platform_comparison",
      confidence: 0.8,
      params: { platform: "bing" },
    });
    expect(bad.params.platform).toBeNull();
  });

  it("forces an entity clarification for rank_trend with no keyword", () => {
    const intent = parseIntent({
      kind: "rank_trend",
      confidence: 0.95,
      params: {},
    });
    expect(intent.needsClarification).toBe(true);
    expect(intent.clarification?.kind).toBe("entity");
  });

  it("keeps rank_trend when a keyword is provided", () => {
    const intent = parseIntent({
      kind: "rank_trend",
      confidence: 0.9,
      params: { keyword: "best dentist austin" },
    });
    expect(intent.needsClarification).toBe(false);
    expect(intent.params.keyword).toBe("best dentist austin");
  });

  it("triggers clarification on low confidence for analytical intents", () => {
    const intent = parseIntent({
      kind: "business_summary",
      confidence: 0.2,
    });
    expect(intent.needsClarification).toBe(true);
    expect(intent.clarification?.options?.length).toBeGreaterThan(0);
  });

  it("preserves a model-supplied clarification with options", () => {
    const intent = parseIntent({
      kind: "top_movers",
      confidence: 0.4,
      needsClarification: true,
      clarification: {
        kind: "timeframe",
        question: "Which window?",
        options: [{ value: "last_30d", label: "Last 30 days" }],
      },
    });
    expect(intent.clarification?.kind).toBe("timeframe");
    expect(intent.clarification?.options?.[0]?.value).toBe("last_30d");
  });

  it("carries unsupportedReason for unsupported questions", () => {
    const intent = parseIntent({
      kind: "unsupported",
      confidence: 0.9,
      unsupportedReason: "There is no click tracking.",
    });
    expect(intent.kind).toBe("unsupported");
    expect(intent.unsupportedReason).toContain("click tracking");
  });

  it("validates a custom timeframe and rejects malformed dates", () => {
    const good = parseIntent({
      kind: "rank_trend",
      confidence: 0.9,
      params: {
        keyword: "x",
        timeframe: { token: "custom", from: "2026-01-01", to: "2026-02-01" },
      },
    });
    expect(good.params.timeframe).toEqual({
      token: "custom",
      from: "2026-01-01",
      to: "2026-02-01",
    });
    const bad = parseIntent({
      kind: "rank_trend",
      confidence: 0.9,
      params: { keyword: "x", timeframe: { token: "custom", from: "nope" } },
    });
    expect(bad.params.timeframe).toBeUndefined();
  });

  it("degrades any garbage input to a safe clarification, never throwing", () => {
    for (const junk of [
      null,
      undefined,
      42,
      "string",
      { kind: "nonsense" },
      {},
    ]) {
      const intent = parseIntent(junk);
      expect(intent.needsClarification).toBe(true);
      expect(intent.clarification).toBeDefined();
    }
  });
});

describe("buildRouterMessages", () => {
  it("includes a system prompt, recent history, and the user turn", () => {
    const msgs = buildRouterMessages(
      "compare it to last month",
      [
        { role: "user", text: "show me a summary" },
        { role: "assistant", text: "Here is the summary…" },
      ],
      scope,
    );
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("Acme");
    expect(msgs[msgs.length - 1]).toEqual({
      role: "user",
      content: "compare it to last month",
    });
  });

  it("truncates history to the last 6 turns", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      text: `msg ${i}`,
    }));
    const msgs = buildRouterMessages("now", history, scope);
    // 1 system + 6 history + 1 user
    expect(msgs.length).toBe(8);
  });
});
