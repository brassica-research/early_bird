import { describe, it, expect } from "vitest";
import { POST as intakePOST } from "@/app/api/intake/route";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/intake", () => {
  it("creates a queued submission for the dispatch pipeline", async () => {
    const res = await intakePOST(
      jsonReq({
        name: "Pat Client",
        email: "pat@home.com",
        phone: "5551239876",
        address: "500 Oak St, Springfield IL",
        affectedServices: ["Leaky faucet"],
        description: "kitchen faucet leaking steadily",
        clientUrgency: "high",
        smsOptIn: true,
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.submission.dispatchStatus).toBe("queued");
    expect(data.submission.triage.category).toBe("plumbing");
    expect(data.submission.input.clientUrgency).toBe("high");
    expect(Array.isArray(data.availability)).toBe(true);
    // Issue Matrix: a dripping faucet is licensed (pressurized supply) work.
    expect(data.submission.issueAssessment?.scope).toBe("out_of_scope");
    // Licensing advisory: Illinois state-licenses plumbing.
    expect(data.submission.licensing?.stateCode).toBe("IL");
  });

  it("flags a safety hard-stop issue on the submission", async () => {
    const res = await intakePOST(
      jsonReq({
        name: "Sam Client",
        email: "sam@home.com",
        phone: "5551110000",
        address: "12 Birch Rd, Valparaiso IN",
        affectedServices: ["Microwave"],
        description: "the microwave stopped heating food",
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.submission.issueAssessment?.hardStop).toBe(true);
    expect(data.submission.issueAssessment?.requiresLicensedPro).toBe(true);
  });

  it("rejects invalid input with 400", async () => {
    const res = await intakePOST(jsonReq({ name: "", email: "nope", phone: "", address: "", description: "" }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-JSON body", async () => {
    const res = await intakePOST(
      new Request("http://localhost/api/intake", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});
