/* Loaded Late — service worker, present for exactly one reason: Web Push.
 *
 * A browser only lets a page receive Web Push through a service worker, and a
 * `push` event with no handler shows nothing at all (or a vague "site updated in
 * the background" line). This file turns the encrypted alert the watcher sends
 * into a real notification, and opens the official game page when it is tapped.
 *
 * It deliberately does NOT cache anything: no `fetch` handler, no offline copy
 * of the site. A stale page about a live game would be worse than no page, and
 * this project's whole claim is that what you see is what is happening now.
 *
 * The payload is JSON from tools/watcher.mjs:
 *   { title, body, url, tag, gamePk, observedAtIso }
 * Anything else is displayed as plain text rather than dropped, because a push
 * that arrives and shows nothing is indistinguishable from a broken system.
 */

const DEFAULT_TITLE = "BASES LOADED — tied, bottom 9+";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      payload = { body: event.data.text() };
    }
  }
  if (!payload || typeof payload !== "object") payload = { body: String(payload || "") };

  const title = payload.title || DEFAULT_TITLE;
  const options = {
    body: payload.body || "",
    tag: payload.tag || "loaded-late",
    renotify: true,
    requireInteraction: true,
    data: { url: payload.url || "" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;
  // Focus an existing tab for that game if there is one, otherwise open one.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
