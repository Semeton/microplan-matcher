# Microplan Matcher

Turns a campaign microplan into a filled DIGIT HCM unified template, entirely in the browser.

1. **Files** – the unified template downloaded from the HCM console for the campaign (empty, or already holding users), plus the microplan (v4.1 HF-level microplan, DIGIT Master Data template, MC-style master data with a user list, or just a user list).
2. **Check columns** – boundary levels, target columns and user columns are detected automatically; edit only if something is wrong.
3. **Resolve names** – each distinct boundary name is matched level by level against the template's boundary codes. Only names that need a person are shown; choices are remembered in the browser and can be exported/imported as JSON for the next cycle.
4. **Export** – pre-ingestion checks shown with the rows they affect. Fix a problem by editing the row (phone, name, target, boundary name — a boundary rename applies to every row that uses it), removing it, or adding a missing OIC/CDD per facility. Phones already used by people in the template are flagged. Every edit is logged with undo, and a corrected microplan can be downloaded alongside the filled template and a match report. Facilities in the microplan's area (or all, or none) are set to Active.

**Add users** (header switch) adds people to a template, including one that already has users: type them, paste rows from Excel (name, phone, role, boundary) or upload a list. Boundaries are picked from a searchable list (“Name · Parent · Grandparent (Level)”) or matched from pasted names; roles come from the template's own role list. New rows go after the existing ones, and phones already in the template or repeated in the new list are blocked.

**Demo users** needs only the template: pick roles, the boundary level each role sits at and how many, and it writes clearly-labelled test users spread across different branches of the hierarchy — plus users holding several roles (split to fit the template's role columns) — with sequential phone numbers, and a CSV list for the demo team.

What is written: target cells, new user rows and facility status. Everything else stays as the console made it — hidden row 1, hidden `*_HELPER` and boundary-code formula columns (with cached results filled in), cascading boundary dropdowns, role/employment dropdowns, defined names, hidden sheets and sheet protection.

Nothing is uploaded: files are parsed client-side with SheetJS and ExcelJS.

## How it works

| File | Role |
|---|---|
| `engine.js` | Template parsing (boundary tree from `path#…` → code rows), microplan sheet detection, name normalisation and scoring, level-by-level matching, target aggregation/splitting, phone normalisation, validation rules |
| `writer.js` | Fills the console template in place with ExcelJS: finds columns by technical key (row 1), resolves the role list from the sheet's data validations, keeps formulas and sets their cached results, appends after existing users (cloning row formatting past the prepared range), normalises data-validation ranges, and patches the package around two ExcelJS gaps (CDATA dropdown formulas, `sheet="true"` protection) |
| `test/verify_template.js` | Independent check of a filled template against its original: structure, dropdown cascade per user row, codes, roles, DV ranges |
| `src/app.html` | UI; `build.js` inlines the engine, writer and example data into `dist/index.html` |

Console conventions the code relies on (checked against Kambia LLIN, Bednet 2026 Sierra Leone, Bednet SWA and Bednet August 2026 templates):

- Row 1 of each data sheet holds technical keys (`HCM_ADMIN_CONSOLE_BOUNDARY_CODE`, level keys such as `ADMIN_KAMBIA_PHU`, `ITN_LGA`, `SIERRALEONE_VILLAGE`, `…_TARGET…`), row 2 the display labels. Level columns are the keys left of the boundary code.
- Two template generations are supported:
  - **Helper style** (ExcelJS-built): `<LEVEL>_HELPER` columns hold `INDEX/MATCH` formulas returning `H_` + SHA-256 of the codes of levels 0…*i*-1 joined with `#`; each level's dropdown is `INDIRECT(<helper>&"_LIST")`; the boundary code is a `VLOOKUP` formula. Some of these templates use codes as boundary names; the app shows a readable name derived from the code but writes the code.
  - **POI style** (newer): no helper columns; dropdowns are `INDIRECT("_hL"&MATCH(path, _h_SimpleLookup_h_!A:A, 0))`, the code is a plain value, the Boundary List sheet may be protected, and rows only exist where used (dropdowns are prepared to row 5,002 or 20,002). `HCM_ADMIN_CONSOLE____ROW_ID` is left blank on new rows.
- Phone format defaults from the template's country (Nigeria 11-digit, Sierra Leone 0 + 8 digits, otherwise digits as typed).
- Target sheets are any sheet with `HCM_ADMIN_CONSOLE_BOUNDARY_CODE` plus a `…TARGET…` column; values are written by boundary code.

Matching rules: names are compared after normalising facility types (PHC / PHCC / Primary Health Centre…, HP, HC, CHC, BHC), state prefixes (`ko `, `oy `…), Roman numerals and spacing. Numbers and directional or sibling markers (East/West, Upper/Lower, A/B) must agree. A match is accepted automatically at ≥ 0.90 with a clear margin over the runner-up; otherwise it goes to review.

## Develop

```bash
npm install
npm run build     # → dist/index.html
npm test          # drives the built page in jsdom against the bundled Akko example
```

Pushing to `main` builds, tests and publishes `dist/` to the `gh-pages` branch.

## Data

The bundled example is the Akko LGA (Gombe) boundary hierarchy with targets only — no personal data — built into a helper-style template like the console's. Users in the example are fictional placeholders. Real templates and microplans used for verification stay out of the repository.
