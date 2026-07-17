"use client";

import { useState } from "react";
import Link from "next/link";
import { SERVICES } from "@/lib/services";
import type { Submission, Slot, TriageResult } from "@/lib/types";

type Step = "form" | "triage" | "done";

interface IntakeResponse {
  submission: Submission;
  availability: Slot[];
}

const URGENCY_BADGE: Record<string, string> = {
  emergency: "badge-emergency",
  high: "badge-high",
  normal: "badge-normal",
  low: "badge-low",
};

function UrgencyBadge({ urgency }: { urgency: string }) {
  return (
    <span className={`badge ${URGENCY_BADGE[urgency] || "badge-normal"}`}>
      {urgency.toUpperCase()}
    </span>
  );
}

function groupSlotsByDay(slots: Slot[]): [string, Slot[]][] {
  const map = new Map<string, Slot[]>();
  for (const s of slots) {
    const day = new Date(s.start).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    (map.get(day) ?? map.set(day, []).get(day)!).push(s);
  }
  return [...map.entries()];
}

export default function IntakePage() {
  const [step, setStep] = useState<Step>("form");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [result, setResult] = useState<IntakeResponse | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);

  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [confirmedSlot, setConfirmedSlot] = useState<Slot | null>(null);

  // Progressive selection: choose affected area(s) first, then reveal the
  // specific items for just those areas — keeps the form uncluttered on mobile.
  function toggleCategory(id: string) {
    setSelectedCategories((prev) => {
      if (prev.includes(id)) {
        // Deselecting a category also clears any of its sub-selections.
        const cat = SERVICES.find((s) => s.id === id);
        if (cat) {
          setSelectedItems((items) =>
            items.filter((it) => !cat.examples.includes(it)),
          );
        }
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  }

  function toggleItem(label: string) {
    setSelectedItems((prev) =>
      prev.includes(label)
        ? prev.filter((x) => x !== label)
        : [...prev, label],
    );
  }

  // Send specific items when chosen; fall back to the category name so a
  // selected area still gives triage a signal even with no sub-item picked.
  function buildAffectedServices(): string[] {
    const out: string[] = [];
    for (const cat of SERVICES) {
      if (!selectedCategories.includes(cat.id)) continue;
      const chosen = cat.examples.filter((e) => selectedItems.includes(e));
      if (chosen.length) out.push(...chosen);
      else out.push(cat.title);
    }
    return out;
  }

  async function submitIntake(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          address,
          affectedServices: buildAffectedServices(),
          description,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.details?.fieldErrors) setFieldErrors(data.details.fieldErrors);
        setError(data.error || "Something went wrong.");
        return;
      }
      setResult(data);
      setTriage(data.submission.triage);
      setStep("triage");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmBooking() {
    if (!result || !chosenSlot) return;
    setBooking(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: result.submission.id,
          slotId: chosenSlot,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not book that slot.");
        // Refresh availability so a full slot disappears.
        const av = await fetch("/api/availability").then((r) => r.json());
        setResult((prev) => (prev ? { ...prev, availability: av.slots } : prev));
        return;
      }
      setConfirmedSlot(data.slot);
      setStep("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBooking(false);
    }
  }

  const stepIndex = step === "form" ? 0 : step === "triage" ? 1 : 2;

  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="stepbar">
          {[0, 1, 2].map((i) => (
            <div key={i} className="seg" data-on={i <= stepIndex} />
          ))}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {/* STEP 1 — FORM */}
        {step === "form" && (
          <form onSubmit={submitIntake}>
            <p className="eyebrow">Step 1 of 3 · Tell us what’s wrong</p>
            <h2 className="section-title">Book an on-site visit</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              A few details and a description — we’ll triage it instantly.
            </p>

            <div className="card" style={{ padding: 22, marginTop: 20 }}>
              <div className="grid cols-2">
                <div className="form-field">
                  <label htmlFor="name">Full name</label>
                  <input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    required
                  />
                  {fieldErrors.name && (
                    <div className="field-error">{fieldErrors.name[0]}</div>
                  )}
                </div>
                <div className="form-field">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@example.com"
                    required
                  />
                  {fieldErrors.email && (
                    <div className="field-error">{fieldErrors.email[0]}</div>
                  )}
                </div>
                <div className="form-field">
                  <label htmlFor="phone">Phone number</label>
                  <input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    required
                  />
                  {fieldErrors.phone && (
                    <div className="field-error">{fieldErrors.phone[0]}</div>
                  )}
                </div>
                <div className="form-field">
                  <label htmlFor="address">Home address</label>
                  <input
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St, Springfield"
                    required
                  />
                  {fieldErrors.address && (
                    <div className="field-error">{fieldErrors.address[0]}</div>
                  )}
                </div>
              </div>

              <div className="form-field">
                <label>
                  Affected services or appliances{" "}
                  <span className="hint">
                    — pick the area(s), then narrow down
                  </span>
                </label>
                <div className="chips">
                  {SERVICES.map((cat) => (
                    <span
                      key={cat.id}
                      className="chip cat-chip"
                      data-on={selectedCategories.includes(cat.id)}
                      onClick={() => toggleCategory(cat.id)}
                      role="button"
                      aria-pressed={selectedCategories.includes(cat.id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleCategory(cat.id);
                        }
                      }}
                    >
                      <span aria-hidden="true">{cat.icon}</span> {cat.title}
                    </span>
                  ))}
                </div>

                {SERVICES.filter((c) =>
                  selectedCategories.includes(c.id),
                ).map((cat) => (
                  <div className="subgroup" key={cat.id}>
                    <div className="subgroup-label">
                      <span aria-hidden="true">{cat.icon}</span> {cat.title}
                      <span className="hint"> — specifics (optional)</span>
                    </div>
                    <div className="chips">
                      {cat.examples.map((label) => (
                        <span
                          key={label}
                          className="chip"
                          data-on={selectedItems.includes(label)}
                          onClick={() => toggleItem(label)}
                          role="button"
                          aria-pressed={selectedItems.includes(label)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleItem(label);
                            }
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label htmlFor="desc">
                  Description of the issue / request
                </label>
                <textarea
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. The kitchen faucet drips constantly and the cabinet underneath is getting damp. Started two days ago."
                  required
                />
                {fieldErrors.description && (
                  <div className="field-error">
                    {fieldErrors.description[0]}
                  </div>
                )}
              </div>
            </div>

            <div className="row" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" disabled={submitting}>
                {submitting ? (
                  <>
                    <span className="spin" /> Triaging…
                  </>
                ) : (
                  "Triage my issue →"
                )}
              </button>
              <Link href="/" className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        )}

        {/* STEP 2 — TRIAGE + SCHEDULING */}
        {step === "triage" && triage && result && (
          <div>
            <p className="eyebrow">Step 2 of 3 · Your triage result</p>
            <h2 className="section-title">Here’s what we found</h2>

            <div className="card" style={{ padding: 22, marginTop: 12 }}>
              <div className="spread" style={{ marginBottom: 12 }}>
                <div className="row">
                  <strong style={{ fontSize: "1.1rem" }}>
                    {triage.categoryLabel}
                  </strong>
                  <UrgencyBadge urgency={triage.urgency} />
                  {triage.withinNonLicensedScope ? (
                    <span className="badge badge-ok">In scope</span>
                  ) : (
                    <span className="badge badge-high">Needs licensed pro</span>
                  )}
                </div>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  ~{triage.estimatedDurationMin} min on-site
                </span>
              </div>

              <p style={{ marginTop: 0 }}>{triage.summary}</p>

              {triage.safetyFlags.length > 0 && (
                <div className="alert alert-warn" style={{ marginTop: 12 }}>
                  <strong>Safety / scope notes</strong>
                  <ul className="clean">
                    {triage.safetyFlags.map((f, i) => (
                      <li key={i}>{f.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {triage.troubleshootingSteps.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <strong>Safe things you can try now</strong>
                  <ul className="clean">
                    {triage.troubleshootingSteps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Scheduling */}
            <h3 style={{ marginTop: 28, marginBottom: 4 }}>Pick a visit time</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Choose an open window. Times are shown in your local timezone.
            </p>

            {result.availability.length === 0 ? (
              <div className="alert alert-warn">
                No open windows right now — we’ll reach out to schedule. Your
                request is saved.
              </div>
            ) : (
              groupSlotsByDay(result.availability).map(([day, slots]) => (
                <div key={day}>
                  <div className="slot-day">{day}</div>
                  <div className="slot-grid">
                    {slots.map((s) => (
                      <button
                        key={s.id}
                        className="slot"
                        data-on={chosenSlot === s.id}
                        onClick={() => setChosenSlot(s.id)}
                        type="button"
                      >
                        <div style={{ fontWeight: 700 }}>{s.windowLabel}</div>
                        <div className="cap">
                          {s.capacity - s.booked} left
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}

            <div className="row" style={{ marginTop: 24 }}>
              <button
                className="btn btn-primary"
                onClick={confirmBooking}
                disabled={!chosenSlot || booking}
              >
                {booking ? (
                  <>
                    <span className="spin" /> Booking…
                  </>
                ) : (
                  "Confirm booking →"
                )}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setStep("form")}
                type="button"
              >
                ← Edit details
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 — DONE */}
        {step === "done" && result && (
          <div>
            <p className="eyebrow">Step 3 of 3 · Confirmed</p>
            <h2 className="section-title">You’re booked. 🌅</h2>
            <div className="card" style={{ padding: 24, marginTop: 12 }}>
              <div className="alert alert-ok" style={{ marginBottom: 16 }}>
                A technician is scheduled. A confirmation will be sent to{" "}
                <strong>{result.submission.input.email}</strong>.
              </div>
              {confirmedSlot && (
                <p style={{ marginTop: 0 }}>
                  <strong>When:</strong>{" "}
                  {new Date(confirmedSlot.start).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}{" "}
                  · {confirmedSlot.windowLabel}
                </p>
              )}
              <p>
                <strong>Where:</strong> {result.submission.input.address}
              </p>
              <p>
                <strong>Issue:</strong> {result.submission.triage.categoryLabel}{" "}
                · <UrgencyBadge urgency={result.submission.triage.urgency} />
              </p>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Reference: {result.submission.id}
              </p>
            </div>
            <div className="row" style={{ marginTop: 20 }}>
              <Link href="/" className="btn btn-ghost">
                Back to home
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
