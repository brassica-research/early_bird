import type {
  PaymentProvider,
  CreateChargeInput,
  CreateChargeResult,
} from "./types";

// ---------------------------------------------------------------------------
// Manual (default) payment provider.
//
// Records a charge as owed without contacting any processor — a simple ledger
// so the technician billing flow works end-to-end before Stripe is connected.
// Charges land in "pending" and can be marked paid manually. Swap to Stripe by
// setting PAYMENTS_PROVIDER=stripe (see index.ts / stripeProvider.ts).
// ---------------------------------------------------------------------------

export class ManualProvider implements PaymentProvider {
  readonly name = "manual";

  async createCharge(_input: CreateChargeInput): Promise<CreateChargeResult> {
    void _input;
    return { providerRef: null, status: "pending", clientSecret: null };
  }
}
