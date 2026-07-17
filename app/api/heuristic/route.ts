import { NextResponse } from "next/server";
import { getInitializedStore } from "@/lib/store";
import { applyProposals, pendingProposals } from "@/lib/triage/feedbackLoop";
import { applyProposalsSchema } from "@/lib/validation";
import type { HeuristicChangeProposal } from "@/lib/types";

export const runtime = "nodejs";

// GET /api/heuristic — current config plus proposals still pending review.
export async function GET() {
  const store = await getInitializedStore();
  const config = await store.getHeuristicConfig();
  const feedback = await store.listFeedback(500);
  const pending = pendingProposals(config, feedback);
  return NextResponse.json({ config, pending });
}

// POST /api/heuristic — apply LLM-proposed changes to the heuristic config.
// mode "all_pending" applies every not-yet-reflected proposal; "specific"
// applies the proposals in the body. Bumps the config version on any change.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = applyProposalsSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const store = await getInitializedStore();
  const config = await store.getHeuristicConfig();

  let toApply: HeuristicChangeProposal[];
  if (parsed.data.mode === "specific") {
    toApply = (parsed.data.proposals || []) as HeuristicChangeProposal[];
  } else {
    const feedback = await store.listFeedback(500);
    toApply = pendingProposals(config, feedback).map((p) => p.proposal);
  }

  if (toApply.length === 0) {
    return NextResponse.json({
      config,
      applied: [],
      skipped: [],
      message: "No changes to apply.",
    });
  }

  const { config: next, applied, skipped } = applyProposals(config, toApply);
  if (applied.length > 0) {
    next.updatedAt = new Date().toISOString();
    await store.saveHeuristicConfig(next);
  }

  return NextResponse.json({ config: next, applied, skipped });
}
