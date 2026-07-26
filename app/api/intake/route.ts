import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getInitializedStore } from "@/lib/store";
import { triageIntake } from "@/lib/triage";
import { listAvailability } from "@/lib/scheduling/availability";
import { intakeSchema } from "@/lib/validation";
import { geocode } from "@/lib/geo/geocode";
import type { Submission } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/intake — submit contact + issue, triage it, return the submission
// and current availability so the client can proceed to scheduling.
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

  const input = parsed.data;
  const submissionId = randomUUID();

  try {
    // Triage and geocoding are independent — run them concurrently. Geocoding
    // is best-effort; a null result just means no proximity data for this job.
    const [{ triage, heuristicTriage }, location] = await Promise.all([
      triageIntake(input, submissionId),
      geocode(input.address),
    ]);

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
    };

    const store = await getInitializedStore();
    await store.createSubmission(submission);

    const availability = await listAvailability();

    return NextResponse.json({ submission, availability }, { status: 201 });
  } catch (err) {
    console.error("Intake failed:", err);
    return NextResponse.json(
      { error: "Something went wrong processing your request." },
      { status: 500 },
    );
  }
}
