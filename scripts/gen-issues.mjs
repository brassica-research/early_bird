// Regenerate lib/issues-matrix-data.ts from docs/issues-matrix.json (the
// normalized extract of the "Issues Matrix" tab of the licensing workbook).
// Run: npm run gen:issues
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "docs/issues-matrix.json"), "utf8"));
const s = (v) => JSON.stringify(v);
const out = [];
out.push("// AUTO-GENERATED from docs/State_Licensing_and_Issues_Matrix.xlsx (Issues Matrix tab).");
out.push("// Do not edit by hand — regenerate with `npm run gen:issues`.");
out.push("// Indiana / Porter County scope; planning tool, not legal advice.");
out.push("");
out.push('import type { MatrixIssue } from "./issues";');
out.push("");
out.push("export const ISSUES_DATA: MatrixIssue[] = [");
for (const o of data) {
  out.push("  {");
  out.push(`    rank: ${o.rank}, category: ${s(o.category)}, issue: ${s(o.issue)},`);
  out.push(`    scope: ${s(o.scope)}, hardStop: ${o.hardStop}, license: ${s(o.license)},`);
  out.push(`    risk: ${s(o.risk)}, recurring: ${o.recurring}, likelihood: ${o.likelihood},`);
  out.push(`    symptom: ${s(o.symptom)}, notes: ${s(o.notes)},`);
  out.push("  },");
}
out.push("];");
out.push("");
writeFileSync(join(root, "lib/issues-matrix-data.ts"), out.join("\n"));
console.log(`Wrote lib/issues-matrix-data.ts (${data.length} issues).`);
