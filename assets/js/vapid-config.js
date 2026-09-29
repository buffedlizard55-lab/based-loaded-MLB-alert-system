/* Loaded Late — the VAPID public key this site should subscribe devices with.
 *
 * WHY THIS FILE EXISTS
 * The watcher (`tools/watcher.mjs`) signs each notification with a VAPID key
 * pair so a push service will accept it. The browser must subscribe with the
 * *public* half of that same pair, so this file has to carry it. The site is
 * static (GitHub Pages), so there is nowhere for a server to tell the page the
 * key — it is written here once, by the person running the watcher.
 *
 * WHAT TO PUT HERE
 *   1. On the machine that runs the watcher:
 *        node tools/webpush.mjs --generate --write
 *   2. Copy the "Public key: …" line that prints (65-octet uncompressed P-256
 *      point, base64url, starts with "B").
 *   3. Paste it below, between the quotes, and commit this file.
 *
 * Until a key is pasted, the phone-alerts panel on the site says so plainly and
 * cannot subscribe anything — it never pretends to be working.
 *
 * SECURITY
 * This is a public key. It is safe to publish: it is exactly what the browser
 * sends to the push service. The matching private key is in the key file the
 * watcher reads (`WATCHER_VAPID_KEYS`) and must never be committed.
 */

window.LOADED_LATE_VAPID_PUBLIC_KEY = "";
