import { NextResponse } from "next/server";
import { listAvailability } from "@/lib/scheduling/availability";
import { priceSlots } from "@/lib/pricing";

export const runtime = "nodejs";

// GET /api/availability — current open technician slots, each carrying the
// visit fee for its window (priced server-side; see lib/pricing).
export async function GET() {
  try {
    const slots = priceSlots(await listAvailability());
    return NextResponse.json({ slots });
  } catch (err) {
    console.error("Availability failed:", err);
    return NextResponse.json(
      { error: "Could not load availability." },
      { status: 500 },
    );
  }
}
