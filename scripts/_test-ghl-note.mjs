/* Post a sample "sent email" note to the TEST contact (erven) via the GHL
 * token — demonstrates saving the sent-email log into GHL. Test contact only. */
import { execSync } from "node:child_process";

const TEST_EMAIL = "erven.i@appstango.com";
const LOCATION_ID = "uXRl9WpDjS7LFjeYfQqD";
const secret = JSON.parse(
  execSync(
    "aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --region us-east-1 --query SecretString --output text",
    { encoding: "utf8" },
  ),
);
const token = secret.GHL_PIT_TOKEN;
const H = (v) => ({
  Authorization: `Bearer ${token}`,
  Version: v,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const dup = new URL("https://services.leadconnectorhq.com/contacts/search/duplicate");
dup.searchParams.set("locationId", LOCATION_ID);
dup.searchParams.set("email", TEST_EMAIL);
const cRes = await fetch(dup, { headers: H("2021-07-28") });
const contactId = (await cRes.json())?.contact?.id;
console.log(`contact: HTTP ${cRes.status} id=${contactId}`);
if (!contactId) throw new Error("test contact not found");

const body = [
  "📧 AEO Sales Email — SENT",
  "When: Jul 3, 2026, 3:10 PM ET",
  "To: erven.i@appstango.com",
  "From: Chuck — SEO Local <contact@signalaeo.com>",
  "Subject: Your first AI ranking is in",
  "Business: Carrot Software, Seattle",
  'Proof: "app development" on Gemini — #48 → #25',
  "Sent from the AEO admin panel via SendGrid.",
].join("\n");

const nRes = await fetch(
  `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
  { method: "POST", headers: H("2021-07-28"), body: JSON.stringify({ body }) },
);
const nText = await nRes.text();
console.log(`note create: HTTP ${nRes.status}`);
console.log(nText.slice(0, 400));
