import type { PaymentProvider } from "./types";
import { ManualProvider } from "./manualProvider";
import { StripeProvider } from "./stripeProvider";

export type {
  PaymentProvider,
  CreateChargeInput,
  CreateChargeResult,
} from "./types";

// ---------------------------------------------------------------------------
// Payment provider factory — the only place PAYMENTS_PROVIDER is read.
//
//   PAYMENTS_PROVIDER=manual  -> ledger only, no processing (default)
//   PAYMENTS_PROVIDER=stripe  -> Stripe (needs `npm i stripe` + STRIPE_SECRET_KEY)
// ---------------------------------------------------------------------------

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;
  const name = (process.env.PAYMENTS_PROVIDER || "manual").toLowerCase();
  switch (name) {
    case "stripe":
      cached = new StripeProvider();
      break;
    case "manual":
    case "":
      cached = new ManualProvider();
      break;
    default:
      throw new Error(
        `Unknown PAYMENTS_PROVIDER "${name}". Use "manual" or "stripe".`,
      );
  }
  return cached;
}

export const DEFAULT_CURRENCY = process.env.BILLING_CURRENCY || "usd";
