import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatVisuals } from "../ChatVisuals";
import { MessageList } from "../MessageList";
import type { ChatTurn, Dataset } from "@/lib/chatbot/types";

function summaryDataset(): Dataset {
  return {
    intentKind: "business_summary",
    scope: { clientId: 1, clientName: "Acme", businessId: null, businessName: null, aeoPlanId: null, campaignName: null },
    coverage: { earliest: "2026-05-01", latest: "2026-06-30", rowCount: 12, platforms: ["chatgpt"] },
    summary: {
      keywords: [],
      totalKeywords: 4,
      topThreeCount: 2,
      improvedCount: 3,
      declinedCount: 1,
      steadyCount: 0,
      avgCurrentPosition: 3.5,
    },
    isEmpty: false,
  };
}

describe("ChatVisuals", () => {
  it("renders KPI cards with values straight from the dataset", () => {
    render(<ChatVisuals dataset={summaryDataset()} />);
    expect(screen.getByTestId("chat-visuals")).toBeTruthy();
    expect(screen.getByText("In top 3")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // topThreeCount
    expect(screen.getByText("3.5")).toBeTruthy(); // avg position
    // Coverage note echoes the real date span.
    expect(screen.getByText(/2026-05-01/)).toBeTruthy();
  });

  it("renders a keyword table from keywordList", () => {
    const dataset: Dataset = {
      intentKind: "keyword_list",
      scope: { clientId: 1, clientName: "Acme", businessId: null, businessName: null, aeoPlanId: null, campaignName: null },
      coverage: { earliest: null, latest: null, rowCount: 2, platforms: [] },
      keywordList: [
        { keywordId: 1, keywordText: "best dentist", isActive: true, status: "new" },
        { keywordId: 2, keywordText: "emergency dentist", isActive: false, status: "locked" },
      ],
      isEmpty: false,
    };
    render(<ChatVisuals dataset={dataset} />);
    expect(screen.getByText("best dentist")).toBeTruthy();
    expect(screen.getByText("emergency dentist")).toBeTruthy();
  });

  it("renders nothing for an empty dataset", () => {
    const dataset: Dataset = {
      intentKind: "business_summary",
      scope: { clientId: 1, clientName: "Acme", businessId: null, businessName: null, aeoPlanId: null, campaignName: null },
      coverage: { earliest: null, latest: null, rowCount: 0, platforms: [] },
      isEmpty: true,
    };
    const { container } = render(<ChatVisuals dataset={dataset} />);
    expect(container.querySelector('[data-testid="chat-visuals"]')).toBeNull();
  });
});

describe("MessageList guardrail rendering", () => {
  const noop = vi.fn();

  it("shows a warning when the guardrail flags unverified figures", () => {
    const turns: ChatTurn[] = [
      {
        id: "a1",
        role: "assistant",
        text: "You rank #99 now.",
        status: "done",
        dataset: summaryDataset(),
        guardrail: { ok: false, violations: [{ value: "99", kind: "number" }], checkedCount: 1 },
      },
    ];
    render(<MessageList turns={turns} isBusy={false} onClarify={noop} />);
    const warning = screen.getByTestId("guardrail-warning");
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain("99");
  });

  it("shows a verified badge when all figures trace to data", () => {
    const turns: ChatTurn[] = [
      {
        id: "a2",
        role: "assistant",
        text: "All good.",
        status: "done",
        dataset: summaryDataset(),
        guardrail: { ok: true, violations: [], checkedCount: 3 },
      },
    ];
    render(<MessageList turns={turns} isBusy={false} onClarify={noop} />);
    expect(screen.getByTestId("guardrail-ok")).toBeTruthy();
  });

  it("renders a clarification selector for an awaiting-clarification turn", () => {
    const turns: ChatTurn[] = [
      {
        id: "a3",
        role: "assistant",
        text: "Which metric?",
        status: "awaiting-clarification",
        clarification: {
          kind: "metric",
          question: "Which metric?",
          options: [{ value: "business_summary", label: "Overall summary" }],
        },
      },
    ];
    render(<MessageList turns={turns} isBusy={false} onClarify={noop} />);
    expect(screen.getByTestId("clarify-panel")).toBeTruthy();
    expect(screen.getByText("Overall summary")).toBeTruthy();
  });
});
