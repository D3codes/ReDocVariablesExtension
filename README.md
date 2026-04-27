# ReDoc Autofill Helper

A small Chrome/Edge extension for saving reusable API documentation values, then filling matching fields on ReDoc-powered pages.

## Load the Extension

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder: `C:\Users\freeman\Desktop\API Docs Browser Extension`.

## Use It

1. Open a ReDoc or ReDocly API documentation page.
2. Click the **ReDoc Autofill Helper** extension button.
3. Add saved values. Each value has:
   - **Name**: a friendly label, such as `API Key`.
   - **Match aliases**: comma-separated field names to look for, such as `api_key, x-api-key, authorization`.
   - **Value**: the value to write into matching fields.
4. Click **Save**.

After values are saved, matching fields populate automatically whenever a ReDoc-style page loads, becomes visible again, or renders new editable fields. The toolbar button is only needed when you want to add or edit saved values.

The extension stores values with `chrome.storage.sync`, so they can sync with the browser profile when sync is enabled.

## Matching Behavior

The content script scans visible, editable `input`, `textarea`, and `select` controls. It matches your aliases against field-specific context, including:

- Field `name`, `id`, placeholder, autocomplete, and ARIA label values.
- Explicit and wrapping labels.
- Scoped table row, list item, group, and parent text when that context contains only one editable field.

By default, existing field values are left unchanged. Enable **Overwrite filled fields** in the modal when you want the saved values to replace existing content.

Automatic filling is limited to pages that look like ReDoc or ReDocly API documentation. Clicking **Save** in the modal also runs one immediate fill pass on the current page.

When an editable request body already contains JSON, matching saved values update matching JSON properties in place instead of replacing the whole body. Nonmatching and invalid JSON bodies are left unchanged.

## Saving Values from Responses

When a response-looking JSON block appears in the API documentation, the extension adds a small `+` button next to each JSON property. Click the button to review the captured value before saving it.

The capture dialog lets you either create a new saved value or select an existing saved value to overwrite with the response value. New values use:

- **Name**: the response property name.
- **Match aliases**: the same response property name.
- **Value**: the response property value.

Primitive values are saved as plain text. Object and array values are saved as formatted JSON.

## Checks

Run the lightweight validation suite with:

```powershell
node --check content-script.js
node --check background.js
node tests\matching-regression.test.js
node tests\request-body-json-regression.test.js
node tests\response-property-save.test.js
```

## Notes

Most plain ReDoc pages are read-only documentation and do not expose editable fields. Autofill is useful on ReDoc/ReDocly pages that include a try-it console, authentication controls, request parameter inputs, or custom embedded forms.
