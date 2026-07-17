import { NextResponse } from "next/server";
import { getInitializedStore } from "@/lib/store";
import { pendingProposals } from "@/lib/triage/feedbackLoop";

export const runtime = "nodejs";

// GET /api/feedback — feedback records plus agreement stats for the dashboard.
export async function GET() {
  const store = await getInitializedStore();
  const [records, config] = await Promise.all([
    store.listFeedback(500),
    store.getHeuristicConfig(),
  ]);

  const withLlm = records.filter((r) => r.llmAvailable);
  const agg = {
    total: records.length,
    withLlm: withLlm.length,
    categoryAgreement: rate(withLlm.map((r) => r.categoriesAgree)),
    urgencyAgreement: rate(withLlm.map((r) => r.urgenciesAgree)),
    scopeAgreement: rate(withLlm.map((r) => r.scopeAgrees)),
    openProposals: pendingProposals(config, records).length,
  };

  return NextResponse.json({ records: records.slice(0, 100), stats: agg });
}

function rate(bools: boolean[]): number | null {
  if (bools.length === 0) return null;
  const t = bools.filter(Boolean).length;
  return Math.round((t / bools.length) * 100);
}
