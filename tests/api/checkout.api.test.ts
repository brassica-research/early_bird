import { describe, it, expect } from "vitest";
import { POST as intakePOST } from "@/app/api/intake/route";
import { POST as bookPOST } from "@/app/api/book/route";
import { POST as checkoutPOST } from "@/app/api/checkout/route";
import { GET as trackGET } from "@/app/api/track/[id]/route";
import { getInitializedStore } from "@/lib/store";
import { DAY_FEE_CENTS, EVENING_FEE_CENTS } from "@/lib/pricing";
import type { PricedSlot } from "@/lib/pricing";

function jsonReq(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CARD = {
  brand: "visa",
  last4: "4242",
  expMonth: 12,
  expYear: new Date().getFullYear() + 3,
  name: "Pat Client",
  postalCode: "46383",
};

/** Run an intake and return the submission id plus priced availability. */
async function newIntake(overrides: Record<string, unknown> = {}) {
  const res = await intakePOST(
    jsonReq("/api/intake", {
      name: "Pat Client",
      email: "pat@home.com",
      phone: "5551239876",
      address: "500 Oak St, Springfield IL",
      affectedServices: ["Faucet — Drips when shut off"],
      room: "Primary bathroom",
      floor: "second",
      description: "the bathroom faucet drips all night",
      ...overrides,
    }),
  );
  expect(res.status).toBe(201);
  const data = await res.json();
  return {
    id: data.submission.id as string,
    submission: data.submission,
    availability: data.availability as PricedSlot[],
  };
}

describe("intake — room, floor and photos", () => {
  it("stores the room and floor on the submission", async () => {
    const { submission } = await newIntake();
    expect(submission.input.room).toBe("Primary bathroom");
    expect(submission.input.floor).toBe("second");
  });

  it("rejects a missing room or an unknown floor", async () => {
    const noRoom = await intakePOST(
      jsonReq("/api/intake", {
        name: "Pat",
        email: "pat@home.com",
        phone: "5551239876",
        address: "500 Oak St, Springfield IL",
        floor: "ground",
        description: "faucet drips constantly",
      }),
    );
    expect(noRoom.status).toBe(400);

    const badFloor = await intakePOST(
      jsonReq("/api/intake", {
        name: "Pat",
        email: "pat@home.com",
        phone: "5551239876",
        address: "500 Oak St, Springfield IL",
        room: "Kitchen",
        floor: "penthouse",
        description: "faucet drips constantly",
      }),
    );
    expect(badFloor.status).toBe(400);
  });

  it("stores attached photos out-of-band and counts them on the submission", async () => {
    // 1x1 transparent PNG.
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const { id, submission } = await newIntake({
      photos: [
        { name: "leak.png", contentType: "image/png", dataUrl: png, width: 1, height: 1 },
      ],
    });
    expect(submission.photoCount).toBe(1);
    // The bytes are NOT on the submission — they live in the photo store.
    expect(JSON.stringify(submission)).not.toContain("iVBORw0KGgo");

    const store = await getInitializedStore();
    const photos = await store.listPhotosForSubmission(id);
    expect(photos).toHaveLength(1);
    expect(photos[0].contentType).toBe("image/png");
    expect(photos[0].bytes).toBeGreaterThan(0);
  });

  it("rejects a non-image data URL", async () => {
    const res = await intakePOST(
      jsonReq("/api/intake", {
        name: "Pat",
        email: "pat@home.com",
        phone: "5551239876",
        address: "500 Oak St, Springfield IL",
        room: "Kitchen",
        floor: "ground",
        description: "faucet drips constantly",
        photos: [
          {
            name: "evil.svg",
            contentType: "image/png",
            dataUrl: "data:text/html;base64,PHNjcmlwdD4=",
            width: 1,
            height: 1,
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("availability pricing", () => {
  it("prices every offered window by its start hour", async () => {
    const { availability } = await newIntake();
    expect(availability.length).toBeGreaterThan(0);
    for (const slot of availability) {
      const hour = new Date(slot.start).getHours();
      const expected =
        hour >= 16 && hour < 21 ? EVENING_FEE_CENTS : DAY_FEE_CENTS;
      expect(slot.fee.amountCents).toBe(expected);
    }
  });
});

describe("checkout", () => {
  it("holds a slot, charges the window's fee, and confirms the booking", async () => {
    const { id, availability } = await newIntake();
    const slot = availability[0];

    const hold = await bookPOST(
      jsonReq("/api/book", { submissionId: id, slotId: slot.id, hold: true }),
    );
    expect(hold.status).toBe(200);
    const held = await hold.json();
    // A hold reserves the slot but does NOT confirm it.
    expect(held.held).toBe(true);
    expect(held.submission.bookingStatus).toBe("requested");
    expect(held.notified).toBe(false);

    const paid = await checkoutPOST(
      jsonReq("/api/checkout", { submissionId: id, card: CARD }),
    );
    expect(paid.status).toBe(200);
    const receipt = await paid.json();
    expect(receipt.submission.bookingStatus).toBe("confirmed");
    expect(receipt.visitFee.amountCents).toBe(slot.fee.amountCents);
    expect(receipt.visitFee.tier).toBe(slot.fee.tier);
    expect(receipt.visitFee.cardLast4).toBe("4242");
    expect(receipt.charge.amountCents).toBe(slot.fee.amountCents);
    expect(receipt.trackUrl).toContain(`/track/${id}`);

    // The charge is on the ledger for this job.
    const store = await getInitializedStore();
    const charges = await store.listChargesForSubmission(id);
    expect(charges).toHaveLength(1);
    expect(charges[0].description).toContain("visit fee");
  });

  it("is idempotent — a second submit doesn't charge twice", async () => {
    const { id, availability } = await newIntake();
    await bookPOST(
      jsonReq("/api/book", {
        submissionId: id,
        slotId: availability[0].id,
        hold: true,
      }),
    );
    await checkoutPOST(jsonReq("/api/checkout", { submissionId: id, card: CARD }));
    const again = await checkoutPOST(
      jsonReq("/api/checkout", { submissionId: id, card: CARD }),
    );
    expect(again.status).toBe(200);
    expect((await again.json()).alreadyPaid).toBe(true);

    const store = await getInitializedStore();
    expect(await store.listChargesForSubmission(id)).toHaveLength(1);
  });

  it("refuses to charge before a window is held", async () => {
    const { id } = await newIntake();
    const res = await checkoutPOST(
      jsonReq("/api/checkout", { submissionId: id, card: CARD }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects an expired card", async () => {
    const { id, availability } = await newIntake();
    await bookPOST(
      jsonReq("/api/book", {
        submissionId: id,
        slotId: availability[0].id,
        hold: true,
      }),
    );
    const res = await checkoutPOST(
      jsonReq("/api/checkout", {
        submissionId: id,
        card: { ...CARD, expMonth: 1, expYear: 2020 },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("never accepts an amount from the client", async () => {
    const { id, availability } = await newIntake();
    const slot = availability[0];
    await bookPOST(
      jsonReq("/api/book", { submissionId: id, slotId: slot.id, hold: true }),
    );
    const res = await checkoutPOST(
      jsonReq("/api/checkout", {
        submissionId: id,
        card: CARD,
        amountCents: 1,
        visitFee: { amountCents: 1 },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).visitFee.amountCents).toBe(slot.fee.amountCents);
  });
});

describe("GET /api/track/:id", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("reports the requested stage for a job nobody has claimed", async () => {
    const { id } = await newIntake();
    const res = await trackGET(new Request(`http://localhost/api/track/${id}`), ctx(id));
    expect(res.status).toBe(200);
    const { track } = await res.json();
    expect(track.stage).toBe("requested");
    expect(track.tech).toBeNull();
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("404s an unknown reference", async () => {
    const res = await trackGET(
      new Request("http://localhost/api/track/nope"),
      ctx("nope"),
    );
    expect(res.status).toBe(404);
  });

  it("publishes no contact details", async () => {
    const { id } = await newIntake();
    const res = await trackGET(new Request(`http://localhost/api/track/${id}`), ctx(id));
    const body = await res.text();
    expect(body).not.toContain("pat@home.com");
    expect(body).not.toContain("5551239876");
    expect(body).not.toContain("500 Oak St");
  });
});
