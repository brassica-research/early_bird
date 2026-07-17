// ---------------------------------------------------------------------------
// Pluggable email sender.
//
// Provider is chosen by env, behind one `sendEmail` function so callers never
// know which service is used:
//   - RESEND_API_KEY set -> send via Resend's HTTP API (no SDK dependency).
//   - otherwise           -> "console" transport: log the message and succeed,
//                            so the app works end-to-end in dev with no config.
//
// To switch providers (SendGrid, Postmark, SES, SMTP), implement another branch
// here — nothing else changes.
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional override of the default from address. */
  from?: string;
}

export interface SendResult {
  delivered: boolean;
  provider: "resend" | "console";
  id?: string;
  error?: string;
}

function defaultFrom(): string {
  return process.env.EMAIL_FROM || "Early Bird <onboarding@resend.dev>";
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = msg.from || defaultFrom();

  if (!apiKey) {
    // Dev/console transport — visible in server logs, never throws.
    console.log(
      `[email:console] to=${msg.to} subject="${msg.subject}"\n${msg.text}`,
    );
    return { delivered: false, provider: "console" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email:resend] failed (${res.status}): ${detail}`);
      return {
        delivered: false,
        provider: "resend",
        error: `Resend ${res.status}`,
      };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { delivered: true, provider: "resend", id: data.id };
  } catch (err) {
    console.error("[email:resend] error:", err);
    return {
      delivered: false,
      provider: "resend",
      error: err instanceof Error ? err.message : "send failed",
    };
  }
}
