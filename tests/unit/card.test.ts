import { describe, it, expect } from "vitest";
import {
  detectBrand,
  formatCardNumber,
  formatExpiry,
  isExpired,
  luhnValid,
  parseExpiry,
  validateCardForm,
} from "@/lib/card";

describe("card brand detection", () => {
  it("recognizes the major networks", () => {
    expect(detectBrand("4242424242424242")).toBe("visa");
    expect(detectBrand("5555555555554444")).toBe("mastercard");
    expect(detectBrand("2223003122003222")).toBe("mastercard");
    expect(detectBrand("378282246310005")).toBe("amex");
    expect(detectBrand("6011111111111117")).toBe("discover");
    expect(detectBrand("")).toBe("unknown");
  });
});

describe("luhn", () => {
  it("accepts valid numbers and rejects a transposed digit", () => {
    expect(luhnValid("4242 4242 4242 4242")).toBe(true);
    expect(luhnValid("4242424242424243")).toBe(false);
    expect(luhnValid("4242")).toBe(false);
  });
});

describe("formatting", () => {
  it("groups 4-4-4-4, and 4-6-5 for Amex", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005");
  });

  it("inserts the expiry slash as you type", () => {
    expect(formatExpiry("1")).toBe("1");
    expect(formatExpiry("12")).toBe("12");
    expect(formatExpiry("1226")).toBe("12/26");
  });
});

describe("expiry", () => {
  it("expands a two-digit year", () => {
    expect(parseExpiry("12/26")).toEqual({ month: 12, year: 2026 });
    expect(parseExpiry("01/2030")).toEqual({ month: 1, year: 2030 });
  });

  it("rejects nonsense", () => {
    expect(parseExpiry("13/26")).toBeNull();
    expect(parseExpiry("abc")).toBeNull();
  });

  it("treats a card as good through the end of its expiry month", () => {
    const inMonth = new Date(2026, 11, 20);
    expect(isExpired({ month: 12, year: 2026 }, inMonth)).toBe(false);
    expect(isExpired({ month: 11, year: 2026 }, inMonth)).toBe(true);
  });
});

describe("validateCardForm", () => {
  const now = new Date(2026, 0, 15);
  const good = {
    name: "Pat Client",
    number: "4242424242424242",
    expiry: "12/28",
    cvc: "123",
    postalCode: "46383",
  };

  it("passes a well-formed card", () => {
    expect(validateCardForm(good, now)).toEqual({});
  });

  it("flags each bad field", () => {
    const errors = validateCardForm(
      { name: "", number: "1234", expiry: "13/20", cvc: "1", postalCode: "" },
      now,
    );
    expect(Object.keys(errors).sort()).toEqual([
      "cvc",
      "expiry",
      "name",
      "number",
      "postalCode",
    ]);
  });

  it("wants four CVC digits on an Amex", () => {
    expect(
      validateCardForm({ ...good, number: "378282246310005", cvc: "123" }, now).cvc,
    ).toBeTruthy();
    expect(
      validateCardForm({ ...good, number: "378282246310005", cvc: "1234" }, now).cvc,
    ).toBeUndefined();
  });
});
