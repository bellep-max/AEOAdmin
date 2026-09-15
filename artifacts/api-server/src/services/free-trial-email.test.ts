import assert from "node:assert/strict";
import {
  sendFreeTrialEmails,
  type FreeTrialEmailInput,
} from "./free-trial-email";

/**
 * Runnable unit test (no test runner / no new deps):
 *   pnpm --filter @workspace/api-server exec tsx src/services/free-trial-email.test.ts
 * Uses an injected fake sender — never touches SendGrid or the DB.
 */

const BASE: FreeTrialEmailInput = {
  businessName: "Joe's Plumbing",
  recipientEmail: "customer@example.com",
  clientId: 4242,
  proofClientSlug: "joes-plumbing",
  brand: "acme",
  leadRef: "L-99",
  source: "website",
  firstName: null,
  city: null,
  isDirect: false,
};

interface Captured {
  to: string[];
  from: { email: string; name: string };
  subject: string;
  html: string;
}

function fakeSender(store: Captured[]) {
  return async (msg: Captured) => {
    store.push(msg);
  };
}

function resetEnv(): void {
  delete process.env.SENDGRID_API_KEY;
  delete process.env.ADMIN_FROM_EMAIL;
  delete process.env.SENDGRID_FROM_EMAIL;
  delete process.env.ADMIN_FROM_NAME;
  delete process.env.SAFE_RECIPIENT_OVERRIDE;
  delete process.env.OWNER_NOTIFY_EMAILS;
}

const tests: Array<[string, () => Promise<void>]> = [
  [
    "sends welcome to customer + alert to owners, FROM admin email",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      const sent: Captured[] = [];
      const r = await sendFreeTrialEmails(BASE, { send: fakeSender(sent) });
      assert.equal(r.welcome, "sent");
      assert.equal(r.ownerAlert, "sent");
      assert.equal(sent.length, 2);
      const welcome = sent.find((m) =>
        m.subject.includes("free trial is live"),
      );
      const owner = sent.find((m) =>
        m.subject.startsWith("New free trial signup:"),
      );
      assert.ok(welcome && owner);
      assert.deepEqual(welcome.to, ["customer@example.com"]);
      assert.deepEqual(owner.to, [
        "admin@signalaeo.com",
        "erven.i@appstango.com",
        "mary@signalaeo.com",
        "belle.p@appstango.com",
      ]);
      assert.equal(welcome.from.email, "mary@signalaeo.com");
      assert.equal(owner.from.email, "mary@signalaeo.com");
    },
  ],
  [
    "SAFE_RECIPIENT_OVERRIDE redirects ALL mail + tags the subject",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      process.env.SAFE_RECIPIENT_OVERRIDE = "erven.i@appstango.com";
      const sent: Captured[] = [];
      await sendFreeTrialEmails(BASE, { send: fakeSender(sent) });
      assert.equal(sent.length, 2);
      for (const m of sent) {
        assert.deepEqual(m.to, ["erven.i@appstango.com"]);
        assert.ok(m.subject.startsWith("[TEST → would have gone to:"));
      }
      // The real intended recipients are still visible in the tag.
      assert.ok(sent.some((m) => m.subject.includes("customer@example.com")));
    },
  ],
  [
    "fail-soft: a throwing sender yields 'failed', never throws",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      const r = await sendFreeTrialEmails(BASE, {
        send: async () => {
          throw new Error("SendGrid 401");
        },
      });
      assert.equal(r.welcome, "failed");
      assert.equal(r.ownerAlert, "failed");
      assert.equal(r.errors.length, 2);
      assert.ok(r.errors.every((e) => e.includes("SendGrid 401")));
    },
  ],
  [
    "no SENDGRID_API_KEY → skipped, nothing sent",
    async () => {
      resetEnv();
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      const sent: Captured[] = [];
      const r = await sendFreeTrialEmails(BASE, { send: fakeSender(sent) });
      assert.equal(r.welcome, "skipped");
      assert.equal(r.ownerAlert, "skipped");
      assert.equal(sent.length, 0);
    },
  ],
  [
    "business name is HTML-escaped (no injection)",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      const sent: Captured[] = [];
      await sendFreeTrialEmails(
        { ...BASE, businessName: "<script>x</script>Bob & Co" },
        { send: fakeSender(sent) },
      );
      for (const m of sent) {
        assert.ok(!m.html.includes("<script>"));
        assert.ok(m.html.includes("&lt;script&gt;"));
        assert.ok(m.html.includes("Bob &amp; Co"));
      }
    },
  ],
  [
    "firstName personalizes the welcome greeting; null falls back to 'Hi there,'",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      const withName: Captured[] = [];
      await sendFreeTrialEmails(
        { ...BASE, firstName: "Dana" },
        { send: fakeSender(withName) },
      );
      const welcomeNamed = withName.find((m) =>
        m.subject.includes("free trial is live"),
      );
      assert.ok(welcomeNamed?.html.includes("Hi Dana,"));

      const noName: Captured[] = [];
      await sendFreeTrialEmails(BASE, { send: fakeSender(noName) });
      const welcomePlain = noName.find((m) =>
        m.subject.includes("free trial is live"),
      );
      assert.ok(welcomePlain?.html.includes("Hi there,"));
    },
  ],
  [
    "default owner list is the four owners (admin, erven, mary, belle.p)",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      const sent: Captured[] = [];
      await sendFreeTrialEmails(BASE, { send: fakeSender(sent) });
      const owner = sent.find((m) =>
        m.subject.startsWith("New free trial signup:"),
      );
      assert.deepEqual(owner?.to, [
        "admin@signalaeo.com",
        "erven.i@appstango.com",
        "mary@signalaeo.com",
        "belle.p@appstango.com",
      ]);
    },
  ],
  [
    "firstName is HTML-escaped in the greeting (no injection)",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      const sent: Captured[] = [];
      await sendFreeTrialEmails(
        { ...BASE, firstName: "<b>x</b>" },
        { send: fakeSender(sent) },
      );
      const welcome = sent.find((m) =>
        m.subject.includes("free trial is live"),
      );
      assert.ok(!welcome?.html.includes("Hi <b>x</b>,"));
      assert.ok(welcome?.html.includes("&lt;b&gt;x&lt;/b&gt;"));
    },
  ],
  [
    "isDirect uses paid welcome copy (no 'free trial' language) + direct owner subject",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      const sent: Captured[] = [];
      await sendFreeTrialEmails(
        { ...BASE, isDirect: true },
        { send: fakeSender(sent) },
      );
      const welcome = sent.find(
        (m) => m.subject === "Welcome to Signal AEO 🎉",
      );
      assert.ok(welcome, "direct welcome subject");
      assert.ok(!welcome.html.toLowerCase().includes("free trial"));
      assert.ok(welcome.html.includes("getting started on"));
      const owner = sent.find((m) =>
        m.subject.startsWith("New direct signup:"),
      );
      assert.ok(owner, "direct owner subject");
      assert.ok(owner.html.includes("Direct (Signal AEO Plan)"));
    },
  ],
  [
    "OWNER_NOTIFY_EMAILS overrides the default owner list",
    async () => {
      resetEnv();
      process.env.SENDGRID_API_KEY = "SG.fake";
      process.env.ADMIN_FROM_EMAIL = "mary@signalaeo.com";
      process.env.OWNER_NOTIFY_EMAILS = "a@x.com, b@x.com";
      const sent: Captured[] = [];
      await sendFreeTrialEmails(BASE, { send: fakeSender(sent) });
      const owner = sent.find((m) =>
        m.subject.startsWith("New free trial signup:"),
      );
      assert.deepEqual(owner?.to, ["a@x.com", "b@x.com"]);
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
  resetEnv();
  if (failed > 0) {
    console.error(`\n${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${tests.length} tests passed`);
}

void main();
