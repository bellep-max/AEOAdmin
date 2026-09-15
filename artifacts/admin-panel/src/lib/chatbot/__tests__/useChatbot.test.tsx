import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the LLM transport: classification + narrative streaming.
vi.mock("../llm-client", () => ({
  callJsonCompletion: vi.fn(),
  streamNarrative: vi.fn(),
}));

// Mock rawFetch so the data layer returns fixture rows, no network.
vi.mock("../../period-comparison", () => ({
  rawFetch: vi.fn(),
}));

import { useChatbot } from "../useChatbot";
import { callJsonCompletion, streamNarrative } from "../llm-client";
import { rawFetch } from "../../period-comparison";
import type { ChatScope } from "../types";

const scope: ChatScope = {
  clientId: 1,
  clientName: "Acme",
  businessId: null,
  businessName: null, aeoPlanId: null, campaignName: null,
};

const rows = [
  { keywordId: 1, keyword: "best dentist", platform: "chatgpt", date: "2026-05-01", rankingPosition: 8, status: "success" },
  { keywordId: 1, keyword: "best dentist", platform: "chatgpt", date: "2026-06-30", rankingPosition: 3, status: "success" },
  { keywordId: 2, keyword: "emergency dentist", platform: "gemini", date: "2026-05-10", rankingPosition: 2, status: "success" },
];

function mockRawWith(data: unknown[]): void {
  vi.mocked(rawFetch).mockImplementation((path: string) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        path.startsWith("/api/keywords") ? data : { data },
    } as Response),
  );
}

function narrativeReturns(text: string): void {
  vi.mocked(streamNarrative).mockImplementation(async (_messages, onToken) => {
    onToken(text);
    return text;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useChatbot pipeline", () => {
  it("business summary → dataset + narrative + verified guardrail", async () => {
    vi.mocked(callJsonCompletion).mockResolvedValue({
      kind: "business_summary",
      params: {},
      confidence: 0.95,
      needsClarification: false,
    });
    mockRawWith(rows);
    narrativeReturns("Here is a clear summary of your ranking performance.");

    const { result } = renderHook(() => useChatbot());
    act(() => result.current.setScope(scope));
    act(() => result.current.sendMessage("show me a summary"));

    await waitFor(() => {
      const last = result.current.turns.at(-1);
      expect(last?.role).toBe("assistant");
      expect(last?.status).toBe("done");
    });

    const last = result.current.turns.at(-1)!;
    expect(last.dataset?.summary?.totalKeywords).toBe(2);
    expect(last.text).toContain("summary");
    expect(last.guardrail?.ok).toBe(true);
  });

  it("ambiguous query → clarification, no fabricated answer", async () => {
    vi.mocked(callJsonCompletion).mockResolvedValue({
      kind: "business_summary",
      params: {},
      confidence: 0.2, // low → parseIntent forces clarification
    });
    mockRawWith(rows);

    const { result } = renderHook(() => useChatbot());
    act(() => result.current.setScope(scope));
    act(() => result.current.sendMessage("how are things"));

    await waitFor(() => {
      const last = result.current.turns.at(-1);
      expect(last?.status).toBe("awaiting-clarification");
    });
    const last = result.current.turns.at(-1)!;
    expect(last.clarification).toBeDefined();
    expect(last.dataset).toBeUndefined();
    // Narrative LLM must NOT have been called for an ambiguous turn.
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("resolving a clarification re-runs and produces data", async () => {
    vi.mocked(callJsonCompletion).mockResolvedValue({
      kind: "business_summary",
      params: {},
      confidence: 0.2,
    });
    mockRawWith(rows);
    narrativeReturns("Summary after you picked a metric.");

    const { result } = renderHook(() => useChatbot());
    act(() => result.current.setScope(scope));
    act(() => result.current.sendMessage("things?"));
    await waitFor(() =>
      expect(result.current.turns.at(-1)?.status).toBe("awaiting-clarification"),
    );
    const clarifyTurn = result.current.turns.at(-1)!;

    act(() =>
      result.current.resolveClarification(clarifyTurn.id, "business_summary", "Overall summary"),
    );
    await waitFor(() => {
      const last = result.current.turns.at(-1);
      expect(last?.status).toBe("done");
      expect(last?.dataset?.summary).toBeDefined();
    });
  });

  it("unsupported question → honest refusal, no dataset", async () => {
    vi.mocked(callJsonCompletion).mockResolvedValue({
      kind: "unsupported",
      confidence: 0.9,
      unsupportedReason: "there is no click or traffic data",
    });

    const { result } = renderHook(() => useChatbot());
    act(() => result.current.setScope(scope));
    act(() => result.current.sendMessage("how many clicks did we get"));

    await waitFor(() => expect(result.current.turns.at(-1)?.status).toBe("done"));
    const last = result.current.turns.at(-1)!;
    expect(last.text.toLowerCase()).toContain("can't answer");
    expect(last.text).toContain("click");
    expect(last.dataset).toBeUndefined();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("empty data → canned honest reply, no LLM narrative", async () => {
    vi.mocked(callJsonCompletion).mockResolvedValue({
      kind: "business_summary",
      confidence: 0.9,
    });
    mockRawWith([]);

    const { result } = renderHook(() => useChatbot());
    act(() => result.current.setScope(scope));
    act(() => result.current.sendMessage("summary please"));

    await waitFor(() => expect(result.current.turns.at(-1)?.status).toBe("done"));
    const last = result.current.turns.at(-1)!;
    expect(last.dataset?.isEmpty).toBe(true);
    expect(last.text.toLowerCase()).toContain("ranking data");
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("guardrail catches a fabricated figure in the narrative", async () => {
    vi.mocked(callJsonCompletion).mockResolvedValue({
      kind: "business_summary",
      confidence: 0.9,
    });
    mockRawWith(rows);
    // 99 is nowhere in the fixture data.
    narrativeReturns("Your keyword now ranks #99 with 5000 monthly clicks.");

    const { result } = renderHook(() => useChatbot());
    act(() => result.current.setScope(scope));
    act(() => result.current.sendMessage("summary"));

    await waitFor(() => expect(result.current.turns.at(-1)?.status).toBe("done"));
    const last = result.current.turns.at(-1)!;
    expect(last.guardrail?.ok).toBe(false);
    const flagged = last.guardrail?.violations.map((v) => v.value) ?? [];
    expect(flagged).toContain("99");
    expect(flagged).toContain("5000");
  });

  it("switching scope clears the transcript", async () => {
    vi.mocked(callJsonCompletion).mockResolvedValue({
      kind: "business_summary",
      confidence: 0.9,
    });
    mockRawWith(rows);
    narrativeReturns("Summary.");

    const { result } = renderHook(() => useChatbot());
    act(() => result.current.setScope(scope));
    act(() => result.current.sendMessage("summary"));
    await waitFor(() => expect(result.current.turns.length).toBeGreaterThan(0));

    act(() =>
      result.current.setScope({
        clientId: 2,
        clientName: "Other",
        businessId: null,
        businessName: null, aeoPlanId: null, campaignName: null,
      }),
    );
    expect(result.current.turns).toHaveLength(0);
  });
});
