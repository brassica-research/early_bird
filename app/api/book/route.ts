import { NextResponse } from "next/server";
import { getInitializedStore } from "@/lib/store";
import { bookSlot } from "@/lib/scheduling/availability";
import { bookSchema } from "@/lib/validation";
import { sendEmail } from "@/lib/notify/email";
import { visitFeeForSlot } from "@/lib/pricing";
import {
  bookingConfirmationEmail,
  opsBookingNotification,
} from "@/lib/notify/templates";

export const runtime = "nodejs";

// POST /api/book — reserve a slot for an existing submission.
// Reservation is atomic (store.reserveSlot), so capacity can't be exceeded.
//
// Two modes:
//   hold: false (default) — reserve AND confirm, emailing the customer. This
//                           is the original one-shot booking behavior.
//   hold: true            — reserve only, leaving the booking "requested"
//                           while the customer pays the visit fee. The
//                           confirmation (and its email) is issued by
//                           /api/checkout once payment succeeds. Holding first
//                           means nobody pays for a window that just filled up.
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

  const { submissionId, slotId, hold } = parsed.data;
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
    hold ? "requested" : "confirmed",
  );

  // A hold stops here: the slot is reserved, but nothing is confirmed and no
  // one is emailed until the visit fee is paid.
  if (hold) {
    return NextResponse.json({
      submission: updated,
      slot: result.slot ? { ...result.slot, fee: visitFeeForSlot(result.slot) } : null,
      held: true,
      notified: false,
    });
  }

  // Send confirmation emails. Failures are logged but never fail the booking —
  // the slot is already reserved and the customer has an on-screen confirmation.
  let notified = false;
  if (updated && result.slot) {
    try {
      const customer = await sendEmail(
        bookingConfirmationEmail(updated, result.slot),
      );
      notified = customer.delivered;

      const opsInbox = process.env.EMAIL_OPS;
      if (opsInbox) {
        await sendEmail(
          opsBookingNotification(updated, result.slot, opsInbox),
        );
      }
    } catch (err) {
      console.error("Confirmation email failed:", err);
    }
  }

  return NextResponse.json({ submission: updated, slot: result.slot, notified });
}
