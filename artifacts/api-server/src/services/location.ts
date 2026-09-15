/**
 * Mock-GPS coordinate generator for device-agent.
 *
 * Mirror of aeo-appium/proxy.py:randomize_location() so device-agent gets the
 * same uniform-disc behavior whether it calls this endpoint, the future aeo-be
 * /v1/location/randomize, or the local Python copy.
 *
 * Algorithm — uniform sampling inside a disc:
 *   1. miles → degrees. 1° lat ≈ 69 mi everywhere; longitude shrinks toward the
 *      poles, so 1° lng ≈ 69·cos(lat) mi. The cos(lat) keeps the disc circular
 *      instead of stretched east-west.
 *   2. Pick a uniform random direction (0 .. 2π).
 *   3. Pick distance = sqrt(uniform(0,1)). The sqrt makes samples uniform over
 *      the disc's *area*. Plain uniform(0,1) would over-pack the center.
 *   4. Apply the offset, round to 6 decimals (~0.1 m).
 */

const MILES_PER_DEGREE_LAT = 69.0;

export function randomizeLocation(
  latitude: number,
  longitude: number,
  radiusMiles = 5.0,
): { lat: number; lng: number } {
  const radiusDegLat = radiusMiles / MILES_PER_DEGREE_LAT;
  const radiusDegLng =
    radiusMiles / (MILES_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180));

  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.sqrt(Math.random());

  const offsetLat = distance * radiusDegLat * Math.sin(angle);
  const offsetLng = distance * radiusDegLng * Math.cos(angle);

  return {
    lat: round6(latitude + offsetLat),
    lng: round6(longitude + offsetLng),
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
