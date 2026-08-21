// ---------------------------------------------------------------------------
// "Where's my tech?" — the customer-facing arrival tracker.
//
// Modeled on fleet trackers like Samsara: the customer sees the vehicle moving
// toward them and a countdown, NOT a precise pin. Two deliberate limits keep
// this from becoming employee surveillance:
//
//   1. COARSE ONLY. The technician's coordinates are snapped to a ~1 mile grid
//      before they ever leave the server (see coarsen()). The customer learns
//      "about 3 miles out, north-east" — never the exact street the tech is on,
//      never where they stopped for lunch.
//   2. ONLY WHILE EN ROUTE. Location is published only for a job that tech has
//      claimed and committed an ETA on, and only while their presence is fresh.
//      Off duty, stale, completed, or not-yet-assigned ⇒ no location at all.
//
// Everything here is pure so it can be unit-tested without a store.
// ---------------------------------------------------------------------------

import type { GeoPoint, Submission, TechPresence } from "./types";
import { haversineKm, kmToMiles } from "./geo/geocode";

/** Grid size for published tech locations, in degrees (~1.1 km ≈ 0.7 mi). */
export const COARSE_GRID_DEG = 0.01;

/** How long a presence heartbeat stays "live" before we stop publishing it. */
export const PRESENCE_STALE_MS = 10 * 60_000;

/**
 * Snap a point to a fixed grid. Snapping (rather than truncating) keeps the
 * error symmetric, and because the grid is fixed, repeated reads of a parked
 * vehicle return the identical cell instead of leaking jitter that could be
 * averaged back into a precise fix.
 */
export function coarsen(point: GeoPoint, grid = COARSE_GRID_DEG): GeoPoint {
  // Round back to 6 decimals after snapping: `Math.round(x / 0.01) * 0.01`
  // lands on values like -87.10000000000001, and trailing float noise in a
  // published coordinate is both untidy and faintly misleading about precision.
  const snap = (v: number) => Number((Math.round(v / grid) * grid).toFixed(6));
  return { lat: snap(point.lat), lng: snap(point.lng) };
}

/** Compass bearing from `from` to `to`, as one of 8 cardinal points. */
export function bearingLabel(from: GeoPoint, to: GeoPoint): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return names[Math.round(((deg + 360) % 360) / 45) % 8];
}

/** Round a mileage to a deliberately blunt figure ("about 3.5 miles"). */
export function approxMiles(miles: number): number {
  if (miles < 1) return Math.round(miles * 10) / 10;
  return Math.round(miles * 2) / 2;
}

/** Where the job is in the customer's eyes. Drives the tracker's timeline. */
export type TrackStage =
  | "requested" // booked, waiting for a technician to accept
  | "accepted" // a technician has the job but hasn't committed an ETA yet
  | "en_route" // ETA committed — the countdown is running
  | "arriving" // countdown has run out; they're at/near the door
  | "completed"
  | "cancelled";

export interface TrackTechView {
  /** First name only — enough to greet them at the door. */
  firstName: string;
  /** Snapped to the coarse grid; null when we won't publish a location. */
  approxLocation: GeoPoint | null;
  /** Radius the published point is accurate to, in miles. */
  approxAccuracyMiles: number;
  /** Straight-line distance, deliberately rounded. Null without a location. */
  approxMilesAway: number | null;
  /** Cardinal direction the tech is coming from, e.g. "south-west". */
  directionFrom: string | null;
  /** Last heartbeat we have. Null when the tech has never reported. */
  lastSeenAt: string | null;
  /** True when the last heartbeat is older than PRESENCE_STALE_MS. */
  locationStale: boolean;
}

export interface TrackView {
  submissionId: string;
  stage: TrackStage;
  /** Human summary of the stage, shown as the tracker's headline. */
  headline: string;
  categoryLabel: string;
  /** Coarse location of the service address, for the mini map. Null if ungeocoded. */
  destination: GeoPoint | null;
  tech: TrackTechView | null;
  /** Committed ETA in minutes, as promised by the technician. */
  etaMinutes: number | null;
  /** ISO arrival estimate (claim time + ETA). */
  estimatedArrival: string | null;
  /** When the ETA was committed — the start of the countdown bar. */
  etaCommittedAt: string | null;
  /** Whole minutes left, floored at 0. Null before an ETA exists. */
  minutesRemaining: number | null;
  /** Server clock, so a client with a skewed clock still counts down right. */
  serverNow: string;
}

function stageOf(job: Submission): TrackStage {
  if (job.dispatchStatus === "completed") return "completed";
  if (job.dispatchStatus === "cancelled") return "cancelled";
  if (!job.assignment) return "requested";
  if (job.assignment.etaMinutes == null) return "accepted";
  const arrival = job.assignment.estimatedArrival;
  if (arrival && new Date(arrival).getTime() <= Date.now()) return "arriving";
  return "en_route";
}

function headlineFor(stage: TrackStage, firstName: string | null): string {
  const who = firstName ?? "Your technician";
  switch (stage) {
    case "requested":
      return "We're matching you with a technician";
    case "accepted":
      return `${who} accepted your job and is planning the route`;
    case "en_route":
      return `${who} is on the way`;
    case "arriving":
      return `${who} is arriving now`;
    case "completed":
      return "This visit is complete";
    case "cancelled":
      return "This visit was cancelled";
  }
}

/**
 * Build the customer-facing tracker payload. `presence` is the claiming
 * technician's latest heartbeat (null if they've never reported).
 *
 * This is the ONLY place tech coordinates are turned into something public —
 * the route hands back exactly what this returns.
 */
export function buildTrackView(
  job: Submission,
  presence: TechPresence | null,
  now: Date = new Date(),
): TrackView {
  const stage = stageOf(job);
  const assignment = job.assignment ?? null;
  const firstName = assignment?.techName.trim().split(/\s+/)[0] ?? null;

  const destination = job.location ? coarsen(job.location) : null;

  let tech: TrackTechView | null = null;
  if (assignment) {
    const lastSeenAt = presence?.lastSeenAt ?? null;
    const stale =
      !lastSeenAt ||
      now.getTime() - new Date(lastSeenAt).getTime() > PRESENCE_STALE_MS;

    // Publish a location only while the tech is actively heading over: claimed
    // job, on duty, fresh heartbeat, and the visit hasn't ended.
    const publish =
      !stale &&
      presence?.onDuty === true &&
      presence.location != null &&
      (stage === "accepted" || stage === "en_route" || stage === "arriving");

    const approxLocation = publish ? coarsen(presence!.location!) : null;
    const milesAway =
      approxLocation && job.location
        ? approxMiles(kmToMiles(haversineKm(approxLocation, job.location)))
        : null;

    tech = {
      firstName: firstName ?? "Your technician",
      approxLocation,
      approxAccuracyMiles: Math.round(kmToMiles(COARSE_GRID_DEG * 111) * 10) / 10,
      approxMilesAway: milesAway,
      directionFrom:
        approxLocation && job.location
          ? bearingLabel(job.location, approxLocation)
          : null,
      lastSeenAt,
      locationStale: stale,
    };
  }

  const estimatedArrival = assignment?.estimatedArrival ?? null;
  const minutesRemaining = estimatedArrival
    ? Math.max(
        0,
        Math.ceil(
          (new Date(estimatedArrival).getTime() - now.getTime()) / 60_000,
        ),
      )
    : null;

  return {
    submissionId: job.id,
    stage,
    headline: headlineFor(stage, firstName),
    categoryLabel: job.triage.categoryLabel,
    destination,
    tech,
    etaMinutes: assignment?.etaMinutes ?? null,
    estimatedArrival,
    etaCommittedAt: assignment?.etaCommittedAt ?? null,
    minutesRemaining,
    serverNow: now.toISOString(),
  };
}

/** Absolute URL of a submission's tracker, for emails and SMS. */
export function trackingUrl(origin: string, submissionId: string): string {
  return `${origin.replace(/\/+$/, "")}/track/${submissionId}`;
}
