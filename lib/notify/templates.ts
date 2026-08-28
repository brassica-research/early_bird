import type { Submission, Slot, VisitFeePayment } from "@/lib/types";
import type { EmailMessage } from "./email";
import { formatMoney } from "@/lib/pricing";
import { floorLabel } from "@/lib/rooms";

// ---------------------------------------------------------------------------
// Email templates. Kept as plain string builders (no template engine) with
// inline styles for broad email-client compatibility.
// ---------------------------------------------------------------------------

function formatWhen(slot: Slot): string {
  const d = new Date(slot.start);
  const date = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `${date} · ${slot.windowLabel}`;
}

function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f8fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2430;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="font-weight:800;font-size:20px;margin-bottom:16px;">🐦 Early Bird</div>
      <div style="background:#ffffff;border:1px solid #dce3ec;border-radius:14px;padding:24px;">
        <h1 style="font-size:20px;margin:0 0 12px;">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="color:#7c8aa0;font-size:12px;margin-top:16px;">
        Early Bird · On-site home diagnostics, troubleshooting &amp; repair
      </div>
    </div>
  </body>
</html>`;
}

function row(label: string, value: string): string {
  return `<p style="margin:6px 0;"><strong>${label}:</strong> ${value}</p>`;
}

/** HTML block for the issue-scope advisory, when the work isn't cleanly in scope. */
function issueNoteHtml(submission: Submission): string {
  const a = submission.issueAssessment;
  if (!a || a.scope === "in_scope") return "";
  const bg = a.hardStop ? "#fbe6e6" : "#fdf3e2";
  const fg = a.hardStop ? "#7a1f1f" : "#7c4a03";
  return `<div style="margin-top:12px;padding:12px;border-radius:9px;background:${bg};color:${fg};">
    <strong>${a.hardStop ? "Safety note" : "About this repair"}</strong>
    <p style="margin:6px 0 0;">${escapeHtml(a.message)}</p>
  </div>`;
}

/** Plain-text version of the issue-scope advisory. */
function issueNoteText(submission: Submission): string {
  const a = submission.issueAssessment;
  if (!a || a.scope === "in_scope") return "";
  return `\n${a.hardStop ? "Safety note" : "About this repair"}: ${a.message}\n`;
}

/** Extra bits the checkout flow attaches to a confirmation. */
export interface ConfirmationExtras {
  /** The visit fee that was collected, if checkout took payment. */
  visitFee?: VisitFeePayment | null;
  /** Absolute URL of the "Where's my tech?" tracker for this visit. */
  trackUrl?: string | null;
}

/** Booking confirmation sent to the customer. */
export function bookingConfirmationEmail(
  submission: Submission,
  slot: Slot,
  extras: ConfirmationExtras = {},
): EmailMessage {
  const { input, triage } = submission;
  const when = formatWhen(slot);
  const fee = extras.visitFee ?? submission.visitFee ?? null;
  const feeRowHtml = fee
    ? row(
        "Visit fee paid",
        `${formatMoney(fee.amountCents)} · ${escapeHtml(fee.cardBrand)} ending ${escapeHtml(fee.cardLast4)}`,
      )
    : "";
  const trackHtml = extras.trackUrl
    ? `<p style="margin:16px 0 0;">
        <a href="${escapeHtml(extras.trackUrl)}" style="display:inline-block;background:#ff8c42;color:#241400;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:9px;">Track your technician</a>
      </p>
      <p style="margin:8px 0 0;color:#46586b;font-size:13px;">Once a technician accepts your job you can follow their approximate location and arrival countdown here.</p>`
    : "";
  const scopeNote = triage.withinNonLicensedScope
    ? ""
    : `<div style="margin-top:12px;padding:12px;border-radius:9px;background:#fdf3e2;color:#7c4a03;">Our technician will assess your request on-site and advise on next steps.</div>`;

  const html = layout(
    "You’re booked — see you soon! 🌅",
    `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(input.name)}, your on-site visit is confirmed.</p>
    ${row("When", when)}
    ${row("Where", escapeHtml(input.address))}
    ${row("Room", `${escapeHtml(input.room)} · ${escapeHtml(floorLabel(input.floor))}`)}
    ${row("Issue", `${escapeHtml(triage.categoryLabel)} (${triage.urgency})`)}
    ${row("Estimated on-site time", `~${triage.estimatedDurationMin} min`)}
    ${
      input.additionalRequests
        ? row("Also while we're there", escapeHtml(input.additionalRequests))
        : ""
    }
    ${feeRowHtml}
    ${scopeNote}
    ${issueNoteHtml(submission)}
    ${trackHtml}
    <p style="margin:16px 0 0;color:#46586b;font-size:13px;">Reference: ${submission.id}</p>
    <p style="margin:8px 0 0;color:#46586b;font-size:13px;">Need to change or cancel? Just reply to this email.</p>
  `,
  );

  const text = `Hi ${input.name}, your Early Bird visit is confirmed.

When: ${when}
Where: ${input.address}
Room: ${input.room} · ${floorLabel(input.floor)}
Issue: ${triage.categoryLabel} (${triage.urgency})
Estimated on-site time: ~${triage.estimatedDurationMin} min${
    input.additionalRequests
      ? `\nAlso while we're there: ${input.additionalRequests}`
      : ""
  }${
    fee
      ? `\nVisit fee paid: ${formatMoney(fee.amountCents)} (${fee.cardBrand} ending ${fee.cardLast4})`
      : ""
  }
${triage.withinNonLicensedScope ? "" : "\nOur technician will assess your request on-site and advise on next steps.\n"}${issueNoteText(submission)}${
    extras.trackUrl
      ? `\nTrack your technician: ${extras.trackUrl}\n`
      : ""
  }
Reference: ${submission.id}
Need to change or cancel? Just reply to this email.`;

  return {
    to: input.email,
    subject: `Your Early Bird visit is confirmed — ${when}`,
    html,
    text,
  };
}

/** Internal notification to the ops inbox for a new booking. */
export function opsBookingNotification(
  submission: Submission,
  slot: Slot,
  to: string,
): EmailMessage {
  const { input, triage } = submission;
  const when = formatWhen(slot);
  const flags = triage.safetyFlags.length
    ? triage.safetyFlags.map((f) => f.message).join("; ")
    : "none";

  const html = layout(
    `New booking · ${triage.categoryLabel} (${triage.urgency})`,
    `
    ${row("When", when)}
    ${row("Customer", `${escapeHtml(input.name)} — ${escapeHtml(input.email)} — ${escapeHtml(input.phone)}`)}
    ${row("Address", escapeHtml(input.address))}
    ${row("Room / floor", `${escapeHtml(input.room)} · ${escapeHtml(floorLabel(input.floor))}`)}
    ${row("Photos attached", String(submission.photoCount ?? 0))}
    ${row("Category / urgency", `${escapeHtml(triage.categoryLabel)} / ${triage.urgency}`)}
    ${row("In non-licensed scope", triage.withinNonLicensedScope ? "yes" : "NO — needs licensed pro")}
    ${row("Safety/scope flags", escapeHtml(flags))}
    ${row("Description", escapeHtml(input.description))}
    ${
      input.additionalRequests
        ? row("Also while there", escapeHtml(input.additionalRequests))
        : ""
    }
    <p style="margin:12px 0 0;color:#46586b;font-size:13px;">Submission ${submission.id}</p>
  `,
  );

  const text = `New Early Bird booking

When: ${when}
Customer: ${input.name} — ${input.email} — ${input.phone}
Address: ${input.address}
Room/floor: ${input.room} · ${floorLabel(input.floor)}
Photos attached: ${submission.photoCount ?? 0}
Category/urgency: ${triage.categoryLabel} / ${triage.urgency}
In non-licensed scope: ${triage.withinNonLicensedScope ? "yes" : "NO — needs licensed pro"}
Safety/scope flags: ${flags}
Description: ${input.description}${
    input.additionalRequests
      ? `\nAlso while there: ${input.additionalRequests}`
      : ""
  }
Submission ${submission.id}`;

  return {
    to,
    subject: `New booking: ${triage.categoryLabel} (${triage.urgency}) — ${when}`,
    html,
    text,
  };
}

/** Format an estimated-arrival ISO time as a friendly clock time. */
function formatArrival(iso: string | null): string {
  if (!iso) return "shortly";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Customer email: a technician has been assigned and is on the way. */
export function technicianAssignedEmail(
  submission: Submission,
  trackUrl?: string | null,
): EmailMessage {
  const { input, triage, assignment } = submission;
  const techName = assignment?.techName ?? "A technician";
  const eta = assignment?.etaMinutes ?? null;
  const arrival = formatArrival(assignment?.estimatedArrival ?? null);
  const etaLine =
    eta != null
      ? `arriving in about ${eta} minutes (around ${arrival})`
      : "on the way";

  const html = layout(
    "A technician is on the way 🛻",
    `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(input.name)}, good news — <strong>${escapeHtml(
      techName,
    )}</strong> has been assigned to your ${escapeHtml(
      triage.categoryLabel,
    )} request and is ${etaLine}.</p>
    ${row("Technician", escapeHtml(techName))}
    ${row("ETA", eta != null ? `~${eta} min (around ${arrival})` : "shortly")}
    ${row("Where", `${escapeHtml(input.address)} — ${escapeHtml(input.room)}, ${escapeHtml(floorLabel(input.floor))}`)}
    ${
      trackUrl
        ? `<p style="margin:16px 0 0;">
        <a href="${escapeHtml(trackUrl)}" style="display:inline-block;background:#ff8c42;color:#241400;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:9px;">Where's my tech?</a>
      </p>
      <p style="margin:8px 0 0;color:#46586b;font-size:13px;">Follow their approximate location and a live arrival countdown.</p>`
        : ""
    }
    <p style="margin:16px 0 0;color:#46586b;font-size:13px;">Reference: ${submission.id}</p>
  `,
  );

  const text = `Hi ${input.name}, ${techName} has been assigned to your ${triage.categoryLabel} request and is ${etaLine}.

Technician: ${techName}
ETA: ${eta != null ? `~${eta} min (around ${arrival})` : "shortly"}
Where: ${input.address} — ${input.room}, ${floorLabel(input.floor)}${
    trackUrl ? `\nWhere's my tech? ${trackUrl}` : ""
  }
Reference: ${submission.id}`;

  return {
    to: input.email,
    subject: `${techName} is on the way — ETA ~${eta ?? "soon"} min`,
    html,
    text,
  };
}

/** Technician password-reset email with a single-use, time-limited link. */
export function passwordResetEmail(
  to: string,
  name: string,
  resetUrl: string,
  expiresMinutes: number,
): EmailMessage {
  const html = layout(
    "Reset your Early Bird password",
    `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(name || "there")}, we received a request to reset your technician password.</p>
    <p style="margin:0 0 16px;">
      <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#ff8c42;color:#241400;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:9px;">Choose a new password</a>
    </p>
    <p style="margin:0 0 8px;color:#46586b;font-size:13px;">This link expires in ${expiresMinutes} minutes and can be used once.</p>
    <p style="margin:0;color:#46586b;font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  `,
  );
  const text = `Hi ${name || "there"}, we received a request to reset your Early Bird technician password.

Choose a new password: ${resetUrl}

This link expires in ${expiresMinutes} minutes and can be used once. If you didn't request this, ignore this email.`;
  return { to, subject: "Reset your Early Bird password", html, text };
}

/** Customer SMS body for the same event (opt-in only). */
export function technicianAssignedSms(
  submission: Submission,
  trackUrl?: string | null,
): string {
  const { assignment, triage } = submission;
  const techName = assignment?.techName ?? "A technician";
  const eta = assignment?.etaMinutes ?? null;
  const arrival = formatArrival(assignment?.estimatedArrival ?? null);
  const etaPart =
    eta != null ? `ETA ~${eta} min (around ${arrival})` : "on the way now";
  const trackPart = trackUrl ? ` Track: ${trackUrl}` : "";
  return `Early Bird: ${techName} has been assigned to your ${triage.categoryLabel} request. ${etaPart}.${trackPart} Ref ${submission.id.slice(0, 8)}`;
}

/** Customer review-request email (sent manually from the technician side). */
export function reviewRequestEmail(submission: Submission): EmailMessage {
  const { input, triage, assignment } = submission;
  const withTech = assignment?.techName
    ? ` with ${escapeHtml(assignment.techName)}`
    : "";
  const reviewUrl = process.env.REVIEW_URL;
  const cta = reviewUrl
    ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#ff8c42;color:#241400;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:9px;">Leave a review</a></p>`
    : `<p style="margin:0 0 16px;">Just reply to this email with a few words about your experience.</p>`;
  const html = layout(
    "How did we do? ⭐",
    `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(input.name)}, thanks for choosing Early Bird for your ${escapeHtml(triage.categoryLabel)} visit${withTech}.</p>
    <p style="margin:0 0 12px;">We’d love your feedback — it helps us keep improving.</p>
    ${cta}
    <p style="margin:0;color:#46586b;font-size:13px;">Reference: ${submission.id}</p>
  `,
  );
  const text = `Hi ${input.name}, thanks for choosing Early Bird for your ${triage.categoryLabel} visit${assignment?.techName ? ` with ${assignment.techName}` : ""}.

We'd love your feedback.
${reviewUrl ? `Leave a review: ${reviewUrl}` : "Just reply to this email with a few words about your experience."}

Reference: ${submission.id}`;
  return { to: input.email, subject: "How did we do? — Early Bird", html, text };
}

/** Customer review-request SMS (opt-in only). */
export function reviewRequestSms(submission: Submission): string {
  const reviewUrl = process.env.REVIEW_URL;
  return `Early Bird: thanks for your visit! We'd love your feedback${
    reviewUrl ? `: ${reviewUrl}` : " — reply to this text"
  }. Ref ${submission.id.slice(0, 8)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
