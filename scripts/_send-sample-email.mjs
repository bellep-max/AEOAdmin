/* Send a pre-rendered HTML file as a sample email via SendGrid (prod creds).
 * Test recipient only. Usage: node _send-sample-email.mjs <html-file> <to> */
import { execSync } from "node:child_process";
import fs from "node:fs";

const FILE = process.argv[2];
const TO = process.argv[3] || "erven.i@appstango.com";
const html = fs.readFileSync(FILE, "utf8");
const secret = JSON.parse(
  execSync(
    "aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --query SecretString --output text",
    { encoding: "utf8" },
  ),
);

const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret.SENDGRID_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: TO }] }],
    from: {
      email: secret.SENDGRID_FROM_EMAIL,
      name: process.env.SAMPLE_FROM_NAME || "Chuck — SEO Local",
    },
    subject: "Your first AI ranking is in (sample)",
    content: [{ type: "text/html", value: html }],
  }),
});
console.log(`SendGrid → HTTP ${res.status} to ${TO}`);
if (!res.ok) console.log((await res.text()).slice(0, 400));
else console.log("sent from:", secret.SENDGRID_FROM_EMAIL);
