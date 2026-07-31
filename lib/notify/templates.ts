import type { Submission, Slot } from "@/lib/types";
import type { EmailMessage } from "./email";

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

/** HTML block for the state licensing advisory, when one applies. */
function licensingNoteHtml(submission: Submission): string {
  const lic = submission.licensing;
  if (!lic || !lic.requiresLicensedPro) return "";
  const items = lic.trades
    .filter((t) => t.requiresLicensedPro)
    .map((t) => `<li style="margin:2px 0;">${escapeHtml(t.message)}</li>`)
    .join("");
  return `<div style="margin-top:12px;padding:12px;border-radius:9px;background:#fdf3e2;color:#7c4a03;">
    <strong>Licensing in ${escapeHtml(lic.stateName)}</strong>
    <ul style="margin:6px 0 0;padding-left:18px;">${items}</ul>
    <p style="margin:8px 0 0;font-size:12px;">You’re still booked — we’ll diagnose on-site and hand off any licensed work to a vetted partner. Not legal advice.</p>
  </div>`;
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

/** Plain-text version of the licensing advisory. */
function licensingNoteText(submission: Submission): string {
  const lic = submission.licensing;
  if (!lic || !lic.requiresLicensedPro) return "";
  const lines = lic.trades
    .filter((t) => t.requiresLicensedPro)
    .map((t) => `- ${t.message}`)
    .join("\n");
  return `\nLicensing in ${lic.stateName}:\n${lines}\nYou're still booked — we'll diagnose on-site and hand off licensed work to a vetted partner.\n`;
}

/** Booking confirmation sent to the customer. */
export function bookingConfirmationEmail(
  submission: Submission,
  slot: Slot,
): EmailMessage {
  const { input, triage } = submission;
  const when = formatWhen(slot);
  const scopeNote = triage.withinNonLicensedScope
    ? ""
    : `<div style="margin-top:12px;padding:12px;border-radius:9px;background:#fdf3e2;color:#7c4a03;">Heads up: part of your request may need a licensed professional. Our technician will assess on-site and advise.</div>`;

  const html = layout(
    "You’re booked — see you soon! 🌅",
    `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(input.name)}, your on-site visit is confirmed.</p>
    ${row("When", when)}
    ${row("Where", escapeHtml(input.address))}
    ${row("Issue", `${escapeHtml(triage.categoryLabel)} (${triage.urgency})`)}
    ${row("Estimated on-site time", `~${triage.estimatedDurationMin} min`)}
    ${scopeNote}
    ${issueNoteHtml(submission)}
    ${licensingNoteHtml(submission)}
    <p style="margin:16px 0 0;color:#46586b;font-size:13px;">Reference: ${submission.id}</p>
    <p style="margin:8px 0 0;color:#46586b;font-size:13px;">Need to change or cancel? Just reply to this email.</p>
  `,
  );

  const text = `Hi ${input.name}, your Early Bird visit is confirmed.

When: ${when}
Where: ${input.address}
Issue: ${triage.categoryLabel} (${triage.urgency})
Estimated on-site time: ~${triage.estimatedDurationMin} min
${triage.withinNonLicensedScope ? "" : "\nNote: part of your request may need a licensed professional; our technician will assess on-site.\n"}${issueNoteText(submission)}${licensingNoteText(submission)}
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
    ${row("Category / urgency", `${escapeHtml(triage.categoryLabel)} / ${triage.urgency}`)}
    ${row("In non-licensed scope", triage.withinNonLicensedScope ? "yes" : "NO — needs licensed pro")}
    ${row("Safety/scope flags", escapeHtml(flags))}
    ${row("Description", escapeHtml(input.description))}
    <p style="margin:12px 0 0;color:#46586b;font-size:13px;">Submission ${submission.id}</p>
  `,
  );

  const text = `New Early Bird booking

When: ${when}
Customer: ${input.name} — ${input.email} — ${input.phone}
Address: ${input.address}
Category/urgency: ${triage.categoryLabel} / ${triage.urgency}
In non-licensed scope: ${triage.withinNonLicensedScope ? "yes" : "NO — needs licensed pro"}
Safety/scope flags: ${flags}
Description: ${input.description}
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
export function technicianAssignedEmail(submission: Submission): EmailMessage {
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
    ${row("Where", escapeHtml(input.address))}
    <p style="margin:16px 0 0;color:#46586b;font-size:13px;">Reference: ${submission.id}</p>
  `,
  );

  const text = `Hi ${input.name}, ${techName} has been assigned to your ${triage.categoryLabel} request and is ${etaLine}.

Technician: ${techName}
ETA: ${eta != null ? `~${eta} min (around ${arrival})` : "shortly"}
Where: ${input.address}
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
export function technicianAssignedSms(submission: Submission): string {
  const { assignment, triage } = submission;
  const techName = assignment?.techName ?? "A technician";
  const eta = assignment?.etaMinutes ?? null;
  const arrival = formatArrival(assignment?.estimatedArrival ?? null);
  const etaPart =
    eta != null ? `ETA ~${eta} min (around ${arrival})` : "on the way now";
  return `Early Bird: ${techName} has been assigned to your ${triage.categoryLabel} request. ${etaPart}. Ref ${submission.id.slice(0, 8)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
