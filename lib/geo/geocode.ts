import type { GeoPoint } from "@/lib/types";

// ---------------------------------------------------------------------------
// Address geocoding + distance.
//
// Turns a service address into coordinates so the technician app can sort the
// queue by proximity. Provider is chosen by env and behind one `geocode`
// function; everything degrades gracefully (returns null) so a geocoder outage
// never blocks intake — proximity sort just falls back for that job.
//
//   GEOCODER=nominatim  -> OpenStreetMap Nominatim (no key; be a good citizen)
//   GEOCODER=none       -> disabled (always null)
// ---------------------------------------------------------------------------

const cache = new Map<string, GeoPoint | null>();

function provider(): string {
  return (process.env.GEOCODER || "nominatim").toLowerCase();
}

/** Best-effort geocode. Never throws; returns null when unavailable. */
export async function geocode(address: string): Promise<GeoPoint | null> {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;

  let result: GeoPoint | null = null;
  try {
    if (provider() === "nominatim") {
      result = await geocodeNominatim(address);
    }
  } catch {
    result = null;
  }
  cache.set(key, result);
  return result;
}

async function geocodeNominatim(address: string): Promise<GeoPoint | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(address);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Nominatim's usage policy requires an identifying User-Agent.
        "User-Agent": "EarlyBird/1.0 (home-services dispatch)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } finally {
    clearTimeout(timeout);
  }
}

/** Great-circle distance between two points, in kilometers. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function kmToMiles(km: number): number {
  return km * 0.621371;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
