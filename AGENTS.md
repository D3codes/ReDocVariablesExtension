# AGENTS.md

This repo contains a Chrome/Edge Manifest V3 extension named **ReDoc Autofill Helper**. It is intentionally dependency-free: plain JavaScript, CSS, a MV3 manifest, and small Node-based regression tests.

## What It Does

The extension helps users work with ReDoc/ReDocly-powered API documentation pages by:

- Storing reusable values such as API keys, IDs, tokens, and other request inputs.
- Automatically filling matching request fields in API documentation consoles.
- Watching dynamically rendered ReDoc content so fields that appear later can still be filled.
- Keeping saved values isolated per site/domain, with a reuse flow for copying values from another domain.
- Adding a `+` control next to each property in response-looking JSON blocks.
- Letting users capture a response property value into saved autofill values, either as a new value or by overwriting an existing saved value.

Saved values are stored in `chrome.storage.sync` under `redocAutofillEntries` as a versioned object: `{ version: 2, sites: { [siteKey]: entries } }`. Settings are stored under `redocAutofillSettings`.

## File Layout

- `manifest.json`
  - MV3 extension manifest.
  - Loads `content-script.js` and `content-styles.css` on all URLs at `document_idle`.
  - Uses `activeTab`, `scripting`, and `storage`.

- `background.js`
  - Handles toolbar button clicks.
  - Sends `REDOC_AUTOFILL_TOGGLE` to the active tab.
  - Falls back to injecting the content script and CSS if they are not already present.

- `content-script.js`
  - Main extension logic.
  - Owns saved value modal UI, response capture modal UI, autofill matching, response JSON annotation, storage reads/writes, and test hooks.

- `content-styles.css`
  - Styles the injected modal, fields, response `+` buttons, saved indicators, and autofill highlights.

- `icon.png`
  - Source PNG icon.
  - Currently `196x196`.

- `icons/`
  - Generated PNG icon sizes used by `manifest.json`: `16`, `32`, `48`, and `128`.
  - Regenerate these from `icon.png` if the source icon changes.

- `README.md`
  - User-facing load/use instructions and test commands.

- `tests/matching-regression.test.js`
  - VM/fake-DOM regression test for request field matching.
  - Protects against the bug where broad operation text caused all fields to receive the same value.

- `tests/modal-entry-form-regression.test.js`
  - VM/fake-DOM regression test for preserving unsaved modal row edits across add/remove re-renders.

- `tests/request-body-json-regression.test.js`
  - VM/fake-DOM regression test for editable JSON request bodies.
  - Protects against replacing an entire request body with a saved scalar value when only one JSON property should change.

- `tests/response-property-save.test.js`
  - VM/fake-DOM regression test for response property parsing and response capture entry creation/overwrite behavior.

- `tests/site-storage-regression.test.js`
  - VM/fake-DOM regression test for per-site storage and reuse-from-site behavior.

## Core Flows

### Saved Value Configuration

The toolbar button opens the main modal via `toggleModal()` and `openModal()`.

Each saved value has:

- `id`
- `label`
- `aliases`
- `value`

The main modal lets users add/remove/edit entries and toggle:

- `overwriteExisting`
- `caseSensitive`

The modal is scoped to the current site key from `window.location.host`. **Reuse site values** opens a domain picker, then copies all saved values from the selected source domain into the current domain.

When the main modal's **Save** button is clicked:

1. `persistFromModal()` writes entries/settings to `chrome.storage.sync`.
2. `fillPage(entries, settings, { force: true, highlight: true })` runs once.
3. The modal closes.

### Automatic Autofill

Initialization happens in `initializeAutofill()`:

1. Load storage state with `loadState()`.
2. Start a `MutationObserver` with `startAutofillObserver()`.
3. Schedule an immediate autofill pass.
4. Schedule an immediate response annotation pass.

Autofill is scheduled through `scheduleAutofill()` and executed by `runAutofill()`.

Automatic autofill only runs when `isLikelyRedocPage()` returns true, unless a caller passes `{ force: true }`.

### Field Matching

The matcher is intentionally field-specific. Avoid using broad ReDoc operation/section text for matching; that caused a previous bug where every input in the same operation matched the same alias.

Candidate fields come from `collectFillCandidates()`:

- text-ish `input`
- `textarea`
- `select`

Candidates are filtered to visible, enabled, editable fields outside the extension modal.

Field context is gathered by `getCandidateFragments()` from:

- `name`
- `id`
- `aria-label`
- `placeholder`
- `data-testid`
- `data-cy`
- `autocomplete`
- explicit/wrapping labels
- `aria-labelledby`
- `aria-describedby`
- scoped row/list/group/parent text only when the scope contains one editable field

Matching runs through `findBestMatch()` and `getMatchScore()`. Higher-weight and more exact fragments win. Very short tokens are guarded to reduce accidental substring matches.

### JSON Request Body Autofill

Before scalar field replacement, `fillPage()` calls `fillJsonBodyCandidate()` for controls whose current value looks like a JSON object or root array with properties.

If the body parses as JSON:

- matching saved values update matching JSON property keys in place
- nested objects and arrays are traversed
- string/number/boolean values are coerced based on the current JSON property's type
- object and array values are parsed from saved JSON when possible
- the whole request body is never replaced with a scalar saved value

If a body looks like JSON but cannot be parsed, it is left unchanged. This is intentional: invalid or partially edited JSON should not be clobbered by scalar autofill.

### Response JSON Annotation

Response annotation is scheduled with `scheduleResponseAnnotations()` and performed by `annotateResponseProperties()`.

`collectResponseJsonBlocks()` scans visible `pre`/`code` blocks and keeps blocks that:

- look like JSON objects or root arrays with object properties
- are near response/result/output/status context
- are not near request/payload/parameters/headers/schema/example context

`extractResponseProperties()` scans JSON text line-by-line for properties and reads the property value with the lightweight JSON value scanner:

- strings are saved as plain strings
- numbers/booleans/null are stringified
- objects/arrays are saved as formatted JSON

The response overlay adds a small `+` button on each property line. Button placement uses computed line height and padding from `getCodeLineMetrics()`.

### Response Capture Modal

Clicking a response `+` button calls `openResponseCaptureModal(property, button)`.

The capture modal lets the user:

- edit the saved value name
- edit aliases
- view the captured response value
- create a new saved value
- select an existing saved value and overwrite it

Saving uses `persistResponseCaptureFromModal()` and `applyResponseCaptureEntry()`.

After save:

1. Storage is updated.
2. The originating response button is marked saved with `markResponseSaveButtonSaved()`.
3. An immediate forced autofill pass is scheduled.
4. The modal closes.

## Important Implementation Notes

- Keep the project dependency-free unless there is a strong reason to add tooling.
- Use `apply_patch` for manual edits.
- The content script is wrapped in an IIFE and exposes test hooks only when `window.__REDOC_AUTOFILL_ENABLE_TEST_HOOK__` is true.
- Keep injected UI isolated under `#redoc-autofill-helper` where possible.
- `manifest.json` currently points icon slots at PNG files in `icons/`.
- Response annotation styles are global by necessity because the buttons live inside page `pre`/`code` blocks.
- Be cautious with broad DOM text. ReDoc pages often nest inputs inside large operation sections; matching against section-wide text creates false positives.
- The extension is loaded unpacked, so after manifest/content-script changes the user must reload it in `chrome://extensions` or `edge://extensions`.
- Git writes to `.git` may require elevated command execution in this environment.

## Validation

Run these checks after changes:

```powershell
node --check content-script.js
node --check background.js
node tests\modal-entry-form-regression.test.js
node tests\matching-regression.test.js
node tests\request-body-json-regression.test.js
node tests\response-property-save.test.js
node tests\site-storage-regression.test.js
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
```

There is no package manager setup and no build step.

## Current Git History Shape

The repo currently has focused commits for:

- Initial MV3 extension scaffold.
- Fixing field-specific matching.
- Adding response value capture controls.
- Adding the response capture review modal.
- Fixing JSON request body autofill so matching properties update in place.

Prefer continuing that style: small commits with behavior-focused messages.
