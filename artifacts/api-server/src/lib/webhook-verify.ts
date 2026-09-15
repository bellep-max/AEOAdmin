import crypto from "node:crypto";

/* Verify a SendGrid Signed Event Webhook request.
   SendGrid signs (timestamp + rawBody) with ECDSA/P-256; the verification key is
   the base64 DER (SPKI) public key from the SendGrid dashboard. */
export function verifySendgridSignature(params: {
  publicKeyBase64: string;
  payload: Buffer;
  signature: string;
  timestamp: string;
}): boolean {
  const { publicKeyBase64, payload, signature, timestamp } = params;
  if (!publicKeyBase64 || !signature || !timestamp) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const signed = Buffer.concat([Buffer.from(timestamp, "utf8"), payload]);
    return crypto.verify(
      "sha256",
      signed,
      { key, dsaEncoding: "der" },
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

/* Constant-time string compare for shared-secret webhook auth (GHL). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
