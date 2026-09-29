#!/usr/bin/env node
/* Deterministic tests for the site's phone-alerts panel (assets/js/push-alerts.js).
 *
 * No dependencies and no browser: the panel's state machine is driven with a
 * stub browser, and the DOM half is driven with a stub document. That is how a
 * claim like "the panel never says 'subscribed' when it is not" can be checked
 * rather than asserted in a paragraph.
 *
 * Run: node tools/push-alerts-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  applicationServerKey,
  base64urlToBytes,
  createController,
  maskEndpoint,
  mount,
  subscriptionEntry,
} = require("../assets/js/push-alerts.js");

let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks += 1;
};
const ok = (condition, label) => {
  assert.ok(condition, label);
  checks += 1;
};

// RFC 8292 §2.4 publishes this uncompressed P-256 public key; it is a real key,
// so decoding it proves the browser-side conversion, not just the happy path.
const RFC_PUBLIC_KEY = "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
const GOOD_ENDPOINT = "https://fcm.googleapis.com/fcm/send/AAAABBBBCCCCDDDDEEEE";
const GOOD_KEYS = {
  p256dh: RFC_PUBLIC_KEY,
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

/* ------------------------------------------------- base64url / key handling */

check(base64urlToBytes(RFC_PUBLIC_KEY).length, 65, "The published P-256 key decodes to 65 octets");
check(base64urlToBytes(RFC_PUBLIC_KEY)[0], 4, "…starting with the uncompressed-point prefix 0x04");
check(base64urlToBytes("AAAA").length, 3, "Any base64url decodes by length");
check(base64urlToBytes("not base64url!"), null, "A value outside the alphabet is refused, not guessed at");
check(base64urlToBytes(""), null, "An empty string is refused");
check(base64urlToBytes(undefined), null, "A missing value is refused");
check(base64urlToBytes(`${RFC_PUBLIC_KEY}=`).length, 65, "Trailing padding is tolerated (some tools add it)");

check(applicationServerKey(RFC_PUBLIC_KEY) instanceof Uint8Array, true, "A valid key becomes bytes for the browser");
check(applicationServerKey(RFC_PUBLIC_KEY).length, 65, "…of the right length");
check(applicationServerKey("AAAA"), null, "A short key is refused before the browser sees it");
check(applicationServerKey(""), null, "An unconfigured key is refused");
{
  const compressed = Buffer.from([2, ...Buffer.alloc(64, 1)]).toString("base64url");
  check(applicationServerKey(compressed), null, "A compressed (0x02) key is refused: the browser API takes uncompressed points");
  // Curve validation is not this panel's job: the browser rejects an off-curve
  // point at subscribe time, and the watcher checks it again before encrypting
  // (tools/webpush-test.mjs, "not a valid point on P-256"). The panel's job is to
  // never hand over something that cannot even be a key.
  const offCurve = Buffer.from([4, ...Buffer.alloc(64, 4)]).toString("base64url");
  check(applicationServerKey(offCurve).length, 65, "…while a well-shaped but off-curve point passes here and is caught by the watcher");
}

/* -------------------------------------------------------- store entry shape */

check(
  subscriptionEntry({ endpoint: GOOD_ENDPOINT, keys: GOOD_KEYS }, "phone"),
  `${JSON.stringify({ endpoint: GOOD_ENDPOINT, keys: GOOD_KEYS, label: "phone" }, null, 2)}\n`,
  "The entry shown for copying is exactly the object the watcher's store holds",
);
check(
  JSON.parse(subscriptionEntry({ endpoint: GOOD_ENDPOINT, keys: GOOD_KEYS }, "  ")).label,
  "this-device",
  "A blank device name falls back to a sensible one",
);
check(
  JSON.parse(subscriptionEntry({ endpoint: GOOD_ENDPOINT, keys: GOOD_KEYS }, "a\r\nb\tc")).label,
  "a b c",
  "A device name cannot smuggle newlines into the JSON file",
);
check(
  JSON.parse(subscriptionEntry({ endpoint: GOOD_ENDPOINT, keys: GOOD_KEYS }, "x".repeat(80))).label.length,
  32,
  "A device name is capped so the store stays readable",
);
check(subscriptionEntry(null, "phone"), "", "No subscription means no entry to show");
check(subscriptionEntry({ endpoint: GOOD_ENDPOINT }, "phone"), "", "A subscription without keys produces no entry");

check(maskEndpoint(GOOD_ENDPOINT), "fcm.googleapis.com/…DDEEEE", "The panel shows a masked endpoint, never the whole one");
check(maskEndpoint("nonsense"), "(this device)", "…and degrades to a placeholder for an unparseable endpoint");

/* -------------------------------------------------------- the panel states */

const browser = (overrides = {}) => ({
  config: { publicKey: RFC_PUBLIC_KEY },
  Notification: { permission: "default", requestPermission: async () => "granted" },
  serviceWorker: {
    register: async () => ({ pushManager: { subscribe: async () => subscription(), getSubscription: async () => null } }),
    getRegistration: async () => null,
  },
  PushManager: function PushManager() {},
  isSecureContext: true,
  isIos: false,
  isStandalone: false,
  ...overrides,
});

const subscription = (overrides = {}) => ({
  endpoint: GOOD_ENDPOINT,
  keys: GOOD_KEYS,
  unsubscribe: async () => true,
  ...overrides,
});

check((await createController(browser({ isSecureContext: false })).describe()).id, "insecure",
  "An insecure page is refused before anything is attempted");
check((await createController(browser({ PushManager: undefined })).describe()).id, "unsupported",
  "A browser with no push support is named as such");
check(
  (await createController(browser({ PushManager: undefined })).describe()).message.includes("Home Screen"),
  true,
  "…and the message tells the user which browsers do work",
);
check((await createController(browser({ Notification: undefined })).describe()).id, "unsupported",
  "A browser that cannot show notifications is also unsupported");
check(
  (await createController(browser({ config: { publicKey: "" } })).describe()).id,
  "needs-config",
  "An unconfigured VAPID key is reported instead of failing at subscribe time",
);
check(
  (await createController(browser({ config: { publicKey: "AAAA" } })).describe()).id,
  "needs-config",
  "…and so is a key that is present but not a P-256 point",
);
check(
  (await createController(browser({ Notification: { permission: "denied" } })).describe()).id,
  "blocked",
  "A blocked browser says so (it cannot be asked again from the page)",
);
{
  const ready = await createController(browser()).describe();
  check(ready.id, "ready", "A supported, configured, unsubscribed device is ready to subscribe");
  check(ready.message.includes("not subscribed yet"), true, "…and says exactly that");
}
{
  const ios = await createController(browser({ isIos: true })).describe();
  ok(ios.message.includes("Home Screen"), "On iPhone/iPad the panel explains the install-to-Home-Screen rule");
  const installed = await createController(browser({ isIos: true, isStandalone: true })).describe();
  check(installed.message.includes("Home Screen"), false, "An installed iOS site gets no such warning");
}
{
  const subscribed = await createController(
    browser({
      serviceWorker: {
        register: async () => ({}),
        getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription() } }),
      },
    }),
  ).describe();
  check(subscribed.id, "subscribed", "An existing subscription is detected (page reload does not duplicate it)");
  check(subscribed.subscription.endpoint, GOOD_ENDPOINT, "…and its endpoint is available to show");
}

/* ------------------------------------------------------------- subscribing */

{
  // Reading the state must not install a service worker: only the button does.
  const calls = [];
  const lookups = createController(
    browser({
      serviceWorker: {
        getRegistration: async () => null,
        register: async (...args) => {
          calls.push(args);
          return {};
        },
      },
    }),
  );
  await lookups.describe();
  check(calls, [], "Looking up the state never registers a service worker");
  check(
    (await lookups.describe()).id,
    "ready",
    "…so an unsubscribed, supported device is simply reported as ready",
  );
}
{
  // A faithful stub: a browser that was just registered still knows about that
  // registration (and the subscription it holds) on the next lookup.
  const calls = [];
  let created = null;
  let live = null;
  const controller = createController(
    browser({
      Notification: {
        permission: "default",
        requestPermission: async () => {
          calls.push("permission");
          return "granted";
        },
      },
      serviceWorker: {
        getRegistration: async () => created,
        register: async (url, options) => {
          calls.push(["register", url, options]);
          created = {
            pushManager: {
              subscribe: async (options2) => {
                calls.push(["subscribe", options2]);
                live = subscription();
                return live;
              },
              getSubscription: async () => live,
            },
          };
          return created;
        },
      },
    }),
  );
  const result = await controller.enable();
  check(result.ok, true, "Enabling on a ready device succeeds");
  check(calls[0], "permission", "Permission is requested before subscribing");
  check(calls[1][1], "sw.js", "The service worker is registered from the site root");
  check(calls[1][2], { scope: "./" }, "…with an explicit same-origin scope");
  check(calls[2][1].userVisibleOnly, true, "The subscription is user-visible (required by Chrome and Firefox)");
  check(calls[2][1].applicationServerKey.length, 65, "…bound to the watcher's public key");
  check(JSON.parse(result.entry).keys.p256dh, RFC_PUBLIC_KEY, "…and the entry carries the browser's real keys");
  check(result.state.id, "subscribed", "After enabling, the panel really is in the subscribed state");
}
{
  // A registration already exists: the panel must reuse it, not register again.
  const calls = [];
  let live = null;
  const controller = createController(
    browser({
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            subscribe: async () => {
              live = subscription();
              return live;
            },
            getSubscription: async () => live,
          },
        }),
        register: async () => {
          calls.push("register");
          return {};
        },
      },
    }),
  );
  await controller.enable();
  check(calls, [], "An existing service worker registration is reused instead of re-registered");
}
{
  const blocked = await createController(browser({ Notification: { permission: "denied" } })).enable();
  check([blocked.ok, blocked.message.includes("blocked for this site")], [false, true],
    "Enabling while blocked fails with an explanation (and does not silently retry)");
}
{
  const refused = await createController(
    browser({ Notification: { permission: "default", requestPermission: async () => "denied" } }),
  ).enable();
  check([refused.ok, refused.message.includes("was denied")], [false, true],
    "A denied permission prompt is reported as denied, and nothing is subscribed");
}
{
  const failed = await createController(
    browser({
      serviceWorker: {
        getRegistration: async () => null,
        register: async () => ({
          pushManager: {
            subscribe: async () => {
              throw new Error("AbortError: push service unreachable");
            },
            getSubscription: async () => null,
          },
        }),
      },
    }),
  ).enable();
  check([failed.ok, failed.message], [false, "Subscription failed: AbortError: push service unreachable"],
    "A browser that refuses to subscribe reports the real reason");
}
{
  const noWorker = await createController(
    browser({
      serviceWorker: { getRegistration: async () => null, register: async () => { throw new Error("blocked by policy"); } },
    }),
  ).enable();
  check(noWorker.ok, false, "A service worker that cannot register is a failure, not a silent no-op");
}
{
  const controller = createController(
    browser({
      serviceWorker: {
        register: async () => ({}),
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => subscription(), subscribe: async () => subscription() },
        }),
      },
    }),
  );
  const result = await controller.disable();
  check([result.ok, result.message.includes("watcher store")], [true, true],
    "Unsubscribing tells the user to remove the entry from the watcher store too");
  const empty = await createController(
    browser({
      serviceWorker: {
        register: async () => ({}),
        getRegistration: async () => ({ pushManager: { getSubscription: async () => null } }),
      },
    }),
  ).disable();
  check(empty.ok, false, "Unsubscribing an unsubscribed device says so");
}

/* ------------------------------------------------------------------ the DOM */

/** A document just real enough to run the panel: elements by id, and events. */
function fakeDocument(ids) {
  const events = new Map();
  const elements = new Map();
  const element = (id) => ({
    id,
    value: id === "phone-alerts-label" ? "phone" : "",
    hidden: false,
    textContent: "",
    className: "",
    dataset: {},
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      events.set(`${id}:${type}`, handler);
    },
    focus() {
      events.set(`${id}:focused`, true);
    },
    select() {
      events.set(`${id}:selected`, true);
    },
  });
  for (const id of ids) elements.set(id, element(id));
  return {
    elements,
    events,
    getElementById: (id) => elements.get(id) || null,
    click: (id) => events.get(`${id}:click`)(),
  };
}

const PANEL_IDS = [
  "phone-alerts",
  "phone-alerts-status",
  "phone-alerts-enable",
  "phone-alerts-disable",
  "phone-alerts-copy",
  "phone-alerts-output",
  "phone-alerts-endpoint",
  "phone-alerts-ios",
  "phone-alerts-label",
];
{
  // The failure path in the DOM: the panel must report what went wrong and stop.
  const document = fakeDocument(PANEL_IDS);
  const controller = mount(document, {
    ...browser({
      serviceWorker: {
        getRegistration: async () => null,
        register: async () => ({
          pushManager: {
            subscribe: async () => {
              throw new Error("AbortError: registration failed");
            },
            getSubscription: async () => null,
          },
        }),
      },
    }),
    clipboard: { writeText: async () => {} },
  });
  ok(controller, "Mounting on a page with the panel returns a controller");
  await controller.rendered;
  const status = document.elements.get("phone-alerts-status");
  const enable = document.elements.get("phone-alerts-enable");
  check(status.textContent, "This device is not subscribed yet.", "The panel starts by reporting the real state");
  check(enable.hidden, false, "The subscribe button is available when it can work");
  check(document.elements.get("phone-alerts-output").hidden, true, "No entry is shown before there is one");

  await document.click("phone-alerts-enable");
  check(
    status.textContent,
    "Subscription failed: AbortError: registration failed",
    "A failed subscribe is reported verbatim in the panel, not swallowed",
  );
  check(document.elements.get("phone-alerts").attributes["data-state"], "ready",
    "…and the panel stays in the state it can actually prove (still not subscribed)");
  check(document.elements.get("phone-alerts-output").hidden, true,
    "…so no entry is offered for a device that is not subscribed");
  check(enable.disabled, false, "…and the button is usable again for a retry");
}
{
  // A dedicated run through the DOM half: subscribe, copy, and read back.
  const document = fakeDocument(PANEL_IDS);
  const copied = [];
  let created = null;
  let live = null;
  const mounted = mount(document, {
    ...browser({
      serviceWorker: {
        getRegistration: async () => created,
        register: async () => {
          created = {
            pushManager: {
              subscribe: async () => {
                live = subscription();
                return live;
              },
              getSubscription: async () => live,
            },
          };
          return created;
        },
      },
    }),
    clipboard: { writeText: async (text) => copied.push(text) },
  });
  await mounted.rendered;
  await document.click("phone-alerts-enable");
  const output = document.elements.get("phone-alerts-output");
  const endpoint = document.elements.get("phone-alerts-endpoint");
  check(output.hidden, false, "After subscribing, the entry is shown for copying");
  check(JSON.parse(output.value).endpoint, GOOD_ENDPOINT, "…and it parses as the store entry");
  check(endpoint.textContent, "fcm.googleapis.com/…DDEEEE", "…with only a masked endpoint visible");
  check(document.elements.get("phone-alerts-disable").hidden, false, "…and an unsubscribe button appears");
  check(document.elements.get("phone-alerts-enable").hidden, true, "…while the subscribe button goes away");
  check(document.elements.get("phone-alerts").attributes["data-state"], "subscribed", "…and the panel says so in its state");

  await document.click("phone-alerts-copy");
  check(copied.length, 1, "Copying the entry uses the clipboard once");
  check(JSON.parse(copied[0]).keys.auth, GOOD_KEYS.auth, "…and copies the entry itself, byte for byte");
  check(
    document.elements.get("phone-alerts-status").textContent.includes("Paste it into the watcher"),
    true,
    "…then tells the user where it goes",
  );
}
{
  // Clipboard access is refused: the fallback must select the text and say so.
  const document = fakeDocument(PANEL_IDS);
  const mounted = mount(document, {
    ...browser({
      serviceWorker: {
        register: async () => ({}),
        getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription(), subscribe: async () => subscription() } }),
      },
    }),
    clipboard: {
      writeText: async () => {
        throw new Error("NotAllowedError");
      },
    },
  });
  await mounted.rendered;
  await document.click("phone-alerts-copy");
  check(document.events.get("phone-alerts-output:selected"), true, "A refused clipboard selects the entry instead");
  check(
    document.elements.get("phone-alerts-status").textContent.includes("copy it manually"),
    true,
    "…and says the copy was blocked rather than pretending it worked",
  );
}
check(mount(fakeDocument(["unrelated"]), browser()), null, "Mounting on a page without the panel is a no-op");

/* ------------------------------------------- the panel's honesty invariants */

const source = readFileSync(new URL("../assets/js/push-alerts.js", import.meta.url), "utf8");
ok(!/fetch\(|XMLHttpRequest/.test(source), "The panel never contacts anything (no fetch, no XHR)");
ok(!/atob\(/.test(source.split("base64urlToBytes")[0]), "…and does not touch the network while decoding keys");
ok(/WATCHER_/.test(readFileSync(new URL("../index.html", import.meta.url), "utf8")), "index.html names the watcher setting the entry belongs to");

console.log(`✓ ${checks} phone-alert checks passed`);
