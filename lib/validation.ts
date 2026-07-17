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
});

export type IntakeSchema = z.infer<typeof intakeSchema>;

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
