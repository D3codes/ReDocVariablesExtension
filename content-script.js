(() => {
  const APP_ID = "redoc-autofill-helper";
  const STORAGE_KEY = "redocAutofillEntries";
  const SETTINGS_KEY = "redocAutofillSettings";
  const STORAGE_VERSION = 2;
  const AUTOFILL_DEBOUNCE_MS = 350;
  const RESPONSE_ANNOTATION_DEBOUNCE_MS = 450;
  const RESPONSE_ANNOTATION_CLASS = "rah-response-annotations";
  const DEFAULT_ENTRIES = [
    {
      id: createId(),
      label: "API Key",
      aliases: "api_key, api key, x-api-key, authorization, bearer token",
      value: ""
    },
    {
      id: createId(),
      label: "Customer ID",
      aliases: "customer_id, customer id, customerId",
      value: ""
    }
  ];
  const DEFAULT_SETTINGS = {
    overwriteExisting: false,
    caseSensitive: false
  };

  if (window.__redocAutofillLoaded) {
    window.dispatchEvent(new CustomEvent("redoc-autofill:toggle"));
    return;
  }

  window.__redocAutofillLoaded = true;

  let entries = [];
  let entriesBySite = {};
  let settings = { ...DEFAULT_SETTINGS };
  let currentSiteKey = "";
  let modalRoot = null;
  let statusNode = null;
  let focusedBeforeOpen = null;
  let responseCapture = null;
  let autofillObserver = null;
  let autofillTimer = null;
  let responseAnnotationTimer = null;
  let pendingAutofillOptions = { force: false, highlight: false };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "REDOC_AUTOFILL_TOGGLE") {
      toggleModal();
    }
  });

  window.addEventListener("redoc-autofill:toggle", toggleModal);
  window.addEventListener("pageshow", () => scheduleAutofill({ delay: 0 }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleAutofill();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || (!changes[STORAGE_KEY] && !changes[SETTINGS_KEY])) {
      return;
    }

    loadState().then(() => scheduleAutofill({ delay: 0 }));
  });

  initializeAutofill();

  async function initializeAutofill() {
    await loadState();
    startAutofillObserver();
    scheduleAutofill({ delay: 0 });
    scheduleResponseAnnotations({ delay: 0 });
  }

  async function toggleModal() {
    await loadState();

    if (modalRoot?.isConnected) {
      closeModal();
      return;
    }

    openModal();
  }

  async function loadState() {
    const stored = await chrome.storage.sync.get([STORAGE_KEY, SETTINGS_KEY]);
    currentSiteKey = getCurrentSiteKey();
    entriesBySite = normalizeStoredSiteEntries(stored[STORAGE_KEY]);
    entries = entriesBySite[currentSiteKey]?.length
      ? cloneEntries(entriesBySite[currentSiteKey])
      : createDefaultEntries();
    settings = {
      ...DEFAULT_SETTINGS,
      ...(stored[SETTINGS_KEY] || {})
    };
  }

  async function saveState() {
    currentSiteKey = currentSiteKey || getCurrentSiteKey();
    const nextEntriesBySite = cloneEntriesBySite(entriesBySite);
    const nextEntries = normalizeEntries(entries);

    if (nextEntries.length) {
      nextEntriesBySite[currentSiteKey] = nextEntries;
    } else {
      delete nextEntriesBySite[currentSiteKey];
    }

    entriesBySite = nextEntriesBySite;

    await chrome.storage.sync.set({
      [STORAGE_KEY]: createStoredEntriesBySite(entriesBySite),
      [SETTINGS_KEY]: settings
    });
  }

  function normalizeStoredSiteEntries(storedEntries) {
    if (!storedEntries || typeof storedEntries !== "object" || Array.isArray(storedEntries)) {
      return {};
    }

    const rawSites = storedEntries.sites && typeof storedEntries.sites === "object"
      ? storedEntries.sites
      : {};
    const nextEntriesBySite = {};

    Object.entries(rawSites).forEach(([siteKey, siteEntries]) => {
      const normalizedSiteKey = normalizeSiteKey(siteKey);
      const normalizedEntries = normalizeEntries(siteEntries);

      if (normalizedSiteKey && normalizedEntries.length) {
        nextEntriesBySite[normalizedSiteKey] = normalizedEntries;
      }
    });

    return nextEntriesBySite;
  }

  function createStoredEntriesBySite(siteEntries) {
    return {
      version: STORAGE_VERSION,
      sites: cloneEntriesBySite(siteEntries)
    };
  }

  function cloneEntriesBySite(siteEntries) {
    const nextEntriesBySite = {};

    Object.entries(siteEntries || {}).forEach(([siteKey, siteEntriesList]) => {
      const normalizedSiteKey = normalizeSiteKey(siteKey);
      const normalizedEntries = normalizeEntries(siteEntriesList);

      if (normalizedSiteKey && normalizedEntries.length) {
        nextEntriesBySite[normalizedSiteKey] = normalizedEntries;
      }
    });

    return nextEntriesBySite;
  }

  function cloneEntries(entryList) {
    return normalizeEntries(entryList);
  }

  function normalizeEntries(entryList) {
    if (!Array.isArray(entryList)) {
      return [];
    }

    return entryList
      .map((entry) => normalizeEntry(entry))
      .filter((entry) => entry.label || entry.aliases || entry.value);
  }

  function normalizeEntry(entry) {
    const source = entry && typeof entry === "object" ? entry : {};

    return {
      id: source.id || createId(),
      label: String(source.label || ""),
      aliases: String(source.aliases || ""),
      value: source.value == null ? "" : String(source.value)
    };
  }

  function createDefaultEntries() {
    return DEFAULT_ENTRIES.map((entry) => ({
      id: createId(),
      label: entry.label,
      aliases: entry.aliases,
      value: entry.value
    }));
  }

  function createBlankEntry() {
    return {
      id: createId(),
      label: "",
      aliases: "",
      value: ""
    };
  }

  function getCurrentSiteKey() {
    const locationValue = window.location || {};
    const host = locationValue.host || locationValue.hostname;

    if (host) {
      return normalizeSiteKey(host);
    }

    if (locationValue.protocol === "file:") {
      return "local-file";
    }

    try {
      const parsedUrl = new URL(locationValue.href);
      return normalizeSiteKey(parsedUrl.host || parsedUrl.hostname || "unknown-site");
    } catch (error) {
      return "unknown-site";
    }
  }

  function normalizeSiteKey(siteKey) {
    return compactWhitespace(siteKey).toLowerCase();
  }

  function formatSiteLabel(siteKey) {
    if (siteKey === "local-file") {
      return "Local file";
    }

    if (siteKey === "unknown-site") {
      return "Current site";
    }

    return siteKey;
  }

  function openModal() {
    focusedBeforeOpen = document.activeElement;

    modalRoot = document.createElement("div");
    modalRoot.id = APP_ID;
    modalRoot.innerHTML = renderModal();
    document.documentElement.append(modalRoot);

    statusNode = modalRoot.querySelector("[data-status]");
    bindModalEvents();
    renderEntryRows();

    const firstValue = modalRoot.querySelector("input[data-field='value']");
    const closeButton = modalRoot.querySelector("[data-action='close']");
    (firstValue || closeButton)?.focus();
  }

  function closeModal() {
    modalRoot?.remove();
    modalRoot = null;
    statusNode = null;
    responseCapture = null;

    if (focusedBeforeOpen instanceof HTMLElement) {
      focusedBeforeOpen.focus();
    }
  }

  function renderModal() {
    return `
      <div class="rah-backdrop" data-action="close"></div>
      <section class="rah-modal" role="dialog" aria-modal="true" aria-labelledby="rah-title">
        <header class="rah-header">
          <div>
            <h1 id="rah-title">ReDoc Autofill</h1>
            <p>${getPageHint()}</p>
          </div>
          <button type="button" class="rah-icon-button" data-action="close" aria-label="Close">x</button>
        </header>

        <div class="rah-toolbar">
          <label class="rah-check">
            <input type="checkbox" data-setting="overwriteExisting" ${settings.overwriteExisting ? "checked" : ""}>
            <span>Overwrite filled fields</span>
          </label>
          <label class="rah-check">
            <input type="checkbox" data-setting="caseSensitive" ${settings.caseSensitive ? "checked" : ""}>
            <span>Case-sensitive match</span>
          </label>
        </div>

        <div class="rah-list" data-entry-list aria-label="Saved autofill values"></div>

        <div class="rah-reuse-panel" data-reuse-panel hidden></div>

        <div class="rah-actions">
          <div class="rah-action-group">
            <button type="button" class="rah-secondary" data-action="add">Add value</button>
            <button type="button" class="rah-secondary" data-action="show-reuse-sites">Reuse site values</button>
          </div>
          <button type="button" class="rah-primary" data-action="save-fill">Save</button>
        </div>

        <div class="rah-status" data-status role="status" aria-live="polite"></div>
      </section>
    `;
  }

  function getPageHint() {
    const siteLabel = escapeHtml(formatSiteLabel(currentSiteKey || getCurrentSiteKey()));

    if (isLikelyRedocPage()) {
      return `Values for ${siteLabel}. Matching fields fill automatically.`;
    }

    return `Values for ${siteLabel}. Automatic filling runs when a ReDoc-style API document is detected.`;
  }

  function renderEntryRows() {
    const list = modalRoot.querySelector("[data-entry-list]");
    list.innerHTML = "";

    entries.forEach((entry, index) => {
      const row = document.createElement("article");
      row.className = "rah-entry";
      row.dataset.entryId = entry.id;
      row.innerHTML = `
        <div class="rah-entry-top">
          <label>
            <span>Name</span>
            <input type="text" data-field="label" value="${escapeAttribute(entry.label)}" placeholder="API Key">
          </label>
          <button type="button" class="rah-icon-button" data-action="remove" aria-label="Remove ${escapeAttribute(entry.label || `value ${index + 1}`)}">x</button>
        </div>
        <label>
          <span>Match aliases</span>
          <input type="text" data-field="aliases" value="${escapeAttribute(entry.aliases)}" placeholder="api_key, x-api-key, authorization">
        </label>
        <label>
          <span>Value</span>
          <input type="text" data-field="value" value="${escapeAttribute(entry.value)}" placeholder="Value to fill">
        </label>
      `;
      list.append(row);
    });
  }

  function showReuseSitePanel() {
    const panel = modalRoot.querySelector("[data-reuse-panel]");
    const sites = getStoredSiteSummaries({ excludeCurrent: true });

    if (!panel) {
      return;
    }

    if (!sites.length) {
      setStatus("No other domains have saved values yet.");
      return;
    }

    panel.innerHTML = `
      <label>
        <span>Copy values from</span>
        <select data-field="reuseSiteKey">
          ${sites.map((site) => `
            <option value="${escapeAttribute(site.key)}">${escapeHtml(site.label)} (${site.count})</option>
          `).join("")}
        </select>
      </label>
      <div class="rah-reuse-actions">
        <button type="button" class="rah-secondary" data-action="cancel-reuse">Cancel</button>
        <button type="button" class="rah-primary" data-action="apply-reuse-site">Use values</button>
      </div>
    `;
    panel.hidden = false;
    panel.querySelector("select")?.focus();
  }

  function hideReuseSitePanel() {
    const panel = modalRoot?.querySelector("[data-reuse-panel]");

    if (!panel) {
      return;
    }

    panel.hidden = true;
    panel.innerHTML = "";
  }

  function getStoredSiteSummaries(options = {}) {
    return Object.entries(entriesBySite || {})
      .map(([siteKey, siteEntries]) => ({
        key: normalizeSiteKey(siteKey),
        label: formatSiteLabel(siteKey),
        count: Array.isArray(siteEntries) ? siteEntries.length : 0
      }))
      .filter((site) => site.key && site.count > 0)
      .filter((site) => !options.excludeCurrent || site.key !== currentSiteKey)
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  async function reuseEntriesFromSite(siteKey) {
    const sourceSiteKey = normalizeSiteKey(siteKey);

    if (!sourceSiteKey || sourceSiteKey === currentSiteKey) {
      return 0;
    }

    const copiedEntries = createCopiedEntriesFromSite(sourceSiteKey);
    if (!copiedEntries.length) {
      return 0;
    }

    entries = copiedEntries;
    await saveState();
    return entries.length;
  }

  function createCopiedEntriesFromSite(siteKey) {
    const sourceEntries = entriesBySite[normalizeSiteKey(siteKey)];

    if (!Array.isArray(sourceEntries)) {
      return [];
    }

    return sourceEntries.map((entry) => ({
      ...normalizeEntry(entry),
      id: createId()
    }));
  }

  function bindModalEvents() {
    modalRoot.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) {
        return;
      }

      if (action === "close") {
        closeModal();
        return;
      }

      if (action === "show-reuse-sites") {
        showReuseSitePanel();
        return;
      }

      if (action === "cancel-reuse") {
        hideReuseSitePanel();
        return;
      }

      if (action === "apply-reuse-site") {
        const siteKey = modalRoot.querySelector("[data-field='reuseSiteKey']")?.value || "";
        const copiedCount = await reuseEntriesFromSite(siteKey);

        if (!copiedCount) {
          setStatus("Choose a domain with saved values.");
          return;
        }

        renderEntryRows();
        hideReuseSitePanel();
        fillPage(entries, settings, { force: true, highlight: true });
        setStatus(`Copied ${copiedCount} values from ${formatSiteLabel(siteKey)}.`);
        return;
      }

      if (action === "add") {
        entries = [
          ...readEntriesFromModal({ includeEmpty: true }),
          createBlankEntry()
        ];
        renderEntryRows();
        modalRoot.querySelector(".rah-entry:last-child input")?.focus();
        return;
      }

      if (action === "remove") {
        const id = event.target.closest(".rah-entry")?.dataset.entryId;
        entries = readEntriesFromModal({ includeEmpty: true });
        entries = entries.filter((entry) => entry.id !== id);
        renderEntryRows();
        return;
      }

      if (action === "save-fill") {
        await persistFromModal();
        fillPage(entries, settings, { force: true, highlight: true });
        closeModal();
        return;
      }

      if (action === "save-response-value") {
        const savedEntry = await persistResponseCaptureFromModal();
        if (savedEntry) {
          markResponseSaveButtonSaved(responseCapture?.button, savedEntry.label);
          scheduleAutofill({ delay: 0, force: true });
        }

        closeModal();
      }
    });

    modalRoot.addEventListener("change", (event) => {
      if (event.target.dataset.field === "responseTargetId") {
        syncResponseCaptureFieldsFromSelection();
        return;
      }

      const settingName = event.target.dataset.setting;
      if (settingName) {
        settings[settingName] = Boolean(event.target.checked);
      }
    });

    modalRoot.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
        return;
      }

      if (event.key === "Tab") {
        trapFocus(event);
      }
    });
  }

  async function persistFromModal() {
    entries = readEntriesFromModal();
    await saveState();
  }

  function readEntriesFromModal(options = {}) {
    if (!modalRoot) {
      return [];
    }

    return readEntriesFromRows(modalRoot.querySelectorAll(".rah-entry"), options);
  }

  function readEntriesFromRows(rows, options = {}) {
    return Array.from(rows || [])
      .map((row) => {
        const label = row.querySelector("[data-field='label']")?.value.trim() || "";
        const aliases = row.querySelector("[data-field='aliases']")?.value.trim() || "";
        const value = row.querySelector("[data-field='value']")?.value || "";

        return {
          id: row.dataset.entryId || createId(),
          label,
          aliases,
          value
        };
      })
      .filter((entry) => options.includeEmpty || entry.label || entry.aliases || entry.value);
  }

  function startAutofillObserver() {
    if (autofillObserver || !document.documentElement) {
      return;
    }

    autofillObserver = new MutationObserver((mutations) => {
      const changedOutsideModal = mutations.some((mutation) => {
        return !modalRoot?.contains(mutation.target);
      });

      if (changedOutsideModal) {
        scheduleAutofill();
        scheduleResponseAnnotations();
      }
    });

    autofillObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "aria-label",
        "autocomplete",
        "data-cy",
        "data-testid",
        "disabled",
        "id",
        "name",
        "placeholder",
        "readonly",
        "type",
        "value"
      ],
      childList: true,
      subtree: true
    });
  }

  function scheduleAutofill(options = {}) {
    pendingAutofillOptions = {
      force: pendingAutofillOptions.force || Boolean(options.force),
      highlight: pendingAutofillOptions.highlight || Boolean(options.highlight)
    };

    clearTimeout(autofillTimer);
    autofillTimer = setTimeout(() => {
      const runOptions = pendingAutofillOptions;
      pendingAutofillOptions = { force: false, highlight: false };
      autofillTimer = null;
      runAutofill(runOptions);
    }, options.delay ?? AUTOFILL_DEBOUNCE_MS);
  }

  function runAutofill(options = {}) {
    if (!options.force && !isLikelyRedocPage()) {
      return;
    }

    const result = fillPage(entries, settings, options);
    if (statusNode && modalRoot?.isConnected && (options.force || result.filled)) {
      setStatus(formatResult(result));
    }
  }

  function scheduleResponseAnnotations(options = {}) {
    clearTimeout(responseAnnotationTimer);
    responseAnnotationTimer = setTimeout(() => {
      responseAnnotationTimer = null;
      annotateResponseProperties();
    }, options.delay ?? RESPONSE_ANNOTATION_DEBOUNCE_MS);
  }

  function annotateResponseProperties() {
    if (!isLikelyRedocPage()) {
      return;
    }

    collectResponseJsonBlocks().forEach((block) => {
      const text = getCodeBlockText(block);
      const properties = extractResponseProperties(text);
      const fingerprint = createResponseFingerprint(text, properties);

      if (!properties.length) {
        clearResponseAnnotations(block);
        return;
      }

      if (block.dataset.rahResponseFingerprint === fingerprint) {
        return;
      }

      clearResponseAnnotations(block);
      block.dataset.rahResponseFingerprint = fingerprint;
      block.classList.add("rah-response-block");

      const overlay = document.createElement("div");
      overlay.className = RESPONSE_ANNOTATION_CLASS;

      const metrics = getCodeLineMetrics(block);
      properties.forEach((property) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rah-response-save";
        button.textContent = "+";
        button.title = `Save ${property.key}: ${getValuePreview(property.value)}`;
        button.setAttribute("aria-label", `Save ${property.key} from response`);
        button.style.top = `${metrics.paddingTop + property.lineIndex * metrics.lineHeight}px`;

        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openResponseCaptureModal(property, button);
        });

        overlay.append(button);
      });

      block.append(overlay);
    });
  }

  function collectResponseJsonBlocks() {
    const blocks = new Set();

    document.querySelectorAll("pre, code").forEach((block) => {
      const normalizedBlock = block.closest("pre") || block;
      if (modalRoot?.contains(normalizedBlock) || blocks.has(normalizedBlock)) {
        return;
      }

      if (!isVisible(normalizedBlock) || !hasResponseHint(normalizedBlock)) {
        return;
      }

      const text = getCodeBlockText(normalizedBlock);
      if (looksLikeJsonWithProperties(text)) {
        blocks.add(normalizedBlock);
      }
    });

    return Array.from(blocks);
  }

  function hasResponseHint(block) {
    const responsePattern = /\b(response|responses|result|results|output|status)\b/i;
    const requestPattern = /\b(request|payload|parameters|headers|schema|example)\b/i;

    let node = block;
    let depth = 0;
    while (node && node !== document.body && depth < 6) {
      const descriptor = getNodeDescriptor(node);
      if (responsePattern.test(descriptor)) {
        return true;
      }

      node = node.parentElement;
      depth += 1;
    }

    const nearbyLabel = getNearbyResponseLabel(block);
    if (requestPattern.test(nearbyLabel)) {
      return false;
    }

    return responsePattern.test(nearbyLabel);
  }

  function getNodeDescriptor(node) {
    return [
      node.id,
      typeof node.className === "string" ? node.className : "",
      node.getAttribute("aria-label"),
      node.getAttribute("data-testid"),
      node.getAttribute("data-cy"),
      node.getAttribute("data-section-id")
    ].filter(Boolean).join(" ");
  }

  function getNearbyResponseLabel(block) {
    const labels = [];
    let node = block;
    let depth = 0;

    while (node && node !== document.body && depth < 4) {
      let sibling = node.previousElementSibling;
      let siblingCount = 0;

      while (sibling && siblingCount < 4) {
        const text = compactWhitespace(sibling.textContent);
        if (text && text.length <= 180) {
          labels.push(text);
        }

        sibling = sibling.previousElementSibling;
        siblingCount += 1;
      }

      node = node.parentElement;
      depth += 1;
    }

    return labels.join(" ");
  }

  function getCodeBlockText(block) {
    const clone = block.cloneNode(true);
    clone.querySelectorAll?.(`.${RESPONSE_ANNOTATION_CLASS}`).forEach((node) => node.remove());
    return clone.textContent || "";
  }

  function clearResponseAnnotations(block) {
    block.querySelectorAll?.(`.${RESPONSE_ANNOTATION_CLASS}`).forEach((node) => node.remove());
    block.classList.remove("rah-response-block");
    delete block.dataset.rahResponseFingerprint;
  }

  function looksLikeJsonWithProperties(text) {
    return isJsonContainerText(text)
      && /"((?:\\.|[^"\\])*)"\s*:/.test(text);
  }

  function isEditableJsonBodyValue(text) {
    return isJsonContainerText(text)
      && /"((?:\\.|[^"\\])*)"\s*:/.test(text);
  }

  function isJsonContainerText(text) {
    const trimmed = compactWhitespace(text);
    return (trimmed.startsWith("{") && trimmed.endsWith("}"))
      || (trimmed.startsWith("[") && trimmed.endsWith("]"));
  }

  function createResponseFingerprint(text, properties) {
    return `${hashString(text)}:${properties.length}:${properties.map((property) => `${property.lineIndex}:${property.key}`).join("|")}`;
  }

  function hashString(value) {
    let hash = 0;

    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }

    return String(hash);
  }

  function getCodeLineMetrics(block) {
    const style = window.getComputedStyle(block);
    const fontSize = Number.parseFloat(style.fontSize) || 13;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.45;

    return {
      lineHeight,
      paddingTop: Number.parseFloat(style.paddingTop) || 0
    };
  }

  function extractResponseProperties(text) {
    if (!looksLikeJsonWithProperties(text)) {
      return [];
    }

    const lines = text.split("\n");
    const lineOffsets = getLineStartOffsets(text);
    const properties = [];

    lines.forEach((line, lineIndex) => {
      const match = line.match(/^(\s*)"((?:\\.|[^"\\])*)"\s*:/);
      if (!match) {
        return;
      }

      const key = parseJsonString(`"${match[2]}"`);
      if (!key) {
        return;
      }

      const colonIndex = line.indexOf(":", match[0].length - 1);
      const valueSource = readJsonValue(text, lineOffsets[lineIndex] + colonIndex + 1);
      const value = formatResponseValue(valueSource);
      if (value === null) {
        return;
      }

      properties.push({
        key,
        alias: key,
        value,
        lineIndex
      });
    });

    return properties;
  }

  function getLineStartOffsets(text) {
    const offsets = [0];

    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "\n") {
        offsets.push(index + 1);
      }
    }

    return offsets;
  }

  function readJsonValue(text, startIndex) {
    let index = startIndex;
    while (/\s/.test(text[index] || "")) {
      index += 1;
    }

    const start = index;
    const firstCharacter = text[index];
    if (!firstCharacter) {
      return "";
    }

    if (firstCharacter === "\"") {
      index = readJsonStringEnd(text, index);
      return text.slice(start, index);
    }

    if (firstCharacter === "{" || firstCharacter === "[") {
      index = readBalancedJsonEnd(text, index);
      return text.slice(start, index);
    }

    while (index < text.length && !/[\n\r,\]}]/.test(text[index])) {
      index += 1;
    }

    return text.slice(start, index).trim();
  }

  function readJsonStringEnd(text, startIndex) {
    let escaped = false;

    for (let index = startIndex + 1; index < text.length; index += 1) {
      const character = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === "\"") {
        return index + 1;
      }
    }

    return text.length;
  }

  function readBalancedJsonEnd(text, startIndex) {
    const openCharacter = text[startIndex];
    const closeCharacter = openCharacter === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < text.length; index += 1) {
      const character = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          inString = false;
        }

        continue;
      }

      if (character === "\"") {
        inString = true;
      } else if (character === openCharacter) {
        depth += 1;
      } else if (character === closeCharacter) {
        depth -= 1;
        if (depth === 0) {
          return index + 1;
        }
      }
    }

    return text.length;
  }

  function formatResponseValue(valueSource) {
    if (!valueSource) {
      return null;
    }

    try {
      const parsed = JSON.parse(valueSource);

      if (typeof parsed === "string") {
        return parsed;
      }

      if (parsed === null) {
        return "null";
      }

      if (typeof parsed === "object") {
        return JSON.stringify(parsed, null, 2);
      }

      return String(parsed);
    } catch (error) {
      return valueSource.trim() || null;
    }
  }

  function parseJsonString(value) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return "";
    }
  }

  function createEntryFromResponseProperty(property, options = {}) {
    return {
      id: options.id || createId(),
      label: options.label || property.key,
      aliases: options.aliases || property.alias || property.key,
      value: property.value
    };
  }

  async function openResponseCaptureModal(property, button) {
    await loadState();

    const previouslyFocused = document.activeElement;

    if (modalRoot?.isConnected) {
      closeModal();
    }

    focusedBeforeOpen = previouslyFocused;
    responseCapture = { property, button };

    modalRoot = document.createElement("div");
    modalRoot.id = APP_ID;
    modalRoot.innerHTML = renderResponseCaptureModal(property);
    document.documentElement.append(modalRoot);

    statusNode = modalRoot.querySelector("[data-status]");
    bindModalEvents();

    const nameInput = modalRoot.querySelector("[data-field='responseLabel']");
    nameInput?.focus();
    nameInput?.select();
  }

  function renderResponseCaptureModal(property) {
    return `
      <div class="rah-backdrop" data-action="close"></div>
      <section class="rah-modal rah-capture-modal" role="dialog" aria-modal="true" aria-labelledby="rah-capture-title">
        <header class="rah-header">
          <div>
            <h1 id="rah-capture-title">Save Response Value</h1>
            <p>${escapeHtml(property.key)} = ${escapeHtml(getValuePreview(property.value))}</p>
          </div>
          <button type="button" class="rah-icon-button" data-action="close" aria-label="Close">x</button>
        </header>

        <label>
          <span>Save target</span>
          <select data-field="responseTargetId">
            <option value="">Create new saved value</option>
            ${entries.map((entry) => `
              <option value="${escapeAttribute(entry.id)}">${escapeHtml(formatEntryOptionLabel(entry))}</option>
            `).join("")}
          </select>
        </label>

        <label>
          <span>Name</span>
          <input type="text" data-field="responseLabel" value="${escapeAttribute(property.key)}" placeholder="customer_id">
        </label>

        <label>
          <span>Match aliases</span>
          <input type="text" data-field="responseAliases" value="${escapeAttribute(property.alias || property.key)}" placeholder="customer_id, customer id">
        </label>

        <label>
          <span>Response value</span>
          <textarea data-field="responseValue" readonly>${escapeHtml(property.value)}</textarea>
        </label>

        <div class="rah-actions">
          <button type="button" class="rah-secondary" data-action="close">Cancel</button>
          <button type="button" class="rah-primary" data-action="save-response-value">Save</button>
        </div>

        <div class="rah-status" data-status role="status" aria-live="polite"></div>
      </section>
    `;
  }

  function formatEntryOptionLabel(entry) {
    const label = compactWhitespace(entry.label) || compactWhitespace(entry.aliases) || "Unnamed value";
    const aliases = compactWhitespace(entry.aliases);
    return aliases ? `${label} (${aliases})` : label;
  }

  function syncResponseCaptureFieldsFromSelection() {
    if (!modalRoot || !responseCapture) {
      return;
    }

    const targetId = modalRoot.querySelector("[data-field='responseTargetId']")?.value;
    const labelInput = modalRoot.querySelector("[data-field='responseLabel']");
    const aliasesInput = modalRoot.querySelector("[data-field='responseAliases']");
    const selectedEntry = entries.find((entry) => entry.id === targetId);

    if (!labelInput || !aliasesInput) {
      return;
    }

    if (selectedEntry) {
      labelInput.value = selectedEntry.label || responseCapture.property.key;
      aliasesInput.value = selectedEntry.aliases || selectedEntry.label || responseCapture.property.key;
      return;
    }

    labelInput.value = responseCapture.property.key;
    aliasesInput.value = responseCapture.property.alias || responseCapture.property.key;
  }

  async function persistResponseCaptureFromModal() {
    if (!modalRoot || !responseCapture) {
      return null;
    }

    const property = responseCapture.property;
    const targetId = modalRoot.querySelector("[data-field='responseTargetId']")?.value || "";
    const label = modalRoot.querySelector("[data-field='responseLabel']")?.value.trim() || property.key;
    const aliases = modalRoot.querySelector("[data-field='responseAliases']")?.value.trim() || property.alias || property.key;
    entries = applyResponseCaptureEntry(entries, property, { targetId, label, aliases });
    await saveState();

    return entries.find((entry) => entry.id === targetId) || entries[entries.length - 1];
  }

  function applyResponseCaptureEntry(currentEntries, property, options = {}) {
    const selectedEntry = currentEntries.find((entry) => entry.id === options.targetId);
    const nextEntry = createEntryFromResponseProperty(property, {
      id: selectedEntry?.id,
      label: options.label,
      aliases: options.aliases
    });

    if (selectedEntry) {
      return currentEntries.map((entry) => entry.id === selectedEntry.id ? nextEntry : entry);
    }

    return [...currentEntries, nextEntry];
  }

  function markResponseSaveButtonSaved(button, key) {
    if (!button) {
      return;
    }

    button.classList.add("rah-response-save-saved");
    button.textContent = "OK";
    button.title = `Saved ${key}`;
    button.setAttribute("aria-label", `Saved ${key}`);
  }

  function getValuePreview(value) {
    const preview = compactWhitespace(value);
    return preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
  }

  function fillPage(savedEntries, activeSettings, options = {}) {
    const candidates = collectFillCandidates();
    const usableEntries = savedEntries
      .map((entry) => ({
        ...entry,
        tokens: getEntryTokens(entry, activeSettings)
      }))
      .filter((entry) => entry.value && entry.tokens.length);

    let filled = 0;
    let unchanged = 0;
    let skipped = 0;
    const matched = [];

    candidates.forEach((candidate) => {
      const bodyFillOutcome = fillJsonBodyCandidate(candidate, usableEntries, activeSettings);
      if (bodyFillOutcome.status !== "not-json") {
        skipped += bodyFillOutcome.skipped || 0;
        unchanged += bodyFillOutcome.unchanged || 0;

        if (bodyFillOutcome.status === "changed") {
          candidate.element.dispatchEvent(new Event("input", { bubbles: true }));
          candidate.element.dispatchEvent(new Event("change", { bubbles: true }));
          filled += bodyFillOutcome.count;
          matched.push({ candidate, entry: null });
        } else if (bodyFillOutcome.status === "unchanged") {
          unchanged += bodyFillOutcome.count;
        }

        return;
      }

      if (!activeSettings.overwriteExisting && candidate.element.value) {
        skipped += 1;
        return;
      }

      const match = findBestMatch(candidate, usableEntries, activeSettings);
      if (!match) {
        return;
      }

      const fillOutcome = setNativeValue(candidate.element, match.entry.value);
      if (fillOutcome === "unchanged") {
        unchanged += 1;
        return;
      }

      if (fillOutcome !== "changed") {
        return;
      }

      candidate.element.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.element.dispatchEvent(new Event("change", { bubbles: true }));
      filled += 1;
      matched.push({ candidate, entry: match.entry });
    });

    if (options.highlight) {
      highlightMatches(matched.map((item) => item.candidate.element));
    }

    return {
      filled,
      unchanged,
      skipped,
      scanned: candidates.length,
      configured: usableEntries.length
    };
  }

  function fillJsonBodyCandidate(candidate, usableEntries, activeSettings) {
    const element = candidate.element;
    const originalValue = element.value || "";

    if (!isEditableJsonBodyValue(originalValue)) {
      return { status: "not-json", count: 0 };
    }

    let parsedValue;
    try {
      parsedValue = JSON.parse(originalValue);
    } catch (error) {
      return { status: "invalid-json", count: 0 };
    }

    const result = updateJsonBodyProperties(parsedValue, usableEntries, activeSettings);
    if (!result.matched) {
      return { status: "no-match", count: 0 };
    }

    if (!result.changed) {
      return {
        status: "unchanged",
        count: result.unchanged,
        skipped: result.skipped
      };
    }

    const nextValue = stringifyJsonLikeOriginal(parsedValue, originalValue);
    const fillOutcome = setNativeValue(element, nextValue);

    if (fillOutcome === "changed") {
      return {
        status: "changed",
        count: result.changed,
        unchanged: result.unchanged,
        skipped: result.skipped
      };
    }

    return {
      status: "unchanged",
      count: result.changed + result.unchanged,
      skipped: result.skipped
    };
  }

  function updateJsonBodyProperties(value, usableEntries, activeSettings) {
    const result = {
      matched: 0,
      changed: 0,
      unchanged: 0,
      skipped: 0
    };

    visitJsonBodyValue(value, (container, key) => {
      const match = findBestJsonPropertyMatch(key, usableEntries, activeSettings);
      if (!match) {
        return;
      }

      result.matched += 1;

      if (!activeSettings.overwriteExisting && !isEmptyJsonBodyPropertyValue(container[key])) {
        result.skipped += 1;
        return;
      }

      const nextValue = coerceSavedValueForJson(container[key], match.entry.value);
      if (jsonValuesEqual(container[key], nextValue)) {
        result.unchanged += 1;
        return;
      }

      container[key] = nextValue;
      result.changed += 1;
    });

    return result;
  }

  function isEmptyJsonBodyPropertyValue(value) {
    if (value === null) {
      return true;
    }

    if (typeof value === "string") {
      return value.trim().length === 0;
    }

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    if (value && typeof value === "object") {
      return Object.keys(value).length === 0;
    }

    return false;
  }

  function visitJsonBodyValue(value, callback) {
    if (Array.isArray(value)) {
      value.forEach((item) => visitJsonBodyValue(item, callback));
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    Object.keys(value).forEach((key) => {
      callback(value, key);
      visitJsonBodyValue(value[key], callback);
    });
  }

  function findBestJsonPropertyMatch(propertyName, usableEntries, activeSettings) {
    const propertyText = normalize(propertyName, activeSettings);
    let best = null;

    usableEntries.forEach((entry) => {
      entry.tokens.forEach((token) => {
        const score = getMatchScore(propertyText, token, 125);
        if (!score) {
          return;
        }

        if (!best || score > best.score) {
          best = { entry, score };
        }
      });
    });

    return best;
  }

  function coerceSavedValueForJson(currentValue, savedValue) {
    const textValue = String(savedValue);

    if (typeof currentValue === "string") {
      return textValue;
    }

    if (typeof currentValue === "number") {
      const numericValue = Number(textValue);
      return Number.isFinite(numericValue) ? numericValue : textValue;
    }

    if (typeof currentValue === "boolean") {
      if (/^true$/i.test(textValue)) {
        return true;
      }

      if (/^false$/i.test(textValue)) {
        return false;
      }

      return textValue;
    }

    try {
      return JSON.parse(textValue);
    } catch (error) {
      return textValue;
    }
  }

  function jsonValuesEqual(left, right) {
    if (Object.is(left, right)) {
      return true;
    }

    return JSON.stringify(left) === JSON.stringify(right);
  }

  function stringifyJsonLikeOriginal(value, originalValue) {
    const indent = getJsonIndent(originalValue);
    const nextValue = JSON.stringify(value, null, indent);
    return /\r?\n$/.test(originalValue) ? `${nextValue}\n` : nextValue;
  }

  function getJsonIndent(value) {
    const tabMatch = value.match(/\n(\t+)"/);
    if (tabMatch) {
      return tabMatch[1];
    }

    const spaceMatch = value.match(/\n( +)"/);
    if (spaceMatch) {
      return spaceMatch[1].length;
    }

    return value.includes("\n") ? 2 : 0;
  }

  function collectFillCandidates() {
    const fieldSelector = [
      "input:not([type])",
      "input[type='text']",
      "input[type='search']",
      "input[type='email']",
      "input[type='url']",
      "input[type='tel']",
      "input[type='password']",
      "input[type='number']",
      "textarea",
      "select"
    ].join(",");

    return Array.from(document.querySelectorAll(fieldSelector))
      .filter((element) => !modalRoot?.contains(element))
      .filter((element) => !element.disabled && !element.readOnly)
      .filter((element) => isVisible(element))
      .map((element) => ({
        element,
        fragments: getCandidateFragments(element)
      }))
      .filter((candidate) => candidate.fragments.length || isEditableJsonBodyValue(candidate.element.value || ""));
  }

  function getCandidateFragments(element) {
    return uniqueFragments([
      createFragment(element.name, 110, "name"),
      createFragment(element.id, 105, "id"),
      createFragment(element.getAttribute("aria-label"), 100, "aria-label"),
      createFragment(element.getAttribute("placeholder"), 95, "placeholder"),
      createFragment(element.getAttribute("data-testid"), 85, "test-id"),
      createFragment(element.getAttribute("data-cy"), 85, "test-id"),
      createFragment(element.getAttribute("autocomplete"), 65, "autocomplete"),
      createFragment(getExplicitLabelText(element), 100, "label"),
      createFragment(getReferencedText(element, "aria-labelledby"), 95, "aria-labelledby"),
      createFragment(getReferencedText(element, "aria-describedby"), 65, "aria-describedby"),
      ...getScopedContextFragments(element)
    ]);
  }

  function createFragment(text, weight, source) {
    const compactText = compactWhitespace(text);
    if (!compactText) {
      return null;
    }

    return {
      text: compactText,
      weight,
      source
    };
  }

  function getExplicitLabelText(element) {
    const labels = [];

    if ("labels" in element && element.labels) {
      Array.from(element.labels).forEach((label) => {
        labels.push(label.textContent);
      });
    } else if (element.id) {
      document.querySelectorAll(`label[for="${cssEscape(element.id)}"]`).forEach((label) => {
        labels.push(label.textContent);
      });
    }

    const wrappingLabel = element.closest("label");
    if (wrappingLabel) {
      labels.push(wrappingLabel.textContent);
    }

    return labels.join(" ");
  }

  function getReferencedText(element, attributeName) {
    const ids = (element.getAttribute(attributeName) || "")
      .split(/\s+/)
      .filter(Boolean);

    return ids
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");
  }

  function getScopedContextFragments(element) {
    const contexts = [
      { node: element.closest("tr"), weight: 90, source: "table-row" },
      { node: element.closest("[role='row']"), weight: 90, source: "row" },
      { node: element.closest("li"), weight: 75, source: "list-item" },
      { node: element.closest("[role='group']"), weight: 75, source: "group" },
      { node: element.parentElement, weight: 60, source: "parent" }
    ];

    return contexts
      .filter(({ node }) => node && node !== document.body && node !== document.documentElement)
      .filter(({ node }) => countEditableFields(node) <= 1)
      .map(({ node, weight, source }) => createFragment(node.textContent, weight, source))
      .filter((fragment) => fragment && isScopedText(fragment.text));
  }

  function countEditableFields(container) {
    const fieldSelector = [
      "input:not([type])",
      "input[type='text']",
      "input[type='search']",
      "input[type='email']",
      "input[type='url']",
      "input[type='tel']",
      "input[type='password']",
      "input[type='number']",
      "textarea",
      "select"
    ].join(",");

    return container.querySelectorAll(fieldSelector).length;
  }

  function isScopedText(text) {
    return text.length <= 240;
  }

  function uniqueFragments(fragments) {
    const seen = new Set();

    return fragments.filter((fragment) => {
      if (!fragment) {
        return false;
      }

      const key = `${fragment.source}:${fragment.text}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  function getEntryTokens(entry, activeSettings) {
    const rawTokens = [
      entry.label,
      ...(entry.aliases || "").split(",")
    ];

    return rawTokens
      .map((token) => normalize(token, activeSettings))
      .filter(Boolean);
  }

  function findBestMatch(candidate, usableEntries, activeSettings) {
    let best = null;
    usableEntries.forEach((entry) => {
      entry.tokens.forEach((token) => {
        candidate.fragments.forEach((fragment) => {
          const fragmentText = normalize(fragment.text, activeSettings);
          const score = getMatchScore(fragmentText, token, fragment.weight);
          if (!score) {
            return;
          }

          if (!best || score > best.score) {
            best = { entry, score };
          }
        });
      });
    });

    return best;
  }

  function getMatchScore(candidateText, token, weight) {
    if (!candidateText || !token || !candidateText.includes(token)) {
      return 0;
    }

    const exactBonus = candidateText === token ? 100 : 0;
    const boundaryBonus = hasTokenBoundary(candidateText, token) ? 35 : 0;
    const shortTokenPenalty = token.length < 3 ? 80 : 0;

    if (token.length < 3 && !exactBonus) {
      return 0;
    }

    if (!exactBonus && !boundaryBonus && token.length < 4) {
      return 0;
    }

    return weight + exactBonus + boundaryBonus + token.length - shortTokenPenalty;
  }

  function hasTokenBoundary(candidateText, token) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escapedToken}(\\s|$)`).test(candidateText);
  }

  function normalize(value, activeSettings) {
    const normalized = compactWhitespace(
      String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
    );

    return activeSettings.caseSensitive ? normalized : normalized.toLowerCase();
  }

  function compactWhitespace(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function setNativeValue(element, value) {
    if (element.tagName === "SELECT") {
      const normalizedValue = normalize(value, { caseSensitive: false });
      const option = Array.from(element.options).find((item) => {
        return normalize(item.value, { caseSensitive: false }) === normalizedValue
          || normalize(item.textContent, { caseSensitive: false }) === normalizedValue;
      });

      if (option) {
        if (element.value === option.value) {
          return "unchanged";
        }

        element.value = option.value;
        return "changed";
      }

      return "no-option";
    }

    if (element.value === value) {
      return "unchanged";
    }

    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    return "changed";
  }

  function highlightMatches(elements) {
    elements.forEach((element) => {
      element.classList.add("rah-filled-highlight");
      setTimeout(() => element.classList.remove("rah-filled-highlight"), 1800);
    });
  }

  function isLikelyRedocPage() {
    return Boolean(
      document.querySelector("redoc, redocly-api-docs, [data-redoc], [data-section-id]")
      || document.querySelector("script[src*='redoc']")
      || document.body?.textContent?.includes("ReDoc")
    );
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return style.visibility !== "hidden"
      && style.display !== "none"
      && rect.width > 0
      && rect.height > 0;
  }

  function setStatus(message) {
    if (statusNode) {
      statusNode.textContent = message;
    }
  }

  function formatResult(result) {
    if (!result.configured) {
      return "Add at least one value and alias before autofilling.";
    }

    if (!result.scanned) {
      return "No editable fields were found on this page.";
    }

    if (!result.filled) {
      if (result.unchanged) {
        return "Matching fields already have the configured values.";
      }

      return `Scanned ${result.scanned} fields, but none matched your aliases.`;
    }

    const skippedText = result.skipped ? ` ${result.skipped} filled fields were left unchanged.` : "";
    return `Filled ${result.filled} of ${result.scanned} detected fields.${skippedText}`;
  }

  function trapFocus(event) {
    const focusable = Array.from(
      modalRoot.querySelectorAll("button, input, textarea, select, [tabindex]:not([tabindex='-1'])")
    ).filter((element) => !element.disabled && isVisible(element));

    if (!focusable.length) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function escapeAttribute(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }

    return String(value).replace(/["\\]/g, "\\$&");
  }

  function createId() {
    return `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getStateSnapshot() {
    return {
      currentSiteKey,
      entries: cloneEntries(entries),
      entriesBySite: cloneEntriesBySite(entriesBySite),
      settings: { ...settings }
    };
  }

  if (window.__REDOC_AUTOFILL_ENABLE_TEST_HOOK__) {
    window.__REDOC_AUTOFILL_TEST_API__ = {
      fillPage,
      applyResponseCaptureEntry,
      collectFillCandidates,
      createEntryFromResponseProperty,
      createBlankEntry,
      createCopiedEntriesFromSite,
      extractResponseProperties,
      findBestMatch,
      fillJsonBodyCandidate,
      getCandidateFragments,
      getCurrentSiteKey,
      getStateSnapshot,
      getStoredSiteSummaries,
      loadState,
      normalizeStoredSiteEntries,
      readEntriesFromRows,
      reuseEntriesFromSite,
      updateJsonBodyProperties,
      normalize
    };
  }
})();
