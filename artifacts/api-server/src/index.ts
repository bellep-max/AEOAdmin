import app from "./app";
import { logger } from "./lib/logger";
import { reconcileTrialConversions } from "./services/trial-conversion";

// Fail fast rather than silently fall back to the public dev secret, which
// keys session cookies, the password HMAC, and the login-code HMAC.
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production.");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startTrialConversionSweep();
});

/* Trial → paid, without waiting for an operator. The proof-send path only
   converts when a Stripe customer is already stored on the campaign, so a
   client billed outside that flow stayed labelled "Free Trial". This sweep
   asks Stripe who is actually paying and flips them. Read-only against
   Stripe — it never creates a subscription. */
function startTrialConversionSweep() {
  const minutes = Number(process.env.TRIAL_SWEEP_MINUTES ?? 30);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    logger.info({}, "Trial conversion sweep disabled");
    return;
  }
  const run = async () => {
    try {
      const out = await reconcileTrialConversions({ log: logger });
      if (out.converted.length > 0) {
        logger.info(
          { converted: out.converted, scanned: out.scanned },
          "Trial campaigns converted to paid",
        );
      }
    } catch (err) {
      logger.error({ err }, "Trial conversion sweep failed");
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, minutes * 60_000).unref();
  logger.info({ minutes }, "Trial conversion sweep scheduled");
}
