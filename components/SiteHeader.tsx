"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getActiveVisit, ACTIVE_VISIT_EVENT } from "@/lib/activeVisit";

// Responsive site header. On wide screens the links sit inline; on mobile they
// collapse behind a hamburger so the bar never crams or overflows. The "Book a
// visit" button stays visible (and compact) at every width.
export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // When the customer has an active visit, surface a persistent link back to
  // the "Where's my tech?" tracker so they can always return to it. Read on
  // mount and refresh on our custom event and cross-tab storage changes.
  const [visitId, setVisitId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setVisitId(getActiveVisit());
    sync();
    window.addEventListener(ACTIVE_VISIT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ACTIVE_VISIT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link href="/" className="brand" onClick={close}>
          <span className="logo">🐦</span>
          <span>Early Bird</span>
        </Link>

        {/* Desktop links */}
        <nav className="nav-desktop" aria-label="Primary">
          <Link href="/#services">Services</Link>
          <Link href="/#how">How it works</Link>
          {visitId && (
            <Link href={`/track/${visitId}`} className="nav-track">
              📍 Where&rsquo;s my tech?
            </Link>
          )}
          <Link href="/intake" className="btn btn-primary nav-cta">
            Book a visit
          </Link>
        </nav>

        {/* Mobile actions */}
        <div className="nav-mobile-actions">
          <Link href="/intake" className="btn btn-primary nav-cta" onClick={close}>
            Book
          </Link>
          <button
            type="button"
            className="nav-toggle"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile dropdown panel */}
      <div
        id="mobile-menu"
        className="nav-mobile-panel"
        data-open={open}
      >
        <div className="container">
          <Link href="/#services" onClick={close}>
            Services
          </Link>
          <Link href="/#how" onClick={close}>
            How it works
          </Link>
          {visitId && (
            <Link href={`/track/${visitId}`} onClick={close}>
              📍 Where&rsquo;s my tech?
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
