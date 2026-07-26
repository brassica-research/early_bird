import type { ChargeStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Payment provider contract.
//
// All billing goes through this interface so the rest of the app never knows
// which processor is connected. The default "manual" provider records charges
// as a ledger entry without moving money; the Stripe provider (see
// stripeProvider.ts) plugs in once keys are configured — no caller changes.
// ---------------------------------------------------------------------------

export interface CreateChargeInput {
  amountCents: number;
  currency: string;
  description: string;
  submissionId: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export interface CreateChargeResult {
  /** Processor-side id (e.g. Stripe PaymentIntent id), or null for manual. */
  providerRef: string | null;
  status: ChargeStatus;
  /** For client-side confirmation flows (e.g. Stripe PaymentIntent secret). */
  clientSecret?: string | null;
}

export interface PaymentProvider {
  /** Identifier stored on each charge, e.g. "manual" | "stripe". */
  readonly name: string;
  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;
}
