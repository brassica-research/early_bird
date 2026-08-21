import { NextResponse } from "next/server";
import { payVisitFee } from "@/lib/checkout";
import { checkoutSchema } from "@/lib/validation";
import { sendEmail } from "@/lib/notify/email";
import {
  bookingConfirmationEmail,
  opsBookingNotification,
} from "@/lib/notify/templates";
import { trackingUrl } from "@/lib/tracking";
import { guardCsrf } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/checkout — pay the visit fee for a held slot, confirm the booking,
// and send the confirmation emails.
//
// The fee is priced server-side from the held slot (lib/pricing), so the
// amount is never client-supplied. The card NUMBER never reaches this route —
// the browser validates it and sends only brand/last4/expiry for the receipt.
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await payVisitFee({
    submissionId: parsed.data.submissionId,
    card: parsed.data.card,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  const origin =
    process.env.APP_BASE_URL ||
    request.headers.get("origin") ||
    `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  const track = trackingUrl(origin, result.submission.id);

  // Confirmation emails are best-effort: the payment is taken and the slot is
  // reserved, and the customer has an on-screen receipt either way.
  let notified = false;
  if (!result.alreadyPaid) {
    try {
      const customer = await sendEmail(
        bookingConfirmationEmail(result.submission, result.slot, {
          visitFee: result.visitFee,
          trackUrl: track,
        }),
      );
      notified = customer.delivered;

      const opsInbox = process.env.EMAIL_OPS;
      if (opsInbox) {
        await sendEmail(
          opsBookingNotification(result.submission, result.slot, opsInbox),
        );
      }
    } catch (err) {
      console.error("Confirmation email failed:", err);
    }
  }

  return NextResponse.json({
    submission: result.submission,
    slot: result.slot,
    charge: result.charge,
    visitFee: result.visitFee,
    trackUrl: track,
    alreadyPaid: result.alreadyPaid,
    notified,
  });
}
