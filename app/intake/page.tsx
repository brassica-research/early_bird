"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  SERVICES,
  describeSelection,
  itemKey,
  symptomKey,
} from "@/lib/services";
import { detectSafety } from "@/lib/safety";
import { STATES, parseStateFromAddress } from "@/lib/licensing";
import { assessIssue, type IssueAssessment } from "@/lib/issues";
import { FLOORS, MAX_PHOTOS, ROOM_SUGGESTIONS } from "@/lib/rooms";
import {
  formatBytes,
  preparePhoto,
  toUploadPayload,
  type PreparedPhoto,
} from "@/lib/photoUpload";
import {
  DAY_FEE_CENTS,
  EVENING_FEE_CENTS,
  formatMoney,
  type PricedSlot,
} from "@/lib/pricing";
import {
  brandLabel,
  detectBrand,
  digitsOnly,
  formatCardNumber,
  formatExpiry,
  parseExpiry,
  validateCardForm,
  type CardBrand,
} from "@/lib/card";
import TechTracker from "@/components/TechTracker";
import type { Submission, TriageResult, VisitFeePayment } from "@/lib/types";

type Step = "form" | "schedule" | "payment" | "done";

interface IntakeResponse {
  submission: Submission;
  availability: PricedSlot[];
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
      : "We’ll assess this on-site";
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
  slots: PricedSlot[];
}

function groupSlotsByDay(slots: PricedSlot[]): DayGroup[] {
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

/** A tappable chip. Same keyboard affordances everywhere on the form. */
function Chip({
  on,
  onToggle,
  className = "chip",
  children,
}: {
  on: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={className}
      data-on={on}
      role="button"
      aria-pressed={on}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {children}
    </span>
  );
}

export default function IntakePage() {
  const [step, setStep] = useState<Step>("form");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [stateCode, setStateCode] = useState("");

  // Three-level issue drill-down: category → item → symptom. Items and
  // symptoms are stored fully qualified ("plumbing:faucet", and
  // "plumbing:faucet:Drips when shut off") so labels can repeat across trades.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);

  const [room, setRoom] = useState("");
  const [floor, setFloor] = useState("");
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [description, setDescription] = useState("");
  const [additionalRequests, setAdditionalRequests] = useState("");
  const [clientUrgency, setClientUrgency] = useState<string>("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  // Desktop CTA reveals the number instead of dialing (mobile dials directly).
  const [showPhone, setShowPhone] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [result, setResult] = useState<IntakeResponse | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);

  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [heldSlot, setHeldSlot] = useState<PricedSlot | null>(null);

  // Checkout
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardZip, setCardZip] = useState("");
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<VisitFeePayment | null>(null);
  const [trackUrl, setTrackUrl] = useState<string | null>(null);

  const selection = useMemo(
    () => ({
      categories: selectedCategories,
      items: selectedItems,
      symptoms: selectedSymptoms,
    }),
    [selectedCategories, selectedItems, selectedSymptoms],
  );
  const affectedServices = useMemo(
    () => describeSelection(selection),
    [selection],
  );

  // Live emergency scan of what the customer has entered so far. The
  // "anything else" box is included: a gas smell mentioned in passing has to
  // raise the banner just as loudly as one in the main description.
  const safety = detectSafety(
    `${description} ${additionalRequests} ${affectedServices.join(" ")}`,
  );

  // Resolve the state: explicit pick wins, else best-effort from the address.
  // Captured for internal routing/disposition only (not shown to the customer).
  const effectiveState = stateCode || parseStateFromAddress(address) || "";
  // Live issue-scope match from what they've described + selected.
  const issueScope = assessIssue(
    `${description} ${affectedServices.join(" ")} ${room}`,
  );

  // Call-center number for the tap-to-call CTA (mobile). Configurable so it can
  // point at the real line without a code change.
  const supportPhone =
    process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+1 (800) 555-0100";
  const telHref = `tel:${supportPhone.replace(/[^\d+]/g, "")}`;

  // Group availability by day so the customer picks a day first, then a window
  // — instead of scrolling two weeks of slots at once (especially on mobile).
  const dayGroups = result ? groupSlotsByDay(result.availability) : [];
  const activeDay =
    dayGroups.find((d) => d.key === selectedDay) ?? dayGroups[0] ?? null;
  const chosenSlotObj =
    result?.availability.find((s) => s.id === chosenSlot) ?? null;

  // --- Drill-down selection ------------------------------------------------

  function toggleCategory(id: string) {
    setSelectedCategories((prev) => {
      if (!prev.includes(id)) return [...prev, id];
      // Deselecting a category clears everything nested under it.
      setSelectedItems((items) => items.filter((k) => !k.startsWith(`${id}:`)));
      setSelectedSymptoms((syms) => syms.filter((k) => !k.startsWith(`${id}:`)));
      return prev.filter((x) => x !== id);
    });
  }

  function toggleItem(categoryId: string, itemId: string) {
    const key = itemKey(categoryId, itemId);
    setSelectedItems((prev) => {
      if (!prev.includes(key)) return [...prev, key];
      // Deselecting an item clears its symptoms too.
      setSelectedSymptoms((syms) => syms.filter((k) => !k.startsWith(`${key}:`)));
      return prev.filter((x) => x !== key);
    });
  }

  function toggleSymptom(categoryId: string, itemId: string, symptom: string) {
    const key = symptomKey(categoryId, itemId, symptom);
    setSelectedSymptoms((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );
  }

  // --- Photos --------------------------------------------------------------

  async function onPickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    // Let the same file be picked again after a removal.
    e.target.value = "";
    if (files.length === 0) return;

    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const slotsLeft = MAX_PHOTOS - photos.length;
      if (slotsLeft <= 0) {
        setPhotoError(`You can attach up to ${MAX_PHOTOS} photos.`);
        return;
      }
      const accepted: PreparedPhoto[] = [];
      for (const file of files.slice(0, slotsLeft)) {
        try {
          accepted.push(await preparePhoto(file));
        } catch (err) {
          setPhotoError(
            err instanceof Error ? err.message : "That photo couldn’t be added.",
          );
        }
      }
      if (files.length > slotsLeft) {
        setPhotoError(
          `Only the first ${slotsLeft} photo(s) were added — max ${MAX_PHOTOS}.`,
        );
      }
      if (accepted.length) setPhotos((prev) => [...prev, ...accepted]);
    } finally {
      setPhotoBusy(false);
    }
  }

  function removePhoto(localId: string) {
    setPhotos((prev) => prev.filter((p) => p.localId !== localId));
    setPhotoError(null);
  }

  // --- Submission ----------------------------------------------------------

  async function submitIntake(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!floor) {
      setFieldErrors({ floor: ["Choose the floor the issue is on"] });
      return;
    }
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
          affectedServices,
          room,
          floor,
          description,
          ...(additionalRequests.trim()
            ? { additionalRequests: additionalRequests.trim() }
            : {}),
          ...(clientUrgency ? { clientUrgency } : {}),
          smsOptIn,
          photos: photos.map(toUploadPayload),
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
      setStep("schedule");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Reserve the chosen window before taking payment. Holding first means the
   * customer never pays for a slot that filled up while they typed a card.
   */
  async function holdSlotAndPay() {
    if (!result || !chosenSlot) return;
    setHolding(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: result.submission.id,
          slotId: chosenSlot,
          hold: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not hold that slot.");
        // Refresh availability so a full slot disappears.
        const av = await fetch("/api/availability").then((r) => r.json());
        setResult((prev) => (prev ? { ...prev, availability: av.slots } : prev));
        setChosenSlot(null);
        return;
      }
      setHeldSlot(data.slot ?? chosenSlotObj);
      setStep("payment");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setHolding(false);
    }
  }

  async function payAndConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!result) return;
    setError(null);

    // Validate the card in the browser. The number stops here — only the
    // brand, last four and expiry are sent on.
    const errors = validateCardForm({
      name: cardName,
      number: cardNumber,
      expiry: cardExpiry,
      cvc: cardCvc,
      postalCode: cardZip,
    });
    setCardErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const exp = parseExpiry(cardExpiry)!;
    const digits = digitsOnly(cardNumber);

    setPaying(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: result.submission.id,
          card: {
            brand: detectBrand(cardNumber),
            last4: digits.slice(-4),
            expMonth: exp.month,
            expYear: exp.year,
            name: cardName.trim(),
            postalCode: cardZip.trim(),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "That payment didn’t go through.");
        return;
      }
      setReceipt(data.visitFee);
      setTrackUrl(data.trackUrl ?? null);
      setResult((prev) => (prev ? { ...prev, submission: data.submission } : prev));
      setHeldSlot((prev) => (data.slot ? { ...data.slot, fee: prev?.fee ?? data.slot.fee } : prev));
      // Clear the card fields as soon as we're done with them.
      setCardNumber("");
      setCardCvc("");
      setStep("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setPaying(false);
    }
  }

  const stepIndex =
    step === "form" ? 0 : step === "schedule" ? 1 : step === "payment" ? 2 : 3;
  const cardBrand = detectBrand(cardNumber);

  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="stepbar">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="seg" data-on={i <= stepIndex} />
          ))}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {/* STEP 1 — FORM */}
        {step === "form" && (
          <form onSubmit={submitIntake}>
            <p className="eyebrow">Step 1 of 4 · Tell us what’s wrong</p>
            <h2 className="section-title">Book an on-site visit</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              A few details and a description — we’ll triage it instantly.
            </p>

            {/* Mobile: tap to dial the call center directly. */}
            <div className="call-cta">
              <p className="call-cta-label">Rather talk to a person?</p>
              <a
                className="btn btn-call"
                href={telHref}
                aria-label={`Call Early Bird at ${supportPhone}`}
              >
                <span aria-hidden="true">📞</span> Talk to a Tech Now
              </a>
            </div>

            {/* Desktop: reveal the number (no auto-dial). */}
            <div className="call-cta-desktop">
              <p className="call-cta-label">Rather talk to a person?</p>
              {showPhone ? (
                <div className="call-reveal" role="status">
                  <span aria-hidden="true">📞</span>
                  <span>
                    Call our team at <strong>{supportPhone}</strong>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-call"
                  onClick={() => setShowPhone(true)}
                  aria-expanded={showPhone}
                >
                  <span aria-hidden="true">📞</span> Talk to a Tech Now
                </button>
              )}
            </div>

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

              {/* Level 1 → 2 → 3: area → item → symptom */}
              <div className="form-field">
                <label>
                  What’s the problem with?{" "}
                  <span className="hint">
                    — pick an area, then the item, then what it’s doing
                  </span>
                </label>
                <div className="chips">
                  {SERVICES.map((cat) => (
                    <Chip
                      key={cat.id}
                      className="chip cat-chip"
                      on={selectedCategories.includes(cat.id)}
                      onToggle={() => toggleCategory(cat.id)}
                    >
                      <span aria-hidden="true">{cat.icon}</span> {cat.title}
                    </Chip>
                  ))}
                </div>

                {SERVICES.filter((c) => selectedCategories.includes(c.id)).map(
                  (cat) => (
                    <div className="subgroup" key={cat.id}>
                      <div className="subgroup-label">
                        <span aria-hidden="true">{cat.icon}</span> {cat.title}
                        <span className="hint"> — which item?</span>
                      </div>
                      <div className="chips">
                        {cat.items.map((item) => (
                          <Chip
                            key={item.id}
                            on={selectedItems.includes(itemKey(cat.id, item.id))}
                            onToggle={() => toggleItem(cat.id, item.id)}
                          >
                            {item.label}
                          </Chip>
                        ))}
                      </div>

                      {/* Level 3 — symptoms, revealed per selected item */}
                      {cat.items
                        .filter((item) =>
                          selectedItems.includes(itemKey(cat.id, item.id)),
                        )
                        .map((item) => (
                          <div className="subgroup deep" key={item.id}>
                            <div className="subgroup-label">
                              {item.label}
                              <span className="hint"> — what’s it doing?</span>
                            </div>
                            <div className="chips">
                              {item.symptoms.map((s) => (
                                <Chip
                                  key={s}
                                  on={selectedSymptoms.includes(
                                    symptomKey(cat.id, item.id, s),
                                  )}
                                  onToggle={() =>
                                    toggleSymptom(cat.id, item.id, s)
                                  }
                                >
                                  {s}
                                </Chip>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  ),
                )}
              </div>

              {/* Where in the home */}
              <div className="form-field">
                <label htmlFor="room">
                  Which room is it in?{" "}
                  <span className="hint">— tap one or type your own</span>
                </label>
                <div className="chips">
                  {ROOM_SUGGESTIONS.map((r) => (
                    <Chip
                      key={r}
                      on={room === r}
                      onToggle={() => setRoom(room === r ? "" : r)}
                    >
                      {r}
                    </Chip>
                  ))}
                </div>
                <input
                  id="room"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  placeholder="e.g. Kitchen, or “the workshop off the garage”"
                  maxLength={80}
                  required
                  style={{ marginTop: 10 }}
                />
                {fieldErrors.room && (
                  <div className="field-error">{fieldErrors.room[0]}</div>
                )}
              </div>

              <div className="form-field">
                <label>
                  What floor is it on?{" "}
                  <span className="hint">— so we bring the right gear</span>
                </label>
                <div className="floor-grid">
                  {FLOORS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="floor-opt"
                      data-on={floor === f.id}
                      aria-pressed={floor === f.id}
                      onClick={() => setFloor(f.id)}
                    >
                      <span className="floor-label">{f.label}</span>
                      <span className="floor-hint">{f.hint}</span>
                    </button>
                  ))}
                </div>
                {fieldErrors.floor && (
                  <div className="field-error">{fieldErrors.floor[0]}</div>
                )}
              </div>

              {/* Photos */}
              <div className="form-field">
                <label htmlFor="photos">
                  Add photos{" "}
                  <span className="hint">
                    — optional, but they help us bring the right parts
                  </span>
                </label>
                <input
                  ref={fileInput}
                  id="photos"
                  className="visually-hidden"
                  type="file"
                  accept="image/*"
                  // `capture` makes the camera the default on phones; the
                  // picker still offers the photo library.
                  capture="environment"
                  multiple
                  onChange={onPickPhotos}
                />
                <div className="photo-actions">
                  <button
                    type="button"
                    className="btn btn-ghost photo-btn"
                    onClick={() => fileInput.current?.click()}
                    disabled={photoBusy || photos.length >= MAX_PHOTOS}
                  >
                    {photoBusy ? (
                      <>
                        <span className="spin" /> Adding…
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">📷</span> Take or choose a photo
                      </>
                    )}
                  </button>
                  <span className="hint">
                    {photos.length}/{MAX_PHOTOS} attached
                  </span>
                </div>
                {photoError && <div className="field-error">{photoError}</div>}
                {photos.length > 0 && (
                  <ul className="photo-grid">
                    {photos.map((p) => (
                      <li key={p.localId} className="photo-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.dataUrl} alt={p.name || "Attached photo"} />
                        <button
                          type="button"
                          className="photo-remove"
                          aria-label={`Remove ${p.name || "photo"}`}
                          onClick={() => removePhoto(p.localId)}
                        >
                          ×
                        </button>
                        <span className="photo-size">{formatBytes(p.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
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

              {/* Unrelated extras for the same visit. */}
              <div className="form-field">
                <label htmlFor="extras">
                  Anything else while we&rsquo;re there?{" "}
                  <span className="hint">
                    — optional; unrelated odds and ends we can look at on the
                    same visit
                  </span>
                </label>
                <textarea
                  id="extras"
                  value={additionalRequests}
                  onChange={(e) => setAdditionalRequests(e.target.value)}
                  placeholder="e.g. The hall light flickers, and the guest bathroom door won't latch. No rush on either."
                  maxLength={2000}
                  rows={3}
                />
                {fieldErrors.additionalRequests && (
                  <div className="field-error">
                    {fieldErrors.additionalRequests[0]}
                  </div>
                )}
                <p className="hint" style={{ marginTop: 6 }}>
                  These don&rsquo;t change your triage or your visit fee — your
                  technician will take a look and quote anything you decide to
                  go ahead with.
                </p>
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
                    <Chip
                      key={o.v}
                      on={clientUrgency === o.v}
                      onToggle={() =>
                        setClientUrgency(clientUrgency === o.v ? "" : o.v)
                      }
                    >
                      {o.label}
                    </Chip>
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
        {step === "schedule" && triage && result && (
          <div>
            <p className="eyebrow">Step 2 of 4 · Your triage result</p>
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
                  <span className="badge badge-normal">We’ll assess on-site</span>
                )}
              </div>
              <div
                className="muted"
                style={{ fontSize: "0.85rem", marginTop: 6, marginBottom: 12 }}
              >
                Estimated ~{triage.estimatedDurationMin} min on-site ·{" "}
                {result.submission.input.room},{" "}
                {FLOORS.find((f) => f.id === result.submission.input.floor)
                  ?.label ?? result.submission.input.floor}
                {result.submission.photoCount
                  ? ` · ${result.submission.photoCount} photo(s) attached`
                  : ""}
              </div>

              <p style={{ marginTop: 0 }}>{triage.summary}</p>

              {result.submission.input.additionalRequests && (
                <div className="alert alert-info" style={{ marginTop: 12 }}>
                  <strong>Also while we&rsquo;re there</strong>
                  <p style={{ margin: "4px 0 0" }}>
                    {result.submission.input.additionalRequests}
                  </p>
                </div>
              )}

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
              Choose an open window. The visit fee is{" "}
              <strong>{formatMoney(DAY_FEE_CENTS)}</strong> for windows starting
              between 8:00am and 4:00pm, and{" "}
              <strong>{formatMoney(EVENING_FEE_CENTS)}</strong> from 4:00pm to
              9:00pm.
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
                        <div className="slot-price">
                          {formatMoney(s.fee.amountCents)}
                          {s.fee.tier === "evening" && (
                            <span className="slot-tier">evening</span>
                          )}
                        </div>
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
                onClick={holdSlotAndPay}
                disabled={!chosenSlot || holding}
              >
                {holding ? (
                  <>
                    <span className="spin" /> Holding your slot…
                  </>
                ) : chosenSlotObj ? (
                  `Continue to payment · ${formatMoney(chosenSlotObj.fee.amountCents)} →`
                ) : (
                  "Continue to payment →"
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

        {/* STEP 3 — PAYMENT */}
        {step === "payment" && result && heldSlot && (
          <form onSubmit={payAndConfirm}>
            <p className="eyebrow">Step 3 of 4 · Payment</p>
            <h2 className="section-title">Pay your visit fee</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              This covers the trip and the on-site diagnosis. Parts and any
              repair labor are quoted by your technician before work starts.
            </p>

            <div className="card pay-summary" style={{ marginTop: 16 }}>
              <div className="pay-line">
                <span>
                  <strong>{heldSlot.fee.label}</strong>
                  <br />
                  <span className="muted">
                    {new Date(heldSlot.start).toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}{" "}
                    · {heldSlot.windowLabel}
                  </span>
                </span>
                <span className="pay-amount">
                  {formatMoney(heldSlot.fee.amountCents)}
                </span>
              </div>
              <p className="hint" style={{ margin: "10px 0 0" }}>
                {heldSlot.fee.note}
              </p>
              <div className="pay-total">
                <span>Due today</span>
                <span>{formatMoney(heldSlot.fee.amountCents)}</span>
              </div>
            </div>

            <div className="card" style={{ padding: 22, marginTop: 16 }}>
              <div className="form-field">
                <label htmlFor="cc-name">Name on card</label>
                <input
                  id="cc-name"
                  autoComplete="cc-name"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder="Jane Doe"
                />
                {cardErrors.name && (
                  <div className="field-error">{cardErrors.name}</div>
                )}
              </div>

              <div className="form-field">
                <label htmlFor="cc-number">
                  Card number{" "}
                  {cardBrand !== "unknown" && (
                    <span className="hint">— {brandLabel(cardBrand)}</span>
                  )}
                </label>
                <input
                  id="cc-number"
                  autoComplete="cc-number"
                  inputMode="numeric"
                  value={formatCardNumber(cardNumber)}
                  onChange={(e) => setCardNumber(digitsOnly(e.target.value))}
                  placeholder="4242 4242 4242 4242"
                />
                {cardErrors.number && (
                  <div className="field-error">{cardErrors.number}</div>
                )}
              </div>

              <div className="grid cols-3 pay-grid">
                <div className="form-field">
                  <label htmlFor="cc-exp">Expiry</label>
                  <input
                    id="cc-exp"
                    autoComplete="cc-exp"
                    inputMode="numeric"
                    value={cardExpiry}
                    onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                    placeholder="MM/YY"
                  />
                  {cardErrors.expiry && (
                    <div className="field-error">{cardErrors.expiry}</div>
                  )}
                </div>
                <div className="form-field">
                  <label htmlFor="cc-cvc">Security code</label>
                  <input
                    id="cc-cvc"
                    autoComplete="cc-csc"
                    inputMode="numeric"
                    value={cardCvc}
                    onChange={(e) =>
                      setCardCvc(e.target.value.replace(/\D+/g, "").slice(0, 4))
                    }
                    placeholder="123"
                  />
                  {cardErrors.cvc && (
                    <div className="field-error">{cardErrors.cvc}</div>
                  )}
                </div>
                <div className="form-field">
                  <label htmlFor="cc-zip">Billing ZIP</label>
                  <input
                    id="cc-zip"
                    autoComplete="postal-code"
                    inputMode="numeric"
                    value={cardZip}
                    onChange={(e) => setCardZip(e.target.value.slice(0, 12))}
                    placeholder="46383"
                  />
                  {cardErrors.postalCode && (
                    <div className="field-error">{cardErrors.postalCode}</div>
                  )}
                </div>
              </div>

              <p className="pay-note">
                🔒 Your card number is checked in your browser and sent straight
                to our payment processor — Early Bird stores only the brand and
                last four digits for your receipt.
              </p>
            </div>

            <div className="form-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" disabled={paying}>
                {paying ? (
                  <>
                    <span className="spin" /> Processing…
                  </>
                ) : (
                  `Pay ${formatMoney(heldSlot.fee.amountCents)} & confirm →`
                )}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setStep("schedule")}
              >
                ← Change time
              </button>
            </div>
          </form>
        )}

        {/* STEP 4 — DONE */}
        {step === "done" && result && (
          <div>
            <p className="eyebrow">Step 4 of 4 · Confirmed</p>
            <h2 className="section-title">You’re booked. 🌅</h2>
            <div className="card" style={{ padding: 24, marginTop: 12 }}>
              <div className="alert alert-ok" style={{ marginBottom: 16 }}>
                A technician is scheduled. A confirmation will be sent to{" "}
                <strong>{result.submission.input.email}</strong>.
              </div>
              {heldSlot && (
                <p style={{ marginTop: 0 }}>
                  <strong>When:</strong>{" "}
                  {new Date(heldSlot.start).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}{" "}
                  · {heldSlot.windowLabel}
                </p>
              )}
              <p>
                <strong>Where:</strong> {result.submission.input.address} —{" "}
                {result.submission.input.room},{" "}
                {FLOORS.find((f) => f.id === result.submission.input.floor)
                  ?.label ?? result.submission.input.floor}
              </p>
              <p>
                <strong>Issue:</strong> {result.submission.triage.categoryLabel}{" "}
                · <UrgencyBadge urgency={result.submission.triage.urgency} />
              </p>
              {receipt && (
                <p>
                  <strong>Paid:</strong> {formatMoney(receipt.amountCents)} visit
                  fee · {brandLabel(receipt.cardBrand as CardBrand)} ending{" "}
                  {receipt.cardLast4}
                </p>
              )}
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Reference: {result.submission.id}
              </p>
            </div>

            {/* Live tracker — fills in the moment a technician accepts. */}
            <h3 style={{ marginTop: 28, marginBottom: 8 }}>
              Where’s my tech?
            </h3>
            <TechTracker submissionId={result.submission.id} compact />
            {trackUrl && (
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Bookmark this link to check back any time:{" "}
                <Link href={`/track/${result.submission.id}`}>{trackUrl}</Link>
              </p>
            )}

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
