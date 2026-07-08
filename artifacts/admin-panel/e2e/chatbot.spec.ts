import { test, expect, type Page } from "@playwright/test";

/** Fixture ranking rows returned by the mocked /api/ranking-reports. */
const ROWS = [
  { keywordId: 1, keyword: "best dentist", platform: "chatgpt", date: "2026-05-01", rankingPosition: 8, status: "success" },
  { keywordId: 1, keyword: "best dentist", platform: "chatgpt", date: "2026-06-30", rankingPosition: 3, status: "success" },
  { keywordId: 2, keyword: "emergency dentist", platform: "gemini", date: "2026-05-10", rankingPosition: 2, status: "success" },
];

/** Mock every backend call the page makes: auth, layout, data, and the LLM. */
async function mockBackend(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { id: 1, email: "admin@example.com", name: "Admin", role: "admin" },
    }),
  );
  await page.route("**/api/dashboard/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/clients**", (route) =>
    route.fulfill({ json: [{ id: 1, businessName: "Acme Dental" }] }),
  );
  await page.route("**/api/businesses**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/aeo-plans**", (route) =>
    route.fulfill({ json: [{ id: 10, clientId: 1, businessId: 1, name: "Facelift Campaign", planType: "AEO Plan" }] }),
  );
  await page.route("**/api/ranking-reports**", (route) =>
    route.fulfill({ json: { meta: { total: ROWS.length }, data: ROWS } }),
  );

  // The LLM proxy: JSON classification (stream:false) or SSE narrative.
  await page.route("**/api/llm/chatbot/stream", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const lastUser = [...(body.messages ?? [])]
      .reverse()
      .find((m: { role: string }) => m.role === "user");
    const text: string = lastUser?.content ?? "";

    if (body.stream === false) {
      // Classification. "how are things" is deliberately vague → low confidence.
      const vague = /how are things/i.test(text);
      const intent = vague
        ? { kind: "business_summary", confidence: 0.2 }
        : { kind: "business_summary", params: {}, confidence: 0.95, needsClarification: false };
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(intent) } }] }),
      });
    }

    // Narrative stream — only figures present in the data.
    const sse =
      'data: {"choices":[{"delta":{"content":"Across 2026-05-01 to 2026-06-30, "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"your keyword climbed from #8 to #3."}}]}\n\n' +
      "data: [DONE]\n\n";
    return route.fulfill({ contentType: "text/event-stream", body: sse });
  });
}

async function selectClient(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: /select a client/i }).click();
  await page.getByRole("option", { name: label }).click();
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test("summary → narrative + visuals, guardrail verified", async ({ page }) => {
  await page.goto("/chatbot");
  await expect(page.getByRole("heading", { name: "Chatbot" })).toBeVisible();

  // Empty state until a business is chosen.
  await expect(page.getByText(/select a business above/i)).toBeVisible();

  await selectClient(page, "Acme Dental");
  await expect(page.getByTestId("active-scope")).toContainText("Acme Dental");

  // Suggestions appear; click the summary one.
  await page.getByRole("button", { name: /show me a summary/i }).click();

  // Assistant narrative streams in.
  await expect(page.getByText(/climbed from #8 to #3/i)).toBeVisible();
  // Code-built visuals render from the fetched data.
  await expect(page.getByTestId("chat-visuals")).toBeVisible();
  await expect(page.getByText("In top 3")).toBeVisible();
  // Guardrail verified every figure.
  await expect(page.getByTestId("guardrail-ok")).toBeVisible();
});

test("ambiguous question → clarification selector, not a guess", async ({ page }) => {
  await page.goto("/chatbot");
  await selectClient(page, "Acme Dental");

  await page.getByTestId("chat-input").fill("how are things");
  await page.getByTestId("chat-send").click();

  await expect(page.getByTestId("clarify-panel")).toBeVisible();
  // No visuals should have been produced for an ambiguous turn.
  await expect(page.getByTestId("chat-visuals")).toHaveCount(0);

  // Picking an option resolves it and produces an answer.
  await page.getByRole("button", { name: "Overall summary" }).click();
  await expect(page.getByTestId("chat-visuals")).toBeVisible();
});

test("switching business clears the transcript", async ({ page }) => {
  await page.goto("/chatbot");
  await selectClient(page, "Acme Dental");
  await page.getByRole("button", { name: /show me a summary/i }).click();
  await expect(page.getByTestId("message-list")).toBeVisible();

  // Re-open client select and the transcript resets to the empty/suggestions state.
  await page.getByRole("button", { name: /acme dental/i }).first().click();
  // (Same client re-selected via the combobox clears via setScope.)
  await page.getByRole("option", { name: "Acme Dental" }).click();
  await expect(page.getByTestId("suggestion").first()).toBeVisible();
});

test("can scope to a campaign; the chip and empty-state name it", async ({ page }) => {
  await page.goto("/chatbot");
  await selectClient(page, "Acme Dental");

  // Campaign select is the third combobox — open it and pick the campaign.
  await page.getByRole("button", { name: /all campaigns/i }).click();
  await page.getByRole("option", { name: "Facelift Campaign" }).click();

  await expect(page.getByTestId("active-scope")).toContainText("Facelift Campaign");
  await expect(page.getByText(/Facelift Campaign's rankings/i)).toBeVisible();
});
