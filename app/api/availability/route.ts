import { NextResponse } from "next/server";
import { listAvailability } from "@/lib/scheduling/availability";

export const runtime = "nodejs";

// GET /api/availability — current open technician slots.
export async function GET() {
  try {
    const slots = await listAvailability();
    return NextResponse.json({ slots });
  } catch (err) {
    console.error("Availability failed:", err);
    return NextResponse.json(
      { error: "Could not load availability." },
      { status: 500 },
    );
  }
}
