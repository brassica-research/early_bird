import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getInitializedStore } from "@/lib/store";
import { triageIntake } from "@/lib/triage";
import { listAvailability } from "@/lib/scheduling/availability";
import { intakeSchema } from "@/lib/validation";
import { geocode } from "@/lib/geo/geocode";
import { assessLicensing, parseStateFromAddress } from "@/lib/licensing";
import { assessIssue } from "@/lib/issues";
import { priceSlots } from "@/lib/pricing";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_TOTAL_BYTES,
  floorLabel,
} from "@/lib/rooms";
import type { JobPhoto, Submission } from "@/lib/types";

export const runtime = "nodejs";

/** Decoded byte size of a base64 `data:` URL, without materializing a Buffer. */
function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// POST /api/intake — submit contact + issue, triage it, return the submission
// and current (priced) availability so the client can proceed to scheduling.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = intakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Photos are validated for shape by zod; size is checked here, after
  // decoding, because a base64 string's length is not its byte count. The
  // browser already downscales — this is the server-side backstop.
  const { photos, ...input } = parsed.data;
  let totalBytes = 0;
  const sized = photos.map((p) => {
    const bytes = dataUrlBytes(p.dataUrl);
    totalBytes += bytes;
    return { ...p, bytes };
  });
  if (sized.some((p) => p.bytes > MAX_PHOTO_BYTES)) {
    return NextResponse.json(
      { error: "One of those photos is too large. Please retake or crop it." },
      { status: 413 },
    );
  }
  if (totalBytes > MAX_PHOTOS_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "Those photos are too large in total. Please remove one." },
      { status: 413 },
    );
  }

  const submissionId = randomUUID();

  try {
    // Triage and geocoding are independent — run them concurrently. Geocoding
    // is best-effort; a null result just means no proximity data for this job.
    const [{ triage, heuristicTriage }, location] = await Promise.all([
      triageIntake(input, submissionId),
      geocode(input.address),
    ]);

    // State licensing advisory, keyed on the triaged trade. Fall back to
    // parsing the state from the address when the form didn't send one.
    const stateCode = input.state || parseStateFromAddress(input.address) || "";
    const licensing = stateCode
      ? assessLicensing(stateCode, [triage.category])
      : null;

    // Issue-level scope from the Issues Matrix: match what the customer
    // described + selected to the closest catalog issue. The room and floor
    // are part of the text so "basement" / "attic" style access notes count.
    const issueAssessment = assessIssue(
      `${input.description} ${input.affectedServices.join(" ")} ${input.room} ${floorLabel(
        input.floor,
      )}`,
    );

    const submission: Submission = {
      id: submissionId,
      createdAt: new Date().toISOString(),
      input,
      triage,
      heuristicTriage,
      slotId: null,
      bookingStatus: "requested",
      location,
      dispatchStatus: "queued",
      assignment: null,
      licensing,
      issueAssessment,
      photoCount: sized.length,
      visitFee: null,
    };

    const store = await getInitializedStore();
    await store.createSubmission(submission);

    if (sized.length > 0) {
      const now = new Date().toISOString();
      const jobPhotos: JobPhoto[] = sized.map((p) => ({
        id: randomUUID(),
        submissionId,
        createdAt: now,
        name: p.name,
        contentType: p.contentType,
        dataUrl: p.dataUrl,
        width: p.width,
        height: p.height,
        bytes: p.bytes,
      }));
      await store.createPhotos(jobPhotos);
    }

    const availability = priceSlots(await listAvailability());

    return NextResponse.json({ submission, availability }, { status: 201 });
  } catch (err) {
    console.error("Intake failed:", err);
    return NextResponse.json(
      { error: "Something went wrong processing your request." },
      { status: 500 },
    );
  }
}
