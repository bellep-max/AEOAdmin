import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../llm-client", () => ({
  callJsonCompletion: vi.fn(),
  streamNarrative: vi.fn(),
}));
vi.mock("../../period-comparison", () => ({ rawFetch: vi.fn() }));

import { useChatbot } from "../useChatbot";
import { callJsonCompletion, streamNarrative } from "../llm-client";
import { rawFetch } from "../../period-comparison";
import type { ChatScope } from "../types";

const scopeA: ChatScope = { clientId: 1, clientName: "Acme", businessId: null, businessName: null, aeoPlanId: null, campaignName: null };
const scopeB: ChatScope = { clientId: 2, clientName: "Other", businessId: null, businessName: null, aeoPlanId: null, campaignName: null };

const ROWS = [
  { keywordId: 1, keyword: "best dentist", platform: "chatgpt", date: "2026-05-01", rankingPosition: 8, status: "success", searchAddress: null },
  { keywordId: 1, keyword: "best dentist", platform: "chatgpt", date: "2026-06-30", rankingPosition: 3, status: "success", searchAddress: null },
];

beforeEach(() => vi.clearAllMocks());

describe("scope switch mid-stream (data-integrity)", () => {
  it("aborts the in-flight narrative and does not write it into the new scope", async () => {
    vi.mocked(callJsonCompletion).mockResolvedValue({ kind: "business_summary", confidence: 0.9 });
    vi.mocked(rawFetch).mockResolvedValue({ ok: true, json: async () => ({ data: ROWS }) } as Response);

    // Narrative that never resolves until we release it — simulates a slow stream.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(streamNarrative).mockImplementation(async (_m, onToken, signal) => {
      await gate;
      if (signal?.aborted) return "";
      onToken("Business A narrative with #3.");
      return "Business A narrative with #3.";
    });

    const { result } = renderHook(() => useChatbot());
    act(() => result.current.setScope(scopeA));
    act(() => result.current.sendMessage("summary"));

    // Wait until the assistant turn is streaming with its dataset attached.
    await waitFor(() => {
      const last = result.current.turns.at(-1);
      expect(last?.status).toBe("streaming");
      expect(last?.dataset).toBeDefined();
    });

    // Switch business while the narrative is still in flight.
    act(() => result.current.setScope(scopeB));
    expect(result.current.turns).toHaveLength(0);

    // Now let the old stream finish — it must NOT resurrect a turn.
    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.turns).toHaveLength(0);
    expect(result.current.scope?.clientId).toBe(2);
  });
});
