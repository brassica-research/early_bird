import { z } from "zod";
import {
  ACCEPTED_PHOTO_TYPES,
  FLOOR_IDS,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
} from "./rooms";

// ---------------------------------------------------------------------------
// Request validation (shared by API routes). Zod gives us runtime safety at
// the trust boundary plus clean, typed parse results.
// ---------------------------------------------------------------------------

/**
 * One uploaded photo. The browser downscales and re-encodes to JPEG before
 * sending, so we accept only a `data:` URL of a known image type and cap its
 * length — the byte budget is checked again after decoding (see /api/intake).
 */
export const photoSchema = z.object({
  name: z.string().trim().max(200).default(""),
  contentType: z.enum(ACCEPTED_PHOTO_TYPES),
  // base64 inflates by ~4/3; allow headroom over the decoded byte cap.
  dataUrl: z
    .string()
    .max(Math.ceil(MAX_PHOTO_BYTES * 1.4))
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Unsupported image"),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
});

export const intakeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("A valid email is required").max(200),
  phone: z
    .string()
    .trim()
    .min(7, "A valid phone number is required")
    .max(40),
  address: z.string().trim().min(5, "A home address is required").max(300),
  /** USPS state code (e.g. "TX") — powers the state licensing advisory. */
  state: z.string().trim().length(2).toUpperCase().optional(),
  // Drill-down selections arrive already flattened ("Faucet — Drips when shut
  // off"), so the entries are longer and more numerous than the old two-level
  // chips produced.
  affectedServices: z.array(z.string().trim().min(1).max(140)).max(40).default([]),
  room: z
    .string()
    .trim()
    .min(1, "Tell us which room the issue is in")
    .max(80),
  floor: z.enum(FLOOR_IDS, {
    errorMap: () => ({ message: "Choose the floor the issue is on" }),
  }),
  description: z
    .string()
    .trim()
    .min(5, "Please describe the issue")
    .max(4000),
  clientUrgency: z.enum(["emergency", "high", "normal", "low"]).optional(),
  smsOptIn: z.boolean().optional().default(false),
  photos: z.array(photoSchema).max(MAX_PHOTOS).optional().default([]),
});

export type IntakeSchema = z.infer<typeof intakeSchema>;

// --- Technician accounts ----------------------------------------------------

export const techRegisterSchema = z.object({
  inviteCode: z.string().min(1, "Enter your invite code"),
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().email("Enter a valid email").max(200),
  password: z.string().min(1),
});

export const techLoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(200),
  password: z.string().min(1),
  token: z.string().trim().max(10).optional(),
});

export const totpTokenSchema = z.object({
  token: z.string().trim().min(6).max(10),
});

export const forgotSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(200),
});

export const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

// --- Technician dispatch (identity comes from the session, not the body) ----

export const claimSchema = z.object({
  submissionId: z.string().trim().min(1),
});

export const etaSchema = z.object({
  submissionId: z.string().trim().min(1),
  etaMinutes: z.number().int().positive(),
});

export const chargeSchema = z.object({
  submissionId: z.string().trim().min(1),
  amountCents: z.number().int().positive().max(100_000_00),
  description: z.string().trim().min(1, "Add a description").max(300),
});

export const heartbeatSchema = z.object({
  onDuty: z.boolean(),
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
});

export const bookSchema = z.object({
  submissionId: z.string().trim().min(1),
  slotId: z.string().trim().min(1),
  /**
   * Reserve the slot without confirming it — the hold the checkout flow takes
   * while the customer pays the visit fee. Confirmation (and the confirmation
   * email) happens in /api/checkout. Defaults false so the direct
   * book-and-confirm API behavior is unchanged.
   */
  hold: z.boolean().optional().default(false),
});

/**
 * Checkout: pay the visit fee for a held slot.
 *
 * NOTE what is NOT here — the card number. It is validated in the browser and
 * never transmitted to this server; only the brand, last four and expiry come
 * across so the receipt can identify the card. The amount isn't accepted from
 * the client either: the server re-prices the held slot (lib/pricing).
 */
export const checkoutSchema = z.object({
  submissionId: z.string().trim().min(1),
  card: z.object({
    brand: z.string().trim().min(1).max(24),
    last4: z.string().trim().regex(/^\d{4}$/, "Enter a valid card number"),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2000).max(2100),
    name: z.string().trim().min(1, "Name on card is required").max(120),
    postalCode: z.string().trim().min(3, "Billing ZIP is required").max(12),
  }),
});

export const applyProposalsSchema = z.object({
  // Either apply specific proposals, or apply all currently pending ones.
  mode: z.enum(["all_pending", "specific"]).default("all_pending"),
  proposals: z
    .array(
      z.object({
        op: z.enum([
          "add_keyword",
          "adjust_weight",
          "add_urgency_rule",
          "add_scope_rule",
        ]),
        category: z.string().optional(),
        term: z.string().min(1),
        weight: z.number().optional(),
        urgency: z.enum(["emergency", "high", "normal", "low"]).optional(),
        scopeReason: z.string().optional(),
        rationale: z.string().default(""),
      }),
    )
    .optional(),
});
