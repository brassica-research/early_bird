import { randomUUID } from "crypto";
import { getInitializedStore } from "@/lib/store";
import type { IntakeInput, TriageResult, FeedbackRecord } from "@/lib/types";
import { runHeuristic } from "./heuristic";
import { runLlmTriage, isLlmConfigured } from "./llm";
import { applyProposals, recurringProposals } from "./feedbackLoop";

export { isLlmConfigured };

export interface TriageOutcome {
  /** Result surfaced to the customer (LLM when available, else heuristic). */
  triage: TriageResult;
  /** Heuristic result, always computed and retained for auditing. */
  heuristicTriage: TriageResult;
  feedback: FeedbackRecord;
}

/**
 * Triage one intake: run the heuristic always, run the LLM as primary when
 * configured, record the comparison for the feedback loop, and (optionally)
 * auto-apply recurring heuristic improvements.
 */
export async function triageIntake(
  input: IntakeInput,
  submissionId: string,
): Promise<TriageOutcome> {
  const store = await getInitializedStore();
  const config = await store.getHeuristicConfig();

  const heuristicTriage = runHeuristic(input, config);

  let surfaced = heuristicTriage;
  let llmTriage: TriageResult | null = null;
  let proposals: FeedbackRecord["proposals"] = [];

  if (isLlmConfigured()) {
    try {
      const llmOut = await runLlmTriage(input, config, heuristicTriage);
      if (llmOut) {
        llmTriage = llmOut.triage;
        surfaced = llmOut.triage; // LLM is primary
        proposals = llmOut.proposals;
      }
    } catch (err) {
      // LLM failure must never block intake — fall back to the heuristic.
      console.error("LLM triage failed, using heuristic:", err);
    }
  }

  const feedback: FeedbackRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    submissionId,
    heuristic: heuristicTriage,
    llm: llmTriage,
    llmAvailable: llmTriage !== null,
    categoriesAgree: llmTriage
      ? llmTriage.category === heuristicTriage.category
      : true,
    urgenciesAgree: llmTriage
      ? llmTriage.urgency === heuristicTriage.urgency
      : true,
    scopeAgrees: llmTriage
      ? llmTriage.withinNonLicensedScope ===
        heuristicTriage.withinNonLicensedScope
      : true,
    proposals,
  };

  await store.appendFeedback(feedback);

  // Optional auto-apply of recurring, generalizable proposals.
  if (
    (process.env.HEURISTIC_AUTO_APPLY || "false").toLowerCase() === "true" &&
    proposals.length > 0
  ) {
    try {
      const threshold = Number(process.env.AUTO_APPLY_THRESHOLD || "3");
      const recent = await store.listFeedback(500);
      const recurring = recurringProposals(recent, threshold);
      if (recurring.length > 0) {
        const { config: next, applied } = applyProposals(config, recurring);
        if (applied.length > 0) {
          next.updatedAt = new Date().toISOString();
          await store.saveHeuristicConfig(next);
          console.log(
            `Auto-applied ${applied.length} heuristic change(s); config v${next.version}.`,
          );
        }
      }
    } catch (err) {
      console.error("Auto-apply of heuristic proposals failed:", err);
    }
  }

  return { triage: surfaced, heuristicTriage, feedback };
}
