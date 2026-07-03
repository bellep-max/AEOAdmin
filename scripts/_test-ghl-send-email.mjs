/* Probe GHL Conversations "send Email" against the TEST contact only
 * (erven.i@appstango.com). Verifies the request shape + that it lands in the
 * contact's GHL conversation. Never targets a real client. */
import { execSync } from "node:child_process";
import fs from "node:fs";

const TEST_EMAIL = "erven.i@appstango.com"; // HARD RULE: test contact only
const LOCATION_ID = "uXRl9WpDjS7LFjeYfQqD";
const secret = JSON.parse(
  execSync(
    "aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --query SecretString --output text",
    { encoding: "utf8" },
  ),
);
const token = secret.GHL_PIT_TOKEN;
if (!token) throw new Error("GHL_PIT_TOKEN missing from secret");

const H = (v) => ({
  Authorization: `Bearer ${token}`,
  Version: v,
  "Content-Type": "application/json",
  Accept: "application/json",
});

// 1. find the test contact
const dup = new URL("https://services.leadconnectorhq.com/contacts/search/duplicate");
dup.searchParams.set("locationId", LOCATION_ID);
dup.searchParams.set("email", TEST_EMAIL);
const cRes = await fetch(dup, { headers: H("2021-07-28") });
const cBody = await cRes.json();
const contactId = cBody?.contact?.id;
console.log(`contact lookup: HTTP ${cRes.status} → contactId=${contactId ?? "NONE"}`);
if (!contactId) throw new Error("test contact not found in GHL");

// 2. send an email through GHL into that conversation
const html = fs.existsSync(process.argv[2])
  ? fs.readFileSync(process.argv[2], "utf8")
  : "<p>GHL send test — please ignore.</p>";
const payload = {
  type: "Email",
  contactId,
  subject: "GHL send test — Your first AI ranking is in",
  html,
};
const sRes = await fetch(
  "https://services.leadconnectorhq.com/conversations/messages",
  { method: "POST", headers: H("2021-04-15"), body: JSON.stringify(payload) },
);
const sText = await sRes.text();
console.log(`send email: HTTP ${sRes.status}`);
console.log(sText.slice(0, 600));
