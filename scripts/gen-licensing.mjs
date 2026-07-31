// Regenerate lib/licensing-data.ts from docs/licensing-matrix.json (the
// normalized extract of docs/State_Licensing_Comparison.xlsx, "Comparison" tab).
// Run: npm run gen:licensing
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(
  readFileSync(join(root, "docs/licensing-matrix.json"), "utf8"),
);
const s = (v) => JSON.stringify(v);
const out = [];
out.push("// AUTO-GENERATED from docs/State_Licensing_Comparison.xlsx (Comparison tab).");
out.push("// Do not edit by hand — regenerate with `npm run gen:licensing`.");
out.push("// Source compiled July 2026 from public sources; not legal advice.");
out.push("");
out.push('import type { StateLicensing } from "./licensing";');
out.push("");
out.push("export const LICENSING_DATA: StateLicensing[] = [");
for (const row of data) {
  const t = row.trades;
  out.push("  {");
  out.push(`    code: ${s(row.code)}, name: ${s(row.name)}, implication: ${s(row.implication)},`);
  out.push(`    unlicensedThreshold: ${s(row.unlicensedThreshold)},`);
  out.push("    trades: {");
  for (const k of ["plumbing", "electrical", "hvac"]) {
    const c = t[k];
    out.push(`      ${k}: { reg: ${s(c.reg)}, exempt: ${c.exempt}, note: ${s(c.note)} },`);
  }
  out.push("    },");
  out.push(`    writtenContract: ${s(row.writtenContract)},`);
  out.push(`    notes: ${s(row.notes)},`);
  out.push("  },");
}
out.push("];");
out.push("");
writeFileSync(join(root, "lib/licensing-data.ts"), out.join("\n"));
console.log(`Wrote lib/licensing-data.ts (${data.length} states).`);
