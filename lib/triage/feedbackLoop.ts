import type { HeuristicConfig } from "@/lib/store/types";
import type {
  HeuristicChangeProposal,
  FeedbackRecord,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// The self-improving part: turn LLM critique into concrete heuristic edits.
//
// `applyProposals` produces a NEW config (immutably) with the proposals folded
// in and the version bumped. `countRecurringProposals` supports optional
// auto-apply: a proposal that the LLM keeps making across submissions is a
// strong signal it generalizes.
// ---------------------------------------------------------------------------

/** Stable identity for a proposal, so recurrences can be counted/deduped. */
export function proposalKey(p: HeuristicChangeProposal): string {
  return [p.op, p.category ?? "-", p.term.toLowerCase().trim(), p.urgency ?? "-"]
    .join("::");
}

export interface ApplyResult {
  config: HeuristicConfig;
  applied: HeuristicChangeProposal[];
  skipped: Array<{ proposal: HeuristicChangeProposal; reason: string }>;
}

function clampWeight(w: unknown, fallback = 2): number {
  const n = typeof w === "number" ? w : fallback;
  return Math.max(1, Math.min(5, Math.round(n)));
}

export function applyProposals(
  input: HeuristicConfig,
  proposals: HeuristicChangeProposal[],
): ApplyResult {
  // Deep-ish clone (config is plain JSON).
  const config: HeuristicConfig = JSON.parse(JSON.stringify(input));
  const applied: HeuristicChangeProposal[] = [];
  const skipped: ApplyResult["skipped"] = [];

  for (const p of proposals) {
    const term = p.term?.toLowerCase().trim();
    if (!term) {
      skipped.push({ proposal: p, reason: "empty term" });
      continue;
    }

    if (p.op === "add_keyword" || p.op === "adjust_weight") {
      const cat = config.categories.find((c) => c.id === p.category);
      if (!cat) {
        skipped.push({ proposal: p, reason: `unknown category ${p.category}` });
        continue;
      }
      const existing = cat.keywords.find((k) => k.term.toLowerCase() === term);
      if (existing) {
        if (p.op === "adjust_weight" && p.weight != null) {
          existing.weight = clampWeight(p.weight, existing.weight);
          applied.push(p);
        } else {
          skipped.push({ proposal: p, reason: "keyword already exists" });
        }
      } else {
        cat.keywords.push({ term, weight: clampWeight(p.weight) });
        applied.push(p);
      }
    } else if (p.op === "add_urgency_rule") {
      if (!p.urgency) {
        skipped.push({ proposal: p, reason: "missing urgency" });
        continue;
      }
      const exists = config.urgencyRules.some(
        (r) => r.term.toLowerCase() === term,
      );
      if (exists) {
        skipped.push({ proposal: p, reason: "urgency rule already exists" });
      } else {
        config.urgencyRules.push({
          term,
          urgency: p.urgency,
          weight: clampWeight(p.weight, 3),
        });
        applied.push(p);
      }
    } else if (p.op === "add_scope_rule") {
      const exists = config.scopeRules.some(
        (r) => r.term.toLowerCase() === term,
      );
      if (exists) {
        skipped.push({ proposal: p, reason: "scope rule already exists" });
      } else {
        config.scopeRules.push({
          term,
          reason: p.scopeReason || p.rationale || "Requires a licensed pro.",
        });
        applied.push(p);
      }
    } else {
      skipped.push({ proposal: p, reason: `unknown op ${p.op}` });
    }
  }

  if (applied.length > 0) {
    config.version = input.version + 1;
    // updatedAt is stamped by the caller (which has access to the clock).
  }

  return { config, applied, skipped };
}

/**
 * The set of distinct proposals from feedback that are NOT yet reflected in the
 * config — i.e. applying them would actually change something. Each carries how
 * many times the LLM has proposed it (a generalizability signal for the UI).
 * This derives "pending" from data, so no per-proposal applied-state is stored.
 */
export interface PendingProposal {
  proposal: HeuristicChangeProposal;
  count: number;
}

export function pendingProposals(
  config: HeuristicConfig,
  feedback: FeedbackRecord[],
): PendingProposal[] {
  const counts = new Map<string, PendingProposal>();
  for (const rec of feedback) {
    for (const p of rec.proposals) {
      const key = proposalKey(p);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { proposal: p, count: 1 });
    }
  }
  // Keep only proposals that would actually apply against the current config.
  return [...counts.values()]
    .filter(({ proposal }) => applyProposals(config, [proposal]).applied.length > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Count how many times each distinct proposal appears across recent feedback,
 * for optional auto-apply. Returns proposals meeting `threshold`, deduped.
 */
export function recurringProposals(
  feedback: FeedbackRecord[],
  threshold: number,
): HeuristicChangeProposal[] {
  const counts = new Map<
    string,
    { proposal: HeuristicChangeProposal; count: number }
  >();
  for (const rec of feedback) {
    for (const p of rec.proposals) {
      const key = proposalKey(p);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { proposal: p, count: 1 });
    }
  }
  return [...counts.values()]
    .filter((e) => e.count >= threshold)
    .map((e) => e.proposal);
}
