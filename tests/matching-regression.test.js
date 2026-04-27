const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

class FakeEvent {
  constructor(type) {
    this.type = type;
  }
}

class FakeMutationObserver {
  observe() {}
}

class FakeElement {
  constructor(tagName, attrs = {}, text = "") {
    this.tagName = tagName.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.disabled = false;
    this.readOnly = false;
    this._value = attrs.value || "";
    this.labels = null;
    this.options = [];
    this.classList = {
      add() {},
      remove() {}
    };
    this.ownText = text;
  }

  get id() {
    return this.attrs.id || "";
  }

  get name() {
    return this.attrs.name || "";
  }

  get type() {
    return this.attrs.type || "";
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
  }

  get textContent() {
    return [this.ownText, ...this.children.map((child) => child.textContent)]
      .filter(Boolean)
      .join(" ");
  }

  set textContent(value) {
    this.ownText = value;
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  closest(selector) {
    let node = this;

    while (node) {
      if (matchesSelector(node, selector)) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  querySelectorAll(selector) {
    const results = [];

    walk(this, (node) => {
      if (node !== this && matchesFieldSelector(node, selector)) {
        results.push(node);
      }
    });

    return results;
  }

  getBoundingClientRect() {
    return { width: 120, height: 24 };
  }

  dispatchEvent() {}
}

function walk(node, callback) {
  callback(node);
  node.children.forEach((child) => walk(child, callback));
}

function matchesSelector(node, selector) {
  if (selector === "tr") {
    return node.tagName === "TR";
  }

  if (selector === "li") {
    return node.tagName === "LI";
  }

  if (selector === "label") {
    return node.tagName === "LABEL";
  }

  if (selector === "[role='row']") {
    return node.getAttribute("role") === "row";
  }

  if (selector === "[role='group']") {
    return node.getAttribute("role") === "group";
  }

  return false;
}

function matchesFieldSelector(node) {
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT";
}

function createInput(name) {
  return new FakeElement("input", { type: "text", name });
}

function createRow(text, input) {
  const row = new FakeElement("tr", {}, text);
  row.append(input);
  return row;
}

const apiKeyInput = createInput("api_key");
const customerIdInput = createInput("customer_id");
const pageSizeInput = createInput("page_size");

const operation = new FakeElement(
  "section",
  { "data-section-id": "operation/create-item" },
  "Create item api_key customer_id page_size"
);

operation.append(createRow("api_key string header", apiKeyInput));
operation.append(createRow("customer_id string path", customerIdInput));
operation.append(createRow("page_size integer query", pageSizeInput));

const document = {
  body: new FakeElement("body", {}, "ReDoc"),
  documentElement: new FakeElement("html"),
  addEventListener() {},
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [apiKeyInput, customerIdInput, pageSizeInput];
  },
  getElementById() {
    return null;
  }
};

document.documentElement.append(document.body);
document.body.append(operation);

const window = {
  __REDOC_AUTOFILL_ENABLE_TEST_HOOK__: true,
  addEventListener() {},
  dispatchEvent() {},
  getComputedStyle() {
    return { display: "block", visibility: "visible" };
  },
  CSS: {
    escape(value) {
      return value;
    }
  }
};

const context = {
  assert,
  console,
  document,
  window,
  HTMLElement: FakeElement,
  Event: FakeEvent,
  MutationObserver: FakeMutationObserver,
  CustomEvent: FakeEvent,
  setTimeout,
  clearTimeout,
  chrome: {
    runtime: {
      onMessage: {
        addListener() {}
      }
    },
    storage: {
      sync: {
        async get() {
          return {};
        },
        async set() {}
      },
      onChanged: {
        addListener() {}
      }
    }
  }
};

vm.createContext(context);
const script = fs.readFileSync(path.join(__dirname, "..", "content-script.js"), "utf8");
vm.runInContext(script, context);

const result = context.window.__REDOC_AUTOFILL_TEST_API__.fillPage(
  [
    {
      label: "API Key",
      aliases: "api_key, x-api-key",
      value: "secret-token"
    },
    {
      label: "Customer ID",
      aliases: "customer_id, customer id",
      value: "customer-123"
    }
  ],
  {
    overwriteExisting: false,
    caseSensitive: false
  }
);

assert.strictEqual(apiKeyInput.value, "secret-token");
assert.strictEqual(customerIdInput.value, "customer-123");
assert.strictEqual(pageSizeInput.value, "");
assert.strictEqual(result.filled, 2);

console.log("matching regression test passed");
