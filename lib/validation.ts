import { z } from "zod";

// ---------------------------------------------------------------------------
// Request validation (shared by API routes). Zod gives us runtime safety at
// the trust boundary plus clean, typed parse results.
// ---------------------------------------------------------------------------

export const intakeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("A valid email is required").max(200),
  phone: z
    .string()
    .trim()
    .min(7, "A valid phone number is required")
    .max(40),
  address: z.string().trim().min(5, "A home address is required").max(300),
  affectedServices: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  description: z
    .string()
    .trim()
    .min(5, "Please describe the issue")
    .max(4000),
  clientUrgency: z.enum(["emergency", "high", "normal", "low"]).optional(),
  smsOptIn: z.boolean().optional().default(false),
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
