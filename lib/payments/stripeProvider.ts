import type {
  PaymentProvider,
  CreateChargeInput,
  CreateChargeResult,
} from "./types";

// ---------------------------------------------------------------------------
// Stripe payment provider — ready to connect.
//
// To activate:
//   1. `npm install stripe`
//   2. Set PAYMENTS_PROVIDER=stripe and STRIPE_SECRET_KEY=sk_...
//
// `stripe` is imported lazily via a variable specifier so it isn't a hard
// dependency until this provider is actually used. Each charge is created as a
// PaymentIntent; the returned client secret supports a future card-entry step
// in the tech (or customer) UI.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadStripe(): Promise<any> {
  const moduleName = "stripe";
  try {
    const mod: any = await import(/* webpackIgnore: true */ moduleName);
    return mod.default ?? mod;
  } catch {
    throw new Error(
      "PAYMENTS_PROVIDER=stripe requires the `stripe` package. Run `npm install stripe`.",
    );
  }
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  private clientPromise: Promise<any> | null = null;

  private async client(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) {
          throw new Error(
            "PAYMENTS_PROVIDER=stripe requires STRIPE_SECRET_KEY to be set.",
          );
        }
        const Stripe = await loadStripe();
        return new Stripe(key, { apiVersion: "2024-06-20" });
      })();
    }
    return this.clientPromise;
  }

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const stripe = await this.client();
    const intent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency,
      description: input.description,
      receipt_email: input.customerEmail,
      metadata: {
        submissionId: input.submissionId,
        ...(input.metadata ?? {}),
      },
    });
    return {
      providerRef: intent.id,
      status: "pending",
      clientSecret: intent.client_secret ?? null,
    };
  }
}
