import { describe, it, expect } from "vitest";
import { ManualProvider } from "@/lib/payments/manualProvider";

describe("manual payment provider", () => {
  it("records a charge as pending without a processor ref", async () => {
    const provider = new ManualProvider();
    expect(provider.name).toBe("manual");
    const res = await provider.createCharge({
      amountCents: 12500,
      currency: "usd",
      description: "faucet cartridge + labor",
      submissionId: "sub-1",
    });
    expect(res.status).toBe("pending");
    expect(res.providerRef).toBeNull();
  });
});
