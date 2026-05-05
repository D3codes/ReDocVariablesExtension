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
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.ownText = text;
    this.classList = {
      add() {},
      remove() {}
    };
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

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return { width: 120, height: 24 };
  }
}

class FakeRow {
  constructor(id, fields) {
    this.dataset = { entryId: id };
    this.fields = fields;
  }

  querySelector(selector) {
    const match = selector.match(/\[data-field='([^']+)'\]/);
    const fieldName = match?.[1];

    if (!fieldName) {
      return null;
    }

    return { value: this.fields[fieldName] || "" };
  }
}

const document = {
  body: new FakeElement("body", "ReDoc"),
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
  location: {
    host: "docs.example.com",
    hostname: "docs.example.com",
    href: "https://docs.example.com",
    protocol: "https:"
  },
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

const api = context.window.__REDOC_AUTOFILL_TEST_API__;
const rows = [
  new FakeRow("api-key", {
    label: " API Key ",
    aliases: " x-api-key, authorization ",
    value: "secret-token"
  }),
  new FakeRow("customer-id", {
    label: "Customer ID",
    aliases: "customer_id",
    value: "customer-123"
  }),
  new FakeRow("empty", {
    label: "",
    aliases: "",
    value: ""
  })
];

const entriesForRerender = api.readEntriesFromRows(rows, { includeEmpty: true });
assert.strictEqual(entriesForRerender.length, 3);
assert.strictEqual(entriesForRerender[0].label, "API Key");
assert.strictEqual(entriesForRerender[0].aliases, "x-api-key, authorization");
assert.strictEqual(entriesForRerender[0].value, "secret-token");
assert.strictEqual(entriesForRerender[1].value, "customer-123");
assert.strictEqual(entriesForRerender[2].id, "empty");

const entriesForSave = api.readEntriesFromRows(rows);
assert.strictEqual(entriesForSave.length, 2);
assert.strictEqual(entriesForSave[0].id, "api-key");
assert.strictEqual(entriesForSave[1].id, "customer-id");

const entriesAfterAdd = [
  ...api.readEntriesFromRows(rows, { includeEmpty: true }),
  api.createBlankEntry()
];

assert.strictEqual(entriesAfterAdd.length, 4);
assert.strictEqual(entriesAfterAdd[0].value, "secret-token");
assert.strictEqual(entriesAfterAdd[1].value, "customer-123");
assert.strictEqual(entriesAfterAdd[3].label, "");

console.log("modal entry form regression test passed");
