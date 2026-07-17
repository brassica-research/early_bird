import Anthropic from "@anthropic-ai/sdk";
import type { HeuristicConfig } from "@/lib/store/types";
import type {
  IntakeInput,
  TriageResult,
  HeuristicChangeProposal,
  ServiceCategoryId,
  Urgency,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// LLM triage (Anthropic Claude), the primary triage engine when a key is set.
//
// Claude both (a) triages/troubleshoots the request and (b) critiques the
// heuristic, proposing concrete config changes. Structured output is forced
// via a single tool so we always get valid, typed JSON back.
// ---------------------------------------------------------------------------

export interface LlmTriageOutput {
  triage: TriageResult;
  proposals: HeuristicChangeProposal[];
  /** The LLM's own read on whether it agreed with the heuristic. */
  agreesWithHeuristic: boolean;
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function buildTool(categoryIds: string[]): Anthropic.Tool {
  return {
    name: "submit_triage",
    description:
      "Submit the structured triage decision for a home-service request, plus any proposed improvements to the keyword heuristic.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [...categoryIds, "other"],
          description: "Best-fit service category id.",
        },
        urgency: {
          type: "string",
          enum: ["emergency", "high", "normal", "low"],
        },
        withinNonLicensedScope: {
          type: "boolean",
          description:
            "True if a competent non-licensed technician can safely do this. False for gas, service-panel, refrigerant, sewer main, structural, etc.",
        },
        safetyFlags: {
          type: "array",
          description: "Safety or licensing concerns. Empty if none.",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requiresLicensedPro: { type: "boolean" },
            },
            required: ["code", "message", "requiresLicensedPro"],
          },
        },
        troubleshootingSteps: {
          type: "array",
          description:
            "0-5 safe steps the customer could try or that prep the visit. Never suggest anything hazardous.",
          items: { type: "string" },
        },
        estimatedDurationMin: {
          type: "integer",
          description: "Estimated on-site minutes for a technician.",
        },
        summary: {
          type: "string",
          description: "One or two sentences explaining the triage decision.",
        },
        agreesWithHeuristic: {
          type: "boolean",
          description:
            "Whether your category+urgency match the heuristic result provided.",
        },
        heuristicProposals: {
          type: "array",
          description:
            "Concrete, minimal improvements to the keyword heuristic that would have helped it match your decision. Empty if the heuristic was already right.",
          items: {
            type: "object",
            properties: {
              op: {
                type: "string",
                enum: [
                  "add_keyword",
                  "adjust_weight",
                  "add_urgency_rule",
                  "add_scope_rule",
                ],
              },
              category: { type: "string", enum: [...categoryIds, "other"] },
              term: { type: "string" },
              weight: { type: "number" },
              urgency: {
                type: "string",
                enum: ["emergency", "high", "normal", "low"],
              },
              scopeReason: { type: "string" },
              rationale: { type: "string" },
            },
            required: ["op", "term", "rationale"],
          },
        },
      },
      required: [
        "category",
        "urgency",
        "withinNonLicensedScope",
        "safetyFlags",
        "troubleshootingSteps",
        "estimatedDurationMin",
        "summary",
        "agreesWithHeuristic",
        "heuristicProposals",
      ],
    },
  };
}

function configSummary(config: HeuristicConfig): string {
  return config.categories
    .map(
      (c) =>
        `- ${c.id} (${c.label}): ${c.keywords
          .map((k) => k.term)
          .slice(0, 20)
          .join(", ")}`,
    )
    .join("\n");
}

const SYSTEM_PROMPT = `You are the triage specialist for "Early Bird", an on-site home diagnostics, troubleshooting, and repair service. Technicians are skilled but generally NOT licensed tradespeople. They handle: plumbing (fixtures/drains/leaks, not gas/main sewer), electrical (outlets/switches/fixtures, not service panels/rewiring), appliances, HVAC & air quality (filters/thermostats/basic service, not refrigerant handling), basic home repair (patching, caulking, grout, lubricating, mounting, weatherstripping, touch-ups), and internet/connectivity.

Your job for each request:
1. Classify it into the best service category and urgency.
2. Decide whether it is safe and appropriate for a NON-LICENSED technician. Flag anything requiring a licensed pro (gas, service panels, rewiring, refrigerant, main sewer/water lines, structural, asbestos/large mold, roofing). Treat gas odors, active flooding, sparking/burning, and shock hazards as emergencies with clear safety guidance.
3. Give a few SAFE troubleshooting or prep steps when useful. Never suggest anything hazardous.
4. Critique the keyword heuristic: if it would have mis-categorized or under-prioritized this request, propose minimal, concrete config changes (new keywords, weight tweaks, urgency or scope rules) that would fix it going forward. Only propose changes that clearly generalize — not one-offs.

Always respond by calling the submit_triage tool.`;

export async function runLlmTriage(
  input: IntakeInput,
  config: HeuristicConfig,
  heuristicResult: TriageResult,
): Promise<LlmTriageOutput | null> {
  if (!isLlmConfigured()) return null;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.TRIAGE_MODEL || "claude-sonnet-5";
  const categoryIds = config.categories.map((c) => c.id);
  const tool = buildTool(categoryIds);

  const userContent = `Service categories and current heuristic keywords:
${configSummary(config)}

--- Customer request ---
Affected services/appliances: ${input.affectedServices.join(", ") || "(none selected)"}
Description: ${input.description || "(none)"}

--- Heuristic's provisional result (for you to critique) ---
category: ${heuristicResult.category}
urgency: ${heuristicResult.urgency}
withinNonLicensedScope: ${heuristicResult.withinNonLicensedScope}
top scores: ${heuristicResult.categoryScores
    .slice(0, 3)
    .map((s) => `${s.category}=${s.score}`)
    .join(", ")}

Call submit_triage with your decision.`;

  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: "tool", name: "submit_triage" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return null;

  const out = toolUse.input as Record<string, unknown>;

  const proposals: HeuristicChangeProposal[] = Array.isArray(
    out.heuristicProposals,
  )
    ? (out.heuristicProposals as HeuristicChangeProposal[])
    : [];

  const triage: TriageResult = {
    source: "llm",
    category: (out.category as ServiceCategoryId) ?? "other",
    categoryLabel:
      config.categories.find((c) => c.id === out.category)?.label ??
      "Other / Needs review",
    urgency: (out.urgency as Urgency) ?? "normal",
    withinNonLicensedScope: Boolean(out.withinNonLicensedScope),
    safetyFlags: Array.isArray(out.safetyFlags)
      ? (out.safetyFlags as TriageResult["safetyFlags"])
      : [],
    // Heuristic scores are authoritative for the numeric breakdown.
    categoryScores: heuristicResult.categoryScores,
    troubleshootingSteps: Array.isArray(out.troubleshootingSteps)
      ? (out.troubleshootingSteps as string[])
      : [],
    estimatedDurationMin:
      typeof out.estimatedDurationMin === "number"
        ? out.estimatedDurationMin
        : heuristicResult.estimatedDurationMin,
    summary:
      typeof out.summary === "string"
        ? out.summary
        : "Triaged by Claude.",
  };

  return {
    triage,
    proposals,
    agreesWithHeuristic: Boolean(out.agreesWithHeuristic),
  };
}
