import { NextResponse } from "next/server";
import { getInitializedStore } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/submissions — recent intake submissions (admin dashboard).
export async function GET() {
  const store = await getInitializedStore();
  const submissions = await store.listSubmissions(100);
  return NextResponse.json({ submissions });
}
