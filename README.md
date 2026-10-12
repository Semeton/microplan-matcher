# Microplan Matcher

Turns a campaign microplan into a filled DIGIT HCM unified template, entirely in the browser.

1. **Files** – the unified template downloaded from the HCM console for the campaign, plus the microplan (v4.1 HF-level microplan, DIGIT Master Data template, or MC-style master data with a user list).
2. **Check columns** – boundary levels, target columns and user columns are detected automatically; edit only if something is wrong.
3. **Resolve names** – each distinct boundary name is matched level by level against the template's boundary codes. Only names that need a person are shown; choices are remembered in the browser and can be exported/imported as JSON for the next cycle.
4. **Export** – pre-ingestion checks, then the filled template (targets + user rows, with the console's hidden sheets, dropdowns and helper columns preserved) and a match report.

**Demo users** (header switch) needs only the template: pick roles, the boundary level each role sits at and how many, and it writes clearly-labelled test users spread across different branches of the hierarchy — plus optional users holding every role — with sequential phone numbers, and a CSV list for the demo team.

Nothing is uploaded: files are parsed client-side with SheetJS and ExcelJS.

## How it works

| File | Role |
|---|---|
| `engine.js` | Template parsing (boundary tree from `path#…` → code rows), microplan sheet detection, name normalisation and scoring, level-by-level matching, target aggregation/splitting, phone normalisation, validation rules |
| `writer.js` | Fills the console template in place with ExcelJS: finds columns by technical key (row 1), resolves the role list from the sheet's data validations, writes helper columns, normalises data-validation ranges |
| `src/app.html` | UI; `build.js` inlines the engine, writer and example data into `dist/index.html` |

Console conventions the code relies on:

- Row 1 of each data sheet holds technical keys (`HCM_ADMIN_CONSOLE_BOUNDARY_CODE`, `ADMIN_<LEVEL>`, `…_TARGET…`), row 2 the display labels.
- Helper column for level *i* = `H_` + SHA-256 of the codes of levels 0…*i*-1 joined with `#` (verified against a Kambia template).
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

The bundled example is the Akko LGA (Gombe) boundary hierarchy with targets only — no personal data. Users in the example are fictional placeholders.
