import Link from "next/link";
import type { Metadata } from "next";
import TechTracker from "@/components/TechTracker";

export const metadata: Metadata = {
  title: "Where's my tech? — Early Bird",
  description:
    "Follow your Early Bird technician's approximate location and a live countdown to their arrival.",
};

// Public tracking page. The submission id in the URL is the capability — it's
// the unguessable reference the customer gets at booking and in their email
// (same model as a parcel tracking link). The API behind it publishes only the
// coarse tracking view, never contact details or precise coordinates.
export default async function TrackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 620 }}>
        <p className="eyebrow">Your visit</p>
        <h2 className="section-title">Where&rsquo;s my tech?</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          This page updates itself — leave it open and watch them get closer.
        </p>

        <div style={{ marginTop: 16 }}>
          <TechTracker submissionId={id} />
        </div>

        <div className="form-actions" style={{ marginTop: 20 }}>
          <Link href="/" className="btn btn-ghost">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
