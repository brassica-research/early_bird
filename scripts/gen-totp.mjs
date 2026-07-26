#!/usr/bin/env node
// Generate a TOTP secret for the admin second factor (or any account).
//
//   node scripts/gen-totp.mjs [label]
//
// Set the printed secret as ADMIN_TOTP_SECRET, then add the account to your
// authenticator app using the otpauth URL (paste it into a QR generator, or
// enter the secret manually).

import { randomBytes } from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const label = process.argv[2] || "admin@earlybird";
const issuer = "Early Bird";
const secret = base32Encode(randomBytes(20));
const params = new URLSearchParams({
  secret, issuer, algorithm: "SHA1", digits: "6", period: "30",
});
const url = `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params}`;

console.log("\nTOTP secret (set as ADMIN_TOTP_SECRET):\n");
console.log("  " + secret + "\n");
console.log("Enroll in your authenticator app with this otpauth URL");
console.log("(paste into any QR-code generator, or add the secret manually):\n");
console.log("  " + url + "\n");
