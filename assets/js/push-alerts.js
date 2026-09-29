/* Loaded Late — phone alerts: subscribe this device to Web Push.
 *
 * WHAT THIS DOES
 * The monitor page can only notify you while a tab is open and visible. Web Push
 * is the other half: the watcher (`tools/watcher.mjs`) encrypts an alert to a key
 * this browser holds, so the phone buzzes with the tab closed — and the push
 * service in between only ever sees ciphertext.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It cannot talk to the watcher. This site is static files on GitHub Pages; the
 * watcher runs on your own machine. So the flow is: subscribe here, copy the
 * resulting entry, paste it into the watcher's subscription store
 * (`WATCHER_PUSH_SUBSCRIPTIONS`), and the watcher sends to this device from then
 * on. The panel says that out loud rather than implying a connection exists.
 *
 * The state machine is separated from the DOM so `tools/push-alerts-test.mjs`
 * can drive every branch — supported, unsupported, insecure, unconfigured,
 * blocked, subscribed — with a stub browser and no network.
 */

(function (scope) {
  "use strict";

  const KEY_BYTES = 65; // uncompressed P-256 point
  const LABEL_LIMIT = 32;

  /** Decode base64url to bytes without assuming a browser (atob) or Node (Buffer). */
  function base64urlToBytes(value) {
    if (typeof value !== "string") return null;
    const text = value.trim().replace(/=+$/, "");
    if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
    if (typeof scope.atob === "function") {
      let raw;
      try {
        raw = scope.atob(text.replace(/-/g, "+").replace(/_/g, "/"));
      } catch (_) {
        return null;
      }
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      return bytes;
    }
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64url"));
    return null;
  }

  /** The browser's `applicationServerKey` value, or null if the configured key is unusable. */
  function applicationServerKey(publicKey) {
    const bytes = base64urlToBytes(publicKey);
    if (!bytes || bytes.length !== KEY_BYTES || bytes[0] !== 4) return null;
    return bytes;
  }

  const maskEndpoint = (endpoint) => {
    try {
      const url = new URL(String(endpoint));
      return `${url.host}/…${url.pathname.slice(-6)}`;
    } catch (_) {
      return "(this device)";
    }
  };

  const cleanLabel = (label) => {
    const text = String(label == null ? "" : label)
      .replace(/[\r\n\t]+/g, " ")
      .trim();
    return (text || "this-device").slice(0, LABEL_LIMIT);
  };

  /** The store entry a person pastes into their watcher's subscriptions array. */
  function subscriptionEntry(subscription, label) {
    if (!subscription || !subscription.endpoint || !subscription.keys) return "";
    return `${JSON.stringify(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        label: cleanLabel(label),
      },
      null,
      2,
    )}\n`;
  }

  /**
   * The whole panel as a state machine over an injected `browser`:
   *   { config, Notification, serviceWorker, PushManager, isSecureContext,
   *     isIos, isStandalone, registrationUrl }
   * Nothing here touches the network except the browser's own subscribe call.
   */
  function createController(browser) {
    const config = browser.config || {};
    const notificationApi = browser.Notification;
    const hasServiceWorker = Boolean(browser.serviceWorker && browser.serviceWorker.register);
    const hasPushManager = Boolean(browser.PushManager);
    const key = () => applicationServerKey(config.publicKey);
    const label = () => cleanLabel(browser.label ? browser.label() : "this-device");

    const supported = hasServiceWorker && hasPushManager && Boolean(notificationApi);

    /**
     * Find the service worker registration, and only create one when the caller
     * asks. Reporting the panel's state must not register a worker: merely
     * opening the page would otherwise install one, which is neither what the
     * visitor asked for nor what the panel claims ("nothing happens until you
     * press the button").
     */
    async function getRegistration({ create = false } = {}) {
      if (!supported) return null;
      const existing = browser.serviceWorker.getRegistration
        ? await browser.serviceWorker.getRegistration().catch(() => null)
        : null;
      if (existing || !create) return existing;
      return browser.serviceWorker.register(browser.registrationUrl || "sw.js", { scope: "./" });
    }

    async function currentSubscription() {
      if (!supported) return null;
      try {
        const registration = await getRegistration();
        return registration && registration.pushManager ? await registration.pushManager.getSubscription() : null;
      } catch (_) {
        return null; // a browser that cannot answer is treated as "not subscribed yet"
      }
    }

    /** Everything the panel needs to render, with no side effects. */
    async function describe() {
      if (!browser.isSecureContext)
        return {
          id: "insecure",
          tone: "warn",
          message:
            "Phone alerts need a secure (HTTPS) page. This copy is served over plain HTTP, so no browser will allow a subscription.",
        };
      if (!supported)
        return {
          id: "unsupported",
          tone: "warn",
          message:
            !hasServiceWorker || !hasPushManager
              ? "This browser has no Web Push support. Chrome, Edge, Firefox, and Safari 16.4+ (installed to the Home Screen on iPhone/iPad) do."
              : "This browser has no Notification support, so a push could not be shown.",
        };
      if (!key())
        return {
          id: "needs-config",
          tone: "warn",
          message:
            "No VAPID public key is configured yet. The person running the watcher must paste theirs into assets/js/vapid-config.js — until then nothing can subscribe.",
        };
      if (String(notificationApi.permission) === "denied")
        return {
          id: "blocked",
          tone: "warn",
          message:
            "Notifications are blocked for this site. Allow notifications in this browser's site settings, then reload this page — the panel cannot ask again while it is blocked.",
        };

      const subscription = await currentSubscription();
      if (subscription)
        return {
          id: "subscribed",
          tone: "ok",
          message:
            "This device is subscribed. Copy the entry below into the watcher's subscription store — the watcher cannot be reached from this page.",
          endpoint: subscription.endpoint,
          subscription,
        };

      return {
        id: "ready",
        tone: "ok",
        message:
          browser.isIos && !browser.isStandalone
            ? "On iPhone and iPad, add this page to the Home Screen first (Share → Add to Home Screen), then open it from there — Safari only delivers Web Push to installed sites."
            : "This device is not subscribed yet.",
      };
    }

    async function enable() {
      const before = await describe();
      if (["insecure", "unsupported", "needs-config", "blocked"].includes(before.id))
        return { ok: false, state: before, message: before.message };

      try {
        let permission = String(notificationApi.permission);
        if (permission === "default") permission = String(await notificationApi.requestPermission());
        if (permission !== "granted")
          return {
            ok: false,
            state: await describe(),
            message:
              permission === "denied"
                ? "Notification permission was denied. The panel cannot ask again while it is blocked; allow notifications in site settings and reload."
                : "Notification permission was not granted, so no alert could be shown.",
          };

        const registration = await getRegistration({ create: true });
        if (!registration) throw new Error("no service worker registration");
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key(),
        });
        return {
          ok: true,
          subscription,
          entry: subscriptionEntry(subscription, label()),
          endpoint: subscription.endpoint,
          state: await describe(),
        };
      } catch (error) {
        return {
          ok: false,
          state: await describe(),
          message: `Subscription failed: ${String(error?.message || error)}`,
        };
      }
    }

    async function disable() {
      const subscription = await currentSubscription();
      if (!subscription) return { ok: false, message: "This device is not subscribed." };
      try {
        const gone = await subscription.unsubscribe();
        return gone
          ? { ok: true, message: "This device is unsubscribed. Remove its entry from the watcher store too." }
          : { ok: false, message: "The browser refused to unsubscribe this device." };
      } catch (error) {
        return { ok: false, message: `Could not unsubscribe: ${String(error?.message || error)}` };
      }
    }

    return { supported, describe, enable, disable, subscriptionEntry, label };
  }

  /**
   * Wire the controller to the panel in index.html. Returns the controller (so a
   * caller can drive it) or null when the panel is not on this page.
   */
  function mount(document, browser) {
    const byId = (id) => document.getElementById(id);
    const panel = byId("phone-alerts");
    if (!panel) return null;

    const controller = createController({
      ...browser,
      label: () => byId("phone-alerts-label")?.value,
    });
    const status = byId("phone-alerts-status");
    const enableButton = byId("phone-alerts-enable");
    const disableButton = byId("phone-alerts-disable");
    const copyButton = byId("phone-alerts-copy");
    const output = byId("phone-alerts-output");
    const endpoint = byId("phone-alerts-endpoint");
    const iosNote = byId("phone-alerts-ios");

    const say = (stateId, message, tone) => {
      panel.setAttribute("data-state", stateId);
      if (status) {
        status.textContent = message;
        status.className = `push-status push-status-${tone || "ok"}`;
      }
    };

    // The current subscription, kept so the label can be changed without
    // re-subscribing (a subscription's label is only ever a local note).
    let current = null;

    async function render(extra) {
      const state = await controller.describe();
      current = state.subscription || null;
      say(state.id, extra || state.message, extra ? "warn" : state.tone);
      // The button is only shown when clicking it can actually do something.
      if (enableButton) enableButton.hidden = state.id !== "ready";
      if (disableButton) disableButton.hidden = state.id !== "subscribed";
      if (iosNote) iosNote.hidden = !(browser.isIos && !browser.isStandalone);
      if (output) {
        output.hidden = !current;
        output.value = current ? controller.subscriptionEntry(current, controller.label()) : "";
      }
      if (endpoint) endpoint.textContent = current ? maskEndpoint(current.endpoint) : "";
      return state;
    }

    if (enableButton)
      enableButton.addEventListener("click", async () => {
        enableButton.disabled = true;
        const result = await controller.enable();
        enableButton.disabled = false;
        await render(result.ok ? null : result.message);
      });

    if (disableButton)
      disableButton.addEventListener("click", async () => {
        disableButton.disabled = true;
        const result = await controller.disable();
        disableButton.disabled = false;
        await render(result.ok ? null : result.message);
      });

    // Injected in tests; in the browser this is navigator.clipboard, which can
    // itself refuse (insecure context, no permission) — hence the fallback.
    const clipboard =
      browser.clipboard || (typeof navigator !== "undefined" ? navigator.clipboard : null);

    if (copyButton)
      copyButton.addEventListener("click", async () => {
        const text = output ? output.value : "";
        if (!text) return;
        try {
          if (!clipboard || typeof clipboard.writeText !== "function")
            throw new Error("clipboard API unavailable");
          await clipboard.writeText(text);
          say("subscribed", "Entry copied. Paste it into the watcher's subscriptions array.", "ok");
        } catch (_) {
          // Clipboard access can be refused; selecting the text is the honest fallback.
          output.focus();
          output.select();
          say("subscribed", "Copying was blocked by the browser — the entry is selected, copy it manually.", "warn");
        }
      });

    const labelInput = byId("phone-alerts-label");
    if (labelInput)
      labelInput.addEventListener("input", () => {
        // Re-render from the real subscription: the label is a note on an entry
        // that already exists, never a reason to re-subscribe the device.
        if (output && current) output.value = controller.subscriptionEntry(current, controller.label());
      });

    // `rendered` resolves once the first render has settled, so a caller (or a
    // test) can wait for the panel to have said something rather than racing it.
    const rendered = render();
    return Object.assign(controller, { rendered, refresh: () => render() });
  }

  const api = {
    applicationServerKey,
    base64urlToBytes,
    createController,
    maskEndpoint,
    mount,
    subscriptionEntry,
  };

  scope.LoadedLatePush = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
