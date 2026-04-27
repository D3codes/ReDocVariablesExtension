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
    this.dataset = {};
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

  append(child) {
    child.parentElement = this;
    this.children.push(child);
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

  cloneNode() {
    return new FakeElement(this.tagName, this.attrs, this.textContent);
  }

  getBoundingClientRect() {
    return { width: 120, height: 24 };
  }
}

const document = {
  body: new FakeElement("body", {}, "ReDoc"),
  documentElement: new FakeElement("html"),
  addEventListener() {},
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
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
    return {
      display: "block",
      fontSize: "13px",
      lineHeight: "18px",
      paddingTop: "0px",
      visibility: "visible"
    };
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

const api = context.window.__REDOC_AUTOFILL_TEST_API__;
const properties = api.extractResponseProperties(`{
  "token": "abc123",
  "customer_id": 42,
  "profile": {
    "email": "person@example.com"
  },
  "active": true
}`);

assert.strictEqual(
  JSON.stringify(properties.map((property) => [property.key, property.value])),
  JSON.stringify([
    ["token", "abc123"],
    ["customer_id", "42"],
    ["profile", '{\n  "email": "person@example.com"\n}'],
    ["email", "person@example.com"],
    ["active", "true"]
  ])
);

const entry = api.createEntryFromResponseProperty(properties[0]);
assert.strictEqual(entry.label, "token");
assert.strictEqual(entry.aliases, "token");
assert.strictEqual(entry.value, "abc123");

const customizedEntry = api.createEntryFromResponseProperty(properties[0], {
  id: "existing-token",
  label: "Access Token",
  aliases: "access_token, token"
});
assert.strictEqual(customizedEntry.id, "existing-token");
assert.strictEqual(customizedEntry.label, "Access Token");
assert.strictEqual(customizedEntry.aliases, "access_token, token");
assert.strictEqual(customizedEntry.value, "abc123");

const updatedEntries = api.applyResponseCaptureEntry(
  [
    {
      id: "existing-token",
      label: "Old Token",
      aliases: "old_token",
      value: "stale"
    },
    {
      id: "keep-me",
      label: "Customer",
      aliases: "customer_id",
      value: "customer-1"
    }
  ],
  properties[0],
  {
    targetId: "existing-token",
    label: "Access Token",
    aliases: "access_token, token"
  }
);

assert.strictEqual(updatedEntries.length, 2);
assert.strictEqual(updatedEntries[0].id, "existing-token");
assert.strictEqual(updatedEntries[0].label, "Access Token");
assert.strictEqual(updatedEntries[0].aliases, "access_token, token");
assert.strictEqual(updatedEntries[0].value, "abc123");
assert.strictEqual(updatedEntries[1].value, "customer-1");

const arrayProperties = api.extractResponseProperties(`[
  {
    "item_id": "item-1"
  }
]`);

assert.strictEqual(arrayProperties.length, 1);
assert.strictEqual(arrayProperties[0].key, "item_id");
assert.strictEqual(arrayProperties[0].value, "item-1");

console.log("response property save test passed");
