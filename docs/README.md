# Early Bird — reference docs

## Issues Matrix (fixable vs. licensed-pro)

- **`State_Licensing_and_Issues_Matrix.xlsx`** — the workbook whose **Issues
  Matrix** tab ranks 200 common home issues and classifies each by whether an
  unlicensed Early Bird technician can handle it (**Can Fix?**: Yes / Partial /
  Grey Zone / No / Emergency Only), with license requirements, risk, and
  hard-stop notes. Scope is **Indiana / Porter County**; it's a planning tool,
  **not legal advice**.
- **`issues-matrix.json`** — normalized extract used to generate the typed
  dataset. Regenerate with `npm run gen:issues` (writes `lib/issues-matrix-data.ts`).

### How it's wired into the app

`lib/issues.ts` matches what the customer describes + selects on intake to the
closest catalog issue (document-frequency weighting + title bigrams; synonyms
expand the query only) and returns a scope verdict:

| verdict | meaning | intake advisory |
| --- | --- | --- |
| `in_scope` | defensible unlicensed work | green "we can handle this" |
| `partial` / `grey` | part in scope / unsettled | amber "we'll take a look / diagnose" |
| `out_of_scope` | licensed work | amber "we'll diagnose, then refer" |
| `emergency` / hard-stop | safety hard-stop | red emergency banner |

- The verdict appears **live** on the intake form (alongside the safety +
  licensing banners), persists on the submission (`submission.issueAssessment`),
  shows on the triage-result screen and in the confirmation email, and surfaces
  as a **Hard stop / Refer** badge on the admin dispatch board.
- Safety hard-stops (gas, microwave HV capacitor, garage-door springs,
  refrigerant) match at a lower confidence bar — over-flagging is the safe error.

## State licensing

- **`State_Licensing_Comparison.pdf`** / **`State_Licensing_Comparison.xlsx`** —
  the source 50-state licensing research (compiled July 2026 from public
  sources; **not legal advice**). The workbook's **Comparison** tab is the
  matrix of which trades (Plumbing / Electrical / HVAC) are licensed at the
  state vs. local level, the unlicensed dollar thresholds, written-contract
  laws, and an "Early Bird implication" rating per state.
- **`licensing-matrix.json`** — a normalized extract of the Comparison tab used
  to generate the app's typed dataset. Regenerate the dataset with
  `npm run gen:licensing` (writes `lib/licensing-data.ts`).

### How it's wired into the app

The intake form (`app/intake/page.tsx`) reads this data through
`lib/licensing.ts`:

- The customer picks their **State** (auto-detected from the address when
  possible). As soon as a regulated trade (plumbing / electrical / HVAC) is
  selected, a **live licensing advisory** appears — mirroring the emergency
  safety banner's "err toward disclosure" posture. It's **advisory only and
  never blocks a booking**.
- On submit, the server (`app/api/intake/route.ts`) recomputes the assessment
  for the triaged trade and persists it on the submission
  (`submission.licensing`).
- The admin **Dispatch board** shows a **"Licensed pro"** badge on any queued
  job whose state routes the work to a licensed partner, so the operator can
  route accordingly.

Appliances, basic repair, and internet/connectivity carry the lightest
regulatory burden nationwide and are treated as having no state-trade gate.
Per the workbook's standing policy, electrical, plumbing, and HVAC are
"confirm-before-offer" in every state.

> This mapping is operational guidance, **not legal advice**. Thresholds change
> and vary by city/county; several source cells are marked "verify". Confirm
> with each state board and local building department before launch.
