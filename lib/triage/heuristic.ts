import type { HeuristicConfig } from "@/lib/store/types";
import type {
  IntakeInput,
  TriageResult,
  CategoryScore,
  SafetyFlag,
  ServiceCategoryId,
  Urgency,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Rule-based heuristic triage.
//
// Deterministic, dependency-free, and driven entirely by HeuristicConfig data
// (data/heuristic-config.seed.json -> live copy in the store). Because the
// behavior is data, the LLM feedback loop can iterate it: proposals mutate the
// config, and this function's output changes accordingly — no code edits.
// ---------------------------------------------------------------------------

const URGENCY_RANK: Record<Urgency, number> = {
  low: 0,
  normal: 1,
  high: 2,
  emergency: 3,
};

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ")} `;
}

/** Count non-overlapping occurrences of a (possibly multi-word) term. */
function countTerm(haystack: string, term: string): number {
  const needle = ` ${term.toLowerCase()} `;
  if (needle.trim() === "") return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length - 1);
  }
  // Also match term at a word boundary even when adjacent to punctuation-
  // stripped edges (the leading/trailing spaces from normalize handle ends).
  return count;
}

export function runHeuristic(
  input: IntakeInput,
  config: HeuristicConfig,
): TriageResult {
  const haystack = normalize(
    [input.description, ...(input.affectedServices || [])].join(" . "),
  );

  // --- Category scoring ----------------------------------------------------
  const rawScores: CategoryScore[] = config.categories.map((cat) => {
    let score = 0;
    for (const kw of cat.keywords) {
      const hits = countTerm(haystack, kw.term);
      if (hits > 0) score += hits * kw.weight;
    }
    return {
      category: cat.id as ServiceCategoryId,
      label: cat.label,
      score,
      confidence: 0,
    };
  });

  const totalScore = rawScores.reduce((sum, s) => sum + s.score, 0);
  for (const s of rawScores) {
    s.confidence = totalScore > 0 ? s.score / totalScore : 0;
  }
  rawScores.sort((a, b) => b.score - a.score);

  const best = rawScores[0];
  const matchedSomething = best && best.score > 0;
  const category: ServiceCategoryId = matchedSomething
    ? best.category
    : "other";
  const categoryLabel = matchedSomething ? best.label : "Other / Needs review";

  // --- Urgency -------------------------------------------------------------
  let urgency: Urgency = "normal";
  for (const rule of config.urgencyRules) {
    if (countTerm(haystack, rule.term) > 0) {
      const ruleUrgency = rule.urgency as Urgency;
      if (URGENCY_RANK[ruleUrgency] > URGENCY_RANK[urgency]) {
        urgency = ruleUrgency;
      }
    }
  }
  // Unclassified requests default to "normal" but flag low confidence below.

  // --- Scope / safety ------------------------------------------------------
  const safetyFlags: SafetyFlag[] = [];
  for (const rule of config.scopeRules) {
    if (countTerm(haystack, rule.term) > 0) {
      safetyFlags.push({
        code: rule.term.replace(/\s+/g, "_"),
        message: rule.reason,
        requiresLicensedPro: true,
      });
    }
  }
  const withinNonLicensedScope = safetyFlags.length === 0;

  // --- Duration estimate ---------------------------------------------------
  const catConfig = config.categories.find((c) => c.id === category);
  let estimatedDurationMin = catConfig?.baseDurationMin ?? 60;
  if (urgency === "emergency") estimatedDurationMin += 30;

  // --- Summary -------------------------------------------------------------
  const confidencePct = Math.round((best?.confidence ?? 0) * 100);
  const summaryParts: string[] = [];
  if (matchedSomething) {
    summaryParts.push(
      `Classified as ${categoryLabel} (${confidencePct}% of keyword signal).`,
    );
  } else {
    summaryParts.push(
      "No strong category match from keywords — flagged for review.",
    );
  }
  summaryParts.push(`Urgency: ${urgency}.`);
  if (!withinNonLicensedScope) {
    summaryParts.push(
      "One or more safety/scope flags — may require a licensed pro.",
    );
  }

  return {
    source: "heuristic",
    category,
    categoryLabel,
    urgency,
    withinNonLicensedScope,
    safetyFlags,
    categoryScores: rawScores,
    troubleshootingSteps: [],
    estimatedDurationMin,
    summary: summaryParts.join(" "),
  };
}
