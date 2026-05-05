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
  constructor(tagName, attrs = {}) {
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
  }

  get id() {
    return this.attrs.id || "";
  }

  get name() {
    return this.attrs.name || "";
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
  }

  get textContent() {
    return "";
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  closest() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return { width: 320, height: 180 };
  }

  dispatchEvent() {}
}

const requestBody = new FakeElement("textarea", {
  name: "request_body",
  value: `{
  "customer_id": "",
  "amount": 0,
  "active": false,
  "note": "keep me",
  "nested": {
    "api_key": "old"
  }
}`
});

const bodyWithoutMatchingProperty = new FakeElement("textarea", {
  name: "customer_id request body",
  value: `{
  "page_size": 25
}`
});

const invalidJsonBody = new FakeElement("textarea", {
  name: "customer_id request body",
  value: `{
  "customer_id": 
}`
});

const arrayRequestBody = new FakeElement("textarea", {
  name: "array_request_body",
  value: `[
  {
    "customer_id": "",
    "amount": 0
  }
]`
});

const fields = [requestBody, bodyWithoutMatchingProperty, invalidJsonBody, arrayRequestBody];

const document = {
  body: { textContent: "ReDoc", querySelectorAll: () => [] },
  documentElement: {},
  addEventListener() {},
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return fields;
  },
  getElementById() {
    return null;
  }
};

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

const unchangedBodyWithoutMatchingProperty = bodyWithoutMatchingProperty.value;
const unchangedInvalidJsonBody = invalidJsonBody.value;

const savedEntries = [
  {
    label: "Customer ID",
    aliases: "customer_id, customer id",
    value: "customer-123"
  },
  {
    label: "Amount",
    aliases: "amount",
    value: "42"
  },
  {
    label: "Active",
    aliases: "active",
    value: "true"
  },
  {
    label: "API Key",
    aliases: "api_key, x-api-key",
    value: "secret-token"
  }
];

const overwriteEnabledResult = context.window.__REDOC_AUTOFILL_TEST_API__.fillPage(
  savedEntries,
  {
    overwriteExisting: true,
    caseSensitive: false
  }
);

const parsedBody = JSON.parse(requestBody.value);
const parsedArrayBody = JSON.parse(arrayRequestBody.value);

assert.strictEqual(parsedBody.customer_id, "customer-123");
assert.strictEqual(parsedBody.amount, 42);
assert.strictEqual(parsedBody.active, true);
assert.strictEqual(parsedBody.note, "keep me");
assert.strictEqual(parsedBody.nested.api_key, "secret-token");
assert.strictEqual(parsedArrayBody[0].customer_id, "customer-123");
assert.strictEqual(parsedArrayBody[0].amount, 42);
assert.strictEqual(bodyWithoutMatchingProperty.value, unchangedBodyWithoutMatchingProperty);
assert.strictEqual(invalidJsonBody.value, unchangedInvalidJsonBody);
assert.strictEqual(overwriteEnabledResult.filled, 6);
assert.notStrictEqual(requestBody.value, "customer-123");

requestBody.value = `{
  "customer_id": "",
  "amount": 0,
  "active": false,
  "note": "keep me",
  "nested": {
    "api_key": "old"
  }
}`;

arrayRequestBody.value = `[
  {
    "customer_id": "",
    "amount": 0
  }
]`;

const overwriteDisabledResult = context.window.__REDOC_AUTOFILL_TEST_API__.fillPage(
  savedEntries,
  {
    overwriteExisting: false,
    caseSensitive: false
  }
);

const protectedBody = JSON.parse(requestBody.value);
const protectedArrayBody = JSON.parse(arrayRequestBody.value);

assert.strictEqual(protectedBody.customer_id, "customer-123");
assert.strictEqual(protectedBody.amount, 0);
assert.strictEqual(protectedBody.active, false);
assert.strictEqual(protectedBody.note, "keep me");
assert.strictEqual(protectedBody.nested.api_key, "old");
assert.strictEqual(protectedArrayBody[0].customer_id, "customer-123");
assert.strictEqual(protectedArrayBody[0].amount, 0);
assert.strictEqual(bodyWithoutMatchingProperty.value, unchangedBodyWithoutMatchingProperty);
assert.strictEqual(invalidJsonBody.value, unchangedInvalidJsonBody);
assert.strictEqual(overwriteDisabledResult.filled, 2);
assert.strictEqual(overwriteDisabledResult.skipped, 4);

console.log("request body json regression test passed");
