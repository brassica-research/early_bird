// ---------------------------------------------------------------------------
// Pluggable SMS sender.
//
// Provider chosen by env, behind one `sendSms` function:
//   - TWILIO_* set -> send via Twilio's REST API (no SDK dependency).
//   - otherwise    -> "console" transport: log and succeed, so the flow works
//                     in dev with no config.
//
// Only used when a customer opts in to text notifications.
// ---------------------------------------------------------------------------

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsResult {
  delivered: boolean;
  provider: "twilio" | "console";
  id?: string;
  error?: string;
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM,
  );
}

export async function sendSms(msg: SmsMessage): Promise<SmsResult> {
  if (!twilioConfigured()) {
    console.log(`[sms:console] to=${msg.to} body="${msg.body}"`);
    return { delivered: false, provider: "console" };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const token = process.env.TWILIO_AUTH_TOKEN as string;
  const from = process.env.TWILIO_FROM as string;

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: msg.to,
          From: from,
          Body: msg.body,
        }),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[sms:twilio] failed (${res.status}): ${detail}`);
      return { delivered: false, provider: "twilio", error: `Twilio ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    return { delivered: true, provider: "twilio", id: data.sid };
  } catch (err) {
    console.error("[sms:twilio] error:", err);
    return {
      delivered: false,
      provider: "twilio",
      error: err instanceof Error ? err.message : "send failed",
    };
  }
}
