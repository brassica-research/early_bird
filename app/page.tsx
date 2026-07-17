import Link from "next/link";
import { SERVICES } from "@/lib/services";

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="hero">
        <div className="container">
          <span className="pill">
            <span className="dot" /> On-site help, within a few hours
          </span>
          <h1>The early fix beats the big repair.</h1>
          <p className="lead">
            Early Bird sends a skilled technician to your door for on-site
            diagnostics, troubleshooting, and repair across plumbing,
            electrical, appliances, HVAC & air quality, basic home repair, and
            internet. Describe the problem — we triage it instantly and get a
            technician to you, often within a few hours.
          </p>
          <div className="hero-cta">
            <Link href="/intake" className="btn btn-primary">
              Describe your issue →
            </Link>
            <Link href="/#how" className="btn btn-ghost">
              How it works
            </Link>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="section" id="services">
        <div className="container">
          <p className="eyebrow">What we handle</p>
          <h2 className="section-title">Six domains, one visit.</h2>
          <p className="muted" style={{ maxWidth: "56ch", marginTop: 0 }}>
            Most jobs are handled by a skilled, non-licensed technician. Anything
            that needs a licensed pro (gas, service panels, refrigerant, main
            lines) we flag up front — no surprises.
          </p>
          <div className="grid cols-3" style={{ marginTop: 28 }}>
            {SERVICES.map((s) => (
              <div key={s.id} className="card service">
                <div className="ico">{s.icon}</div>
                <h3>{s.title}</h3>
                <p>{s.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section" id="how" style={{ background: "var(--surface)" }}>
        <div className="container">
          <p className="eyebrow">How it works</p>
          <h2 className="section-title">From “what’s wrong?” to booked in minutes.</h2>
          <div className="grid cols-3" style={{ marginTop: 28 }}>
            <div className="card step">
              <div className="num">1</div>
              <div>
                <h3 style={{ margin: "0 0 4px" }}>Describe it</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Tell us what’s happening in plain language and tag the affected
                  systems or appliances.
                </p>
              </div>
            </div>
            <div className="card step">
              <div className="num">2</div>
              <div>
                <h3 style={{ margin: "0 0 4px" }}>Instant triage</h3>
                <p className="muted" style={{ margin: 0 }}>
                  We classify the issue, gauge urgency, flag any safety concerns,
                  and share safe steps you can try now.
                </p>
              </div>
            </div>
            <div className="card step">
              <div className="num">3</div>
              <div>
                <h3 style={{ margin: "0 0 4px" }}>Pick a time</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Choose from real open windows. A technician arrives on-site,
                  diagnoses, and repairs.
                </p>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 32 }}>
            <Link href="/intake" className="btn btn-primary">
              Start your intake →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
