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

const STORAGE_KEY = "redocAutofillEntries";
const SETTINGS_KEY = "redocAutofillSettings";

const storedData = {
  [STORAGE_KEY]: {
    version: 2,
    sites: {
      "current.example.com": [
        {
          id: "current-token",
          label: "Current Token",
          aliases: "authorization",
          value: "current-token-value"
        }
      ],
      "other.example.com": [
        {
          id: "other-token",
          label: "Other Token",
          aliases: "authorization",
          value: "other-token-value"
        },
        {
          id: "other-customer",
          label: "Other Customer",
          aliases: "customer_id",
          value: "customer-42"
        }
      ]
    }
  },
  [SETTINGS_KEY]: {
    overwriteExisting: false,
    caseSensitive: false
  }
};

const document = {
  body: new FakeElement("body", "ReDoc"),
  documentElement: new FakeElement("html"),
  activeElement: null,
  addEventListener() {},
  createElement(tagName) {
    return new FakeElement(tagName);
  },
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
    host: "current.example.com",
    hostname: "current.example.com",
    href: "https://current.example.com/docs",
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
        async get(keys) {
          return keys.reduce((result, key) => {
            if (Object.prototype.hasOwnProperty.call(storedData, key)) {
              result[key] = storedData[key];
            }

            return result;
          }, {});
        },
        async set(update) {
          Object.assign(storedData, update);
        }
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

(async () => {
  const api = context.window.__REDOC_AUTOFILL_TEST_API__;
  await api.loadState();

  let snapshot = api.getStateSnapshot();
  assert.strictEqual(snapshot.currentSiteKey, "current.example.com");
  assert.strictEqual(snapshot.entries.length, 1);
  assert.strictEqual(snapshot.entries[0].value, "current-token-value");

  const reusableSites = api.getStoredSiteSummaries({ excludeCurrent: true });
  assert.strictEqual(reusableSites.length, 1);
  assert.strictEqual(reusableSites[0].key, "other.example.com");
  assert.strictEqual(reusableSites[0].count, 2);

  const copiedCount = await api.reuseEntriesFromSite("other.example.com");
  assert.strictEqual(copiedCount, 2);

  snapshot = api.getStateSnapshot();
  assert.strictEqual(snapshot.entries.length, 2);
  assert.strictEqual(snapshot.entries[0].label, "Other Token");
  assert.strictEqual(snapshot.entries[0].value, "other-token-value");
  assert.strictEqual(snapshot.entries[1].value, "customer-42");
  assert.notStrictEqual(snapshot.entries[0].id, "other-token");

  assert.strictEqual(storedData[STORAGE_KEY].version, 2);
  assert.strictEqual(storedData[STORAGE_KEY].sites["current.example.com"].length, 2);
  assert.strictEqual(storedData[STORAGE_KEY].sites["current.example.com"][0].value, "other-token-value");
  assert.strictEqual(storedData[STORAGE_KEY].sites["other.example.com"][0].value, "other-token-value");

  const unsupportedFlatEntries = api.normalizeStoredSiteEntries(
    [
      {
        id: "flat-token",
        label: "Flat Token",
        aliases: "authorization",
        value: "flat-token-value"
      }
    ]
  );

  assert.strictEqual(Object.keys(unsupportedFlatEntries).length, 0);

  console.log("site storage regression test passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
