import assert from "node:assert/strict";
import { fetchStripeBillingDetails } from "./stripe-billing";

/**
 * Runnable unit test (no runner / no network / no real key):
 *   ./scripts/node_modules/.bin/tsx \
 *     artifacts/api-server/src/services/stripe-billing.test.ts
 */

const FAKE_KEY = "test-api-key-placeholder";

/** Fake fetch that routes by URL substring to canned JSON payloads. */
function routeFetch(
  routes: Array<[string, unknown]>,
  calls: string[] = [],
): typeof fetch {
  return (async (url: string) => {
    calls.push(url);
    const hit = routes.find(([frag]) => url.includes(frag));
    if (!hit)
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "no route",
      } as unknown as Response;
    return {
      ok: true,
      status: 200,
      json: async () => hit[1],
      text: async () => JSON.stringify(hit[1]),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const tests: Array<[string, () => Promise<void>]> = [
  [
    "cus_: pulls card + email from the customer, start = created, next = null",
    async () => {
      const r = await fetchStripeBillingDetails("cus_abc", {
        apiKey: FAKE_KEY,
        fetchImpl: routeFetch([
          [
            "customers/cus_abc?",
            {
              email: "owner@example.com",
              created: 1_700_000_000, // 2023-11-14
              invoice_settings: {
                default_payment_method: { card: { last4: "4503" } },
              },
            },
          ],
        ]),
      });
      assert.equal(r.stripeId, "cus_abc");
      assert.equal(r.cardLast4, "4503");
      assert.equal(r.billingEmail, "owner@example.com");
      assert.equal(r.subscriptionStartDate, "2023-11-14");
      assert.equal(r.nextBillingDate, null);
    },
  ],
  [
    "cus_: no default PM → falls back to the payment_methods list",
    async () => {
      const calls: string[] = [];
      const r = await fetchStripeBillingDetails("cus_xyz", {
        apiKey: FAKE_KEY,
        fetchImpl: routeFetch(
          [
            [
              "customers/cus_xyz?",
              {
                email: "e@x.com",
                created: 1_700_000_000,
                invoice_settings: { default_payment_method: null },
              },
            ],
            ["payment_methods", { data: [{ card: { last4: "0650" } }] }],
          ],
          calls,
        ),
      });
      assert.equal(r.cardLast4, "0650");
      assert.ok(calls.some((u) => u.includes("payment_methods")));
    },
  ],
  [
    "sub_: pulls last4 + email + trial dates",
    async () => {
      const r = await fetchStripeBillingDetails("sub_1", {
        apiKey: FAKE_KEY,
        fetchImpl: routeFetch([
          [
            "subscriptions/sub_1?",
            {
              default_payment_method: { card: { last4: "4242" } },
              customer: { email: "billing@example.com" },
              trial_start: 1_700_000_000,
              trial_end: 1_701_209_600,
            },
          ],
        ]),
      });
      assert.equal(r.stripeId, "sub_1");
      assert.equal(r.cardLast4, "4242");
      assert.equal(r.billingEmail, "billing@example.com");
      assert.equal(r.subscriptionStartDate, "2023-11-14");
      assert.equal(r.nextBillingDate, "2023-11-28");
    },
  ],
  [
    "unknown prefix → nulls, id preserved, no fetch",
    async () => {
      const calls: string[] = [];
      const r = await fetchStripeBillingDetails("pi_999", {
        apiKey: FAKE_KEY,
        fetchImpl: routeFetch([], calls),
      });
      assert.equal(r.stripeId, "pi_999");
      assert.equal(r.cardLast4, null);
      assert.equal(calls.length, 0);
    },
  ],
  [
    "non-200 from Stripe → fail-soft nulls",
    async () => {
      const r = await fetchStripeBillingDetails("cus_bad", {
        apiKey: FAKE_KEY,
        fetchImpl: (async () =>
          ({
            ok: false,
            status: 404,
            json: async () => ({}),
            text: async () => "no such customer",
          }) as unknown as Response) as unknown as typeof fetch,
      });
      assert.equal(r.stripeId, "cus_bad");
      assert.equal(r.cardLast4, null);
    },
  ],
  [
    "fetch throws → fail-soft nulls, no throw",
    async () => {
      const r = await fetchStripeBillingDetails("cus_boom", {
        apiKey: FAKE_KEY,
        fetchImpl: (async () => {
          throw new Error("network down");
        }) as unknown as typeof fetch,
      });
      assert.equal(r.cardLast4, null);
    },
  ],
  [
    "no API key → skipped, nulls, id preserved, no fetch",
    async () => {
      const prev = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;
      let called = false;
      const r = await fetchStripeBillingDetails("cus_nokey", {
        fetchImpl: (async () => {
          called = true;
          return {} as Response;
        }) as unknown as typeof fetch,
      });
      if (prev) process.env.STRIPE_SECRET_KEY = prev;
      assert.equal(called, false);
      assert.equal(r.stripeId, "cus_nokey");
    },
  ],
];

async function main(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(err instanceof Error ? err.stack : err);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${tests.length} tests passed`);
}

void main();
