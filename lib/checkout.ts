import { randomUUID } from "crypto";
import { getInitializedStore } from "@/lib/store";
import { getPaymentProvider, DEFAULT_CURRENCY } from "@/lib/payments";
import { visitFeeForSlot, formatMoney } from "@/lib/pricing";
import type { Charge, Slot, Submission, VisitFeePayment } from "@/lib/types";

// ---------------------------------------------------------------------------
// Checkout — collecting the visit fee before a booking is confirmed.
//
// Sequence (see app/api/book + app/api/checkout):
//   1. The customer picks a window; /api/book takes a HOLD on it.
//   2. This module prices the held slot, charges the fee through the
//      configured payment provider, and records it on the submission.
//   3. Only then is the booking confirmed and the customer emailed.
//
// The amount is ALWAYS computed here from the stored slot — never accepted
// from the browser. Card data is limited to brand/last4/expiry (the number
// stays in the browser); with a real processor connected the provider returns
// its own reference and this stays a thin bookkeeping layer.
// ---------------------------------------------------------------------------

export interface CardDetails {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  name: string;
  postalCode: string;
}

export type PayVisitFeeResult =
  | {
      ok: true;
      submission: Submission;
      slot: Slot;
      charge: Charge;
      visitFee: VisitFeePayment;
      /** True when the fee was already paid and this call was a no-op. */
      alreadyPaid: boolean;
    }
  | { ok: false; reason: string; status: number };

/** True when the card's expiry month is in the past. */
export function isCardExpired(
  expMonth: number,
  expYear: number,
  now: Date = new Date(),
): boolean {
  const endOfMonth = new Date(expYear, expMonth, 1).getTime();
  return endOfMonth <= now.getTime();
}

/**
 * Charge the visit fee for a submission's held slot and record it. Idempotent:
 * a submission that already has a paid visit fee is returned unchanged rather
 * than being charged twice (a double-tap on "Pay" costs the customer nothing).
 */
export async function payVisitFee(params: {
  submissionId: string;
  card: CardDetails;
}): Promise<PayVisitFeeResult> {
  const { submissionId, card } = params;
  const store = await getInitializedStore();

  const submission = await store.getSubmission(submissionId);
  if (!submission) {
    return { ok: false, reason: "Booking not found.", status: 404 };
  }
  if (!submission.slotId) {
    return {
      ok: false,
      reason: "Pick a visit window before paying.",
      status: 409,
    };
  }
  const slot = await store.getSlot(submission.slotId);
  if (!slot) {
    return {
      ok: false,
      reason: "That visit window is no longer available. Please pick another.",
      status: 409,
    };
  }

  // Already paid (a double-tap on "Pay", or a retried request): hand back the
  // charge that was actually written rather than charging again.
  if (submission.visitFee) {
    const existing = (await store.listChargesForSubmission(submissionId)).find(
      (c) => c.id === submission.visitFee!.chargeId,
    );
    if (!existing) {
      // The fee is recorded on the submission but its ledger entry is missing —
      // a torn write. Surfacing it is right; silently re-charging is not.
      console.error(
        `Visit fee charge ${submission.visitFee.chargeId} missing for ${submissionId}`,
      );
      return {
        ok: false,
        reason:
          "We already have a payment on file for this booking but can't load the receipt. Please contact us.",
        status: 409,
      };
    }
    return {
      ok: true,
      submission,
      slot,
      charge: existing,
      visitFee: submission.visitFee,
      alreadyPaid: true,
    };
  }

  if (isCardExpired(card.expMonth, card.expYear)) {
    return { ok: false, reason: "That card has expired.", status: 400 };
  }

  const quote = visitFeeForSlot(slot);
  const description = `Early Bird visit fee — ${quote.label} (${slot.windowLabel})`;

  const provider = getPaymentProvider();
  let providerRef: string | null = null;
  let status: Charge["status"] = "pending";
  try {
    const res = await provider.createCharge({
      amountCents: quote.amountCents,
      currency: DEFAULT_CURRENCY,
      description,
      submissionId,
      customerEmail: submission.input.email,
      metadata: {
        kind: "visit_fee",
        tier: quote.tier,
        slotId: slot.id,
        cardLast4: card.last4,
      },
    });
    providerRef = res.providerRef;
    status = res.status;
  } catch (err) {
    console.error("Visit fee payment failed:", err);
    return {
      ok: false,
      reason:
        err instanceof Error
          ? err.message
          : `Could not process the ${formatMoney(quote.amountCents)} visit fee.`,
      status: 402,
    };
  }

  const charge: Charge = {
    id: randomUUID(),
    submissionId,
    createdAt: new Date().toISOString(),
    createdByTechId: "checkout",
    createdByTechName: "Online checkout",
    description,
    amountCents: quote.amountCents,
    currency: DEFAULT_CURRENCY,
    status,
    provider: provider.name,
    providerRef,
  };
  await store.createCharge(charge);

  const visitFee: VisitFeePayment = {
    tier: quote.tier,
    amountCents: quote.amountCents,
    currency: DEFAULT_CURRENCY,
    chargeId: charge.id,
    status,
    paidAt: charge.createdAt,
    cardBrand: card.brand,
    cardLast4: card.last4,
    slotId: slot.id,
  };

  const withFee = await store.setSubmissionVisitFee(submissionId, visitFee);
  const confirmed = await store.updateSubmissionBooking(
    submissionId,
    slot.id,
    "confirmed",
  );

  return {
    ok: true,
    submission: confirmed ?? withFee ?? submission,
    slot,
    charge,
    visitFee,
    alreadyPaid: false,
  };
}
