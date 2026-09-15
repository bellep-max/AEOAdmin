/**
 * Runnable unit test — no test runner, no deps:
 *   node scripts/lead-pull/core.test.ts
 * Uses in-memory fakes for source / submit / store — never touches the network.
 */
import assert from "node:assert/strict";
import {
  checkEligibility,
  leadKey,
  toFreeTrialPayload,
  runPull,
  type RawLead,
  type ProcessedStore,
  type SubmitResponse,
  type FreeTrialPayload,
} from "./core.ts";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

const eligible: RawLead = {
  email: "Owner@Joes-Plumbing.com",
  businessName: "Joe's Plumbing",
  address: "123 Main St, Miami, FL",
  service: "emergency plumber",
  stripeCustomerId: "cus_ABC123",
  leadRef: "L-1001",
};

function memStore(seed: string[] = []): ProcessedStore {
  const set = new Set(seed);
  return { has: (k) => set.has(k), add: (k) => void set.add(k) };
}

// ---- eligibility ---------------------------------------------------------
await test("eligibility: happy path", () => {
  assert.deepEqual(checkEligibility(eligible), { eligible: true });
});
await test("eligibility: missing email", () => {
  assert.equal(
    checkEligibility({ ...eligible, email: "  " }).reason,
    "missing-email",
  );
});
await test("eligibility: invalid email", () => {
  assert.equal(
    checkEligibility({ ...eligible, email: "not-an-email" }).reason,
    "invalid-email",
  );
});
await test("eligibility: missing business name", () => {
  assert.equal(
    checkEligibility({ ...eligible, businessName: "" }).reason,
    "missing-business-name",
  );
});
await test("eligibility: no card on file (missing)", () => {
  assert.equal(
    checkEligibility({ ...eligible, stripeCustomerId: null }).reason,
    "no-card-on-file",
  );
});
await test("eligibility: no card on file (not a cus_ id)", () => {
  assert.equal(
    checkEligibility({ ...eligible, stripeCustomerId: "sub_123" }).reason,
    "no-card-on-file",
  );
});
await test("eligibility: no baseline (no address/website/service)", () => {
  assert.equal(
    checkEligibility({
      ...eligible,
      address: null,
      website: null,
      service: null,
    }).reason,
    "no-business-baseline",
  );
});
await test("eligibility: website alone satisfies baseline", () => {
  assert.equal(
    checkEligibility({
      ...eligible,
      address: null,
      service: null,
      website: "https://joes.com",
    }).eligible,
    true,
  );
});

// ---- leadKey -------------------------------------------------------------
await test("leadKey: prefers leadRef", () => {
  assert.equal(leadKey(eligible), "ref:L-1001");
});
await test("leadKey: falls back to lowercased email", () => {
  assert.equal(
    leadKey({ ...eligible, leadRef: null }),
    "email:owner@joes-plumbing.com",
  );
});

// ---- transform -----------------------------------------------------------
await test("transform: normalizes email + maps fields + defaults", () => {
  const p = toFreeTrialPayload(eligible);
  assert.equal(p.email, "owner@joes-plumbing.com");
  assert.equal(p.businessName, "Joe's Plumbing");
  assert.equal(p.signupType, "trial");
  assert.equal(p.source, "lead-pull");
  assert.equal(p.stripeCustomerId, "cus_ABC123");
  assert.equal(p.leadRef, "L-1001");
});
await test("transform: honors direct signupType + custom source", () => {
  const p = toFreeTrialPayload({
    ...eligible,
    signupType: "direct",
    source: "website",
  });
  assert.equal(p.signupType, "direct");
  assert.equal(p.source, "website");
});
await test("transform: filters blank keywords; omits when empty", () => {
  const withKw = toFreeTrialPayload({
    ...eligible,
    keywords: ["  best plumber  ", "", "   "],
  });
  assert.deepEqual(withKw.keywords, ["best plumber"]);
  const noKw = toFreeTrialPayload({ ...eligible, keywords: ["", "  "] });
  assert.equal("keywords" in noKw, false);
});

// ---- orchestrator --------------------------------------------------------
function okSubmit(idempotent = false, clientId = 42) {
  const calls: FreeTrialPayload[] = [];
  const submit = async (p: FreeTrialPayload): Promise<SubmitResponse> => {
    calls.push(p);
    return { ok: true, idempotent, clientId };
  };
  return { submit, calls };
}

await test("runPull: submits eligible lead and marks it processed", async () => {
  const { submit, calls } = okSubmit();
  const store = memStore();
  const s = await runPull({
    source: { fetchLeads: async () => [eligible] },
    submit,
    store,
  });
  assert.equal(calls.length, 1);
  assert.equal(s.created, 1);
  assert.equal(store.has("ref:L-1001"), true);
});

await test("runPull: skips already-processed without submitting", async () => {
  const { submit, calls } = okSubmit();
  const s = await runPull({
    source: { fetchLeads: async () => [eligible] },
    submit,
    store: memStore(["ref:L-1001"]),
  });
  assert.equal(calls.length, 0);
  assert.equal(s.alreadyProcessed, 1);
});

await test("runPull: counts ineligible with reasons, never submits them", async () => {
  const { submit, calls } = okSubmit();
  const s = await runPull({
    source: async_leads([
      { ...eligible, leadRef: "L-2", stripeCustomerId: null },
      { ...eligible, leadRef: "L-3", email: "bad" },
    ]),
    submit,
    store: memStore(),
  });
  assert.equal(calls.length, 0);
  assert.equal(s.ineligible, 2);
  assert.equal(s.ineligibleReasons["no-card-on-file"], 1);
  assert.equal(s.ineligibleReasons["invalid-email"], 1);
});

await test("runPull: dryRun resolves but never submits or marks", async () => {
  const { submit, calls } = okSubmit();
  const store = memStore();
  const s = await runPull({
    source: { fetchLeads: async () => [eligible] },
    submit,
    store,
    dryRun: true,
  });
  assert.equal(calls.length, 0);
  assert.equal(s.dryRun, 1);
  assert.equal(store.has("ref:L-1001"), false);
});

await test("runPull: idempotent response counts separately", async () => {
  const { submit } = okSubmit(true);
  const s = await runPull({
    source: { fetchLeads: async () => [eligible] },
    submit,
    store: memStore(),
  });
  assert.equal(s.idempotent, 1);
  assert.equal(s.created, 0);
});

await test("runPull: error is NOT marked processed (retries next run)", async () => {
  const store = memStore();
  const s = await runPull({
    source: { fetchLeads: async () => [eligible] },
    submit: async () => {
      throw new Error("network down");
    },
    store,
  });
  assert.equal(s.failed, 1);
  assert.equal(store.has("ref:L-1001"), false);
});

await test("runPull: one failing lead does not abort the batch", async () => {
  let n = 0;
  const store = memStore();
  const s = await runPull({
    source: async_leads([
      { ...eligible, leadRef: "A" },
      { ...eligible, leadRef: "B" },
    ]),
    submit: async () => {
      n++;
      if (n === 1) throw new Error("boom");
      return { ok: true, clientId: 7 };
    },
    store,
  });
  assert.equal(s.failed, 1);
  assert.equal(s.created, 1);
  assert.equal(store.has("ref:B"), true);
});

function async_leads(leads: RawLead[]) {
  return { fetchLeads: async () => leads };
}

console.log(`\n${passed} passed`);
