import { NextResponse } from "next/server";
import { getInitializedStore } from "@/lib/store";
import { bookSlot } from "@/lib/scheduling/availability";
import { bookSchema } from "@/lib/validation";

export const runtime = "nodejs";

// POST /api/book — reserve a slot for an existing submission.
// Reservation is atomic (store.reserveSlot), so capacity can't be exceeded.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { submissionId, slotId } = parsed.data;
  const store = await getInitializedStore();

  const submission = await store.getSubmission(submissionId);
  if (!submission) {
    return NextResponse.json(
      { error: "Submission not found." },
      { status: 404 },
    );
  }

  // If this submission already holds a slot, release it before rebooking.
  if (submission.slotId && submission.slotId !== slotId) {
    await store.releaseSlot(submission.slotId);
  }

  const result = await bookSlot(slotId);
  if (!result.ok) {
    // Re-attach the previous slot if we released it but the new one failed.
    if (submission.slotId && submission.slotId !== slotId) {
      await store.reserveSlot(submission.slotId);
    }
    return NextResponse.json(
      { error: result.reason || "Could not book slot." },
      { status: 409 },
    );
  }

  const updated = await store.updateSubmissionBooking(
    submissionId,
    slotId,
    "confirmed",
  );

  return NextResponse.json({ submission: updated, slot: result.slot });
}
