"use client";

import { useState } from "react";
import Link from "next/link";

// Responsive site header. On wide screens the links sit inline; on mobile they
// collapse behind a hamburger so the bar never crams or overflows. The "Book a
// visit" button stays visible (and compact) at every width.
export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
        </div>
      </div>
    </header>
  );
}
