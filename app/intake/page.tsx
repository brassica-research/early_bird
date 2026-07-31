"use client";

import { useState } from "react";
import Link from "next/link";
import { SERVICES } from "@/lib/services";
import { detectSafety } from "@/lib/safety";
import { STATES, parseStateFromAddress } from "@/lib/licensing";
import { assessIssue, type IssueAssessment } from "@/lib/issues";
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

// Issue-level scope advisory from the Issues Matrix. A safety hard-stop renders
// as the red emergency banner; everything else is a calm inline note. Advisory
// only — it never blocks a booking.
function IssueScopeAdvisory({ a }: { a: IssueAssessment | null }) {
  if (!a) return null;
  if (a.hardStop) {
    return (
      <div className="emergency-banner" role="alert">
        <span className="eb-icon" aria-hidden="true">
          ⚠
        </span>
        <div>
          <strong>Please don’t attempt this one yourself.</strong>
          <p>{a.message}</p>
        </div>
      </div>
    );
  }
  const label =
    a.scope === "in_scope"
      ? "We can typically handle this"
      : a.requiresLicensedPro
        ? "We’ll diagnose, then refer"
        : "We’ll take a look on-site";
  return (
    <div
      className={`alert ${a.scope === "in_scope" ? "alert-ok" : "alert-warn"}`}
      style={{ marginTop: 12 }}
    >
      <strong>{label}</strong>
      <p style={{ margin: "4px 0 0" }}>{a.message}</p>
    </div>
  );
}

interface DayGroup {
  key: string;
  short: string;
  slots: Slot[];
}

function groupSlotsByDay(slots: Slot[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const s of slots) {
    const d = new Date(s.start);
    const key = d.toISOString().slice(0, 10);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        short: d.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        slots: [],
      };
      map.set(key, g);
    }
    g.slots.push(s);
  }
  return [...map.values()];
}

export default function IntakePage() {
  const [step, setStep] = useState<Step>("form");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [clientUrgency, setClientUrgency] = useState<string>("");
  const [smsOptIn, setSmsOptIn] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [result, setResult] = useState<IntakeResponse | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);

  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [confirmedSlot, setConfirmedSlot] = useState<Slot | null>(null);

  // Live emergency scan of what the customer has entered so far.
  const safety = detectSafety(`${description} ${selectedItems.join(" ")}`);

  // Resolve the state: explicit pick wins, else best-effort from the address.
  // Captured for internal routing/disposition only (not shown to the customer).
  const effectiveState = stateCode || parseStateFromAddress(address) || "";
  // Live issue-scope match from what they've described + selected.
  const issueScope = assessIssue(`${description} ${selectedItems.join(" ")}`);

  // Group availability by day so the customer picks a day first, then a window
  // — instead of scrolling two weeks of slots at once (especially on mobile).
  const dayGroups = result ? groupSlotsByDay(result.availability) : [];
  const activeDay =
    dayGroups.find((d) => d.key === selectedDay) ?? dayGroups[0] ?? null;

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
          ...(effectiveState ? { state: effectiveState } : {}),
          affectedServices: buildAffectedServices(),
          description,
          ...(clientUrgency ? { clientUrgency } : {}),
          smsOptIn,
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
                <div className="form-field">
                  <label htmlFor="state">
                    State{" "}
                    <span className="hint">— helps us route your visit</span>
                  </label>
                  <select
                    id="state"
                    value={effectiveState}
                    onChange={(e) => setStateCode(e.target.value)}
                  >
                    <option value="">Select your state…</option>
                    {STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
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

              <div className="form-field">
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
                {safety.triggered && (
                  <div className="emergency-banner" role="alert">
                    <span className="eb-icon" aria-hidden="true">
                      ⚠
                    </span>
                    <div>
                      <strong>
                        If this is an emergency or you’re in danger, call 911
                        now.
                      </strong>
                      <p>
                        This may describe {safety.labels.join(" / ")}. Early Bird
                        technicians are not emergency responders.
                        {safety.codes.includes("gas") &&
                          " For a suspected gas leak, leave the building and call your gas utility or 911 before doing anything else."}
                        {safety.codes.includes("fire") &&
                          " If there is a fire, get everyone out and call 911."}{" "}
                        Some situations require a licensed professional — please
                        get to safety first.
                      </p>
                    </div>
                  </div>
                )}
                <IssueScopeAdvisory a={issueScope} />
              </div>

              <div className="form-field">
                <label>
                  How urgent is this?{" "}
                  <span className="hint">— helps us prioritize</span>
                </label>
                <div className="chips">
                  {[
                    { v: "emergency", label: "Emergency" },
                    { v: "high", label: "Today" },
                    { v: "normal", label: "This week" },
                    { v: "low", label: "Whenever" },
                  ].map((o) => (
                    <span
                      key={o.v}
                      className="chip"
                      data-on={clientUrgency === o.v}
                      role="button"
                      aria-pressed={clientUrgency === o.v}
                      tabIndex={0}
                      onClick={() =>
                        setClientUrgency(clientUrgency === o.v ? "" : o.v)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setClientUrgency(clientUrgency === o.v ? "" : o.v);
                        }
                      }}
                    >
                      {o.label}
                    </span>
                  ))}
                </div>
              </div>

              <label className="check-row" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={smsOptIn}
                  onChange={(e) => setSmsOptIn(e.target.checked)}
                />
                <span>
                  Text me updates at this number (e.g. when a technician is
                  assigned). Message &amp; data rates may apply.
                </span>
              </label>
            </div>

            <div className="form-actions" style={{ marginTop: 20 }}>
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
              <div className="row" style={{ gap: 8 }}>
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
              <div
                className="muted"
                style={{ fontSize: "0.85rem", marginTop: 6, marginBottom: 12 }}
              >
                Estimated ~{triage.estimatedDurationMin} min on-site
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

              <IssueScopeAdvisory
                a={result.submission.issueAssessment ?? null}
              />

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
              <>
                {/* Day picker (swipeable) */}
                <div className="day-row" role="tablist" aria-label="Choose a day">
                  {dayGroups.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      role="tab"
                      aria-selected={activeDay?.key === d.key}
                      className="day-chip"
                      data-on={activeDay?.key === d.key}
                      onClick={() => setSelectedDay(d.key)}
                    >
                      <span className="day-name">{d.short}</span>
                      <span className="day-count">{d.slots.length} open</span>
                    </button>
                  ))}
                </div>

                {/* Windows for the selected day */}
                {activeDay && (
                  <div className="slot-grid" style={{ marginTop: 14 }}>
                    {activeDay.slots.map((s) => (
                      <button
                        key={s.id}
                        className="slot"
                        data-on={chosenSlot === s.id}
                        onClick={() => setChosenSlot(s.id)}
                        type="button"
                      >
                        <div style={{ fontWeight: 700 }}>{s.windowLabel}</div>
                        <div className="cap">{s.capacity - s.booked} left</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="form-actions" style={{ marginTop: 24 }}>
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
            <div className="form-actions" style={{ marginTop: 20 }}>
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
