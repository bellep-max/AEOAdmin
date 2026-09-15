import { Router } from "express";
import { requireExecutorToken } from "../middlewares/executor-auth";
import { randomizeLocation } from "../services/location";

const router = Router();

const MAX_RADIUS_MILES = 50;

/* POST /api/location/randomize
   Body: { lat, lng, radius_miles? }
   Returns a random point uniformly distributed inside a disc of `radius_miles`
   around (lat, lng). Default radius is 5 miles, matching the device-agent's
   local Python implementation. Snake-cased to match the future aeo-be contract
   so device-agent can swap the call URL without touching its parsing. */
router.post("/randomize", requireExecutorToken, (req, res) => {
  try {
    const { lat, lng, radius_miles } = req.body ?? {};
    const radius = radius_miles ?? 5.0;

    if (
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90
    ) {
      return res
        .status(400)
        .json({ error: "lat must be a number in [-90, 90]" });
    }
    if (
      typeof lng !== "number" ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180
    ) {
      return res
        .status(400)
        .json({ error: "lng must be a number in [-180, 180]" });
    }
    if (
      typeof radius !== "number" ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      radius > MAX_RADIUS_MILES
    ) {
      return res
        .status(400)
        .json({
          error: `radius_miles must be a number in (0, ${MAX_RADIUS_MILES}]`,
        });
    }

    const { lat: outLat, lng: outLng } = randomizeLocation(lat, lng, radius);
    return res.json({ lat: outLat, lng: outLng, radius_miles: radius });
  } catch (err) {
    req.log.error({ err }, "Error randomizing location");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
