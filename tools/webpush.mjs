#!/usr/bin/env node
/**
 * Web Push (RFC 8030) message encryption (RFC 8291) and VAPID authentication
 * (RFC 8292) — dependency-free, using only Node's built-in crypto.
 *
 * Why this exists: the watcher can already deliver through a webhook or ntfy.
 * Web Push is the one channel that reaches a phone *without a third party in
 * the middle of your alert content* — the notification is encrypted to a key
 * only your browser holds, and the push service only sees ciphertext.
 *
 * What the browser does (this file is the other half):
 *   the page subscribes with `pushManager.subscribe({ applicationServerKey })`
 *   and hands the watcher the subscription it produces — an `endpoint` plus the
 *   receiver's `p256dh` and `auth` values. The watcher then encrypts each alert
 *   to that public key and signs the request with its VAPID key.
 *
 * Correctness is not assumed: every derivation here is checked in
 * `tools/webpush-test.mjs` against the published test vectors in RFC 8291
 * (section 5 and Appendix A) and RFC 8292 (section 2.4), including the
 * intermediate values and the full 144-octet message body.
 *
 * Command line (setup helper):
 *   node tools/webpush.mjs --generate          print a fresh VAPID key pair
 *   node tools/webpush.mjs --generate --write  …and save it to the keys file
 *   node tools/webpush.mjs --public            print the configured public key
 *
 * Note on the RFC's Content-Length: RFC 8291 section 5 shows
 * "Content-Length: 145" for an example whose published header (86 octets) and
 * published ciphertext-plus-tag (58 octets) total 144. Decoding the published
 * body gives 144 bytes, so the example's Content-Length is an off-by-one in the
 * RFC; the vectors below use the decoded bytes, which are internally consistent
 * (salt 16 + rs 4 + idlen 1 + keyid 65 + record 58).
 */

import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign as cryptoSign,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const CURVE = "prime256v1"; // NIST P-256
const PUSH_INFO = Buffer.from("WebPush: info\0", "utf8");
const CEK_INFO = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
const NONCE_INFO = Buffer.from("Content-Encoding: nonce\0", "utf8");
/**
 * The record size we advertise in the header and the budget for the whole
 * request body. RFC 8188 §2.1 defines `rs` as the record size; push services
 * are not obliged to accept bodies larger than 4096 octets, and this one is the
 * value every shipping implementation uses.
 */
export const RECORD_SIZE = 4096;
/** salt(16) + rs(4) + idlen(1) + keyid(65): fixed-size header, RFC 8188 §2.1. */
export const HEADER_SIZE = 86;
/**
 * The largest plaintext we will encrypt, in octets.
 *
 * 4096 = 86 header + plaintext + 1 padding delimiter + 16 auth tag, so with no
 * extra padding the largest plaintext is 4096 - 103 = 3993. Pushing back the
 * record size instead of truncating the message would mean the receiver gets a
 * message it cannot reassemble from a single record, which RFC 8291 §4 rules out.
 */
export const MAX_PAYLOAD = RECORD_SIZE - HEADER_SIZE - 1 - 16;

/* ------------------------------------------------------------- base64url -- */

export const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

export function fromB64url(value, label = "value") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value))
    throw new Error(`${label} is not base64url`);
  const buffer = Buffer.from(value.replace(/=+$/, ""), "base64url");
  // Buffer.from is lenient; re-encoding proves the input was canonical.
  if (b64url(buffer) !== value.replace(/=+$/, ""))
    throw new Error(`${label} is not canonical base64url`);
  return buffer;
}

/** The slice of node:fs this module needs; injectable so tests can be hermetic. */
const NODE_FS = { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync };

/* -------------------------------------------------------------- key pairs -- */

/** A fresh VAPID signing key pair, base64url, with the public key in X9.62 form. */
export function generateVapidKeys() {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()), // 65-octet uncompressed point (RFC 8292 §3.2)
    privateKey: b64url(ecdh.getPrivateKey()),
  };
}

/* P-256 (secp256r1) domain parameters, as published in SEC 2 §2.4.1 / FIPS 186-4.
   y^2 = x^3 + a*x + b  (mod p),  a = p - 3 */
const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_A = P256_P - 3n;
const P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const mod = (value, modulus) => {
  const reduced = value % modulus;
  return reduced < 0n ? reduced + modulus : reduced;
};

/**
 * Is (x, y) a point on P-256?
 *
 * RFC 8291 §7 puts this obligation on the application — "Failure to validate a
 * public key can allow an attacker to extract a private key from an application
 * server" — and it is checked here with explicit modular arithmetic rather than
 * delegated to the crypto library. Node 22 does reject the off-curve points we
 * tried (see tools/webpush-test.mjs), so this is defence in depth, not a fix for
 * a known library gap: it keeps the guarantee visible in this module, works
 * regardless of the OpenSSL build underneath, and enforces the field range too.
 */
export function isOnCurveP256(x, y) {
  if (typeof x !== "bigint" || typeof y !== "bigint") return false;
  if (x < 0n || y < 0n || x >= P256_P || y >= P256_P) return false; // field range
  return mod(y * y, P256_P) === mod(x * x * x + P256_A * x + P256_B, P256_P);
}

const bigIntFromOctets = (octets) => BigInt(`0x${octets.toString("hex")}`);

/** A structurally valid, on-curve, uncompressed P-256 point? */
export const isValidPublicKey = (publicKey) => {
  try {
    const raw = fromB64url(publicKey, "public key");
    return raw.length === 65 && raw[0] === 4 && assertP256Key(publicKey, "public key").length === 65;
  } catch (_) {
    return false;
  }
};

/**
 * Validate that a key really is a point on P-256 before using it, and return the
 * raw 65 octets. Throws with a message that names the offending field so a bad
 * subscription is diagnosable from the watcher log.
 */
export function assertP256Key(publicKey, label) {
  const raw = fromB64url(publicKey, label);
  if (raw.length !== 65 || raw[0] !== 4)
    throw new Error(`${label} must be a 65-octet uncompressed P-256 point`);
  const x = bigIntFromOctets(raw.subarray(1, 33));
  const y = bigIntFromOctets(raw.subarray(33, 65));
  if (!isOnCurveP256(x, y)) throw new Error(`${label} is not a valid point on P-256`);
  return raw;
}

/**
 * Turn a base64url VAPID private key into a KeyObject that can sign the JWT.
 *
 * Three things are checked that a plain JWK import does not check usefully:
 * the scalar is in [1, n-1] (0 and n are both rejected), the matching public key
 * is on the curve, and the public key really is this private key's public key.
 * A mismatched pair would otherwise sail through and then be rejected by the
 * push service as a 401 with no hint of why.
 */
export function assertVapidPair(privateKey, publicKey, label = "VAPID private key") {
  const d = fromB64url(privateKey, label);
  if (d.length !== 32) throw new Error(`${label} must be 32 octets`);
  const scalar = bigIntFromOctets(d);
  if (scalar < 1n || scalar >= P256_N)
    throw new Error(`${label} must be a scalar in [1, n-1] for P-256`);
  const raw = assertP256Key(publicKey, "VAPID public key");
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(d);
  if (!ecdh.getPublicKey().equals(raw))
    throw new Error("VAPID public key does not match the VAPID private key");
  return { privateKey: d, publicKey: raw };
}

/** Load and validate a VAPID key file, or throw with a reason a human can act on. */
export function readVapidKeys(file, fs = NODE_FS) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read VAPID keys from ${file} (${error.message})`);
  }
  if (!parsed || typeof parsed !== "object" || !parsed.publicKey || !parsed.privateKey)
    throw new Error(`${file} must contain publicKey and privateKey (run: node tools/webpush.mjs --generate --write)`);
  assertVapidPair(parsed.privateKey, parsed.publicKey, `VAPID private key in ${file}`);
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

export function privateKeyObject(privateKey, publicKey, label = "VAPID private key") {
  const { privateKey: d, publicKey: raw } = assertVapidPair(privateKey, publicKey, label);
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64url(d),
      x: b64url(raw.subarray(1, 33)),
      y: b64url(raw.subarray(33, 65)),
    },
    format: "jwk",
  });
}

/* -------------------------------------------------------- message encryption */

/**
 * Encrypt one push message for one subscription (RFC 8291 §3.4).
 *
 * The salt, the application-server key pair and the padding are injectable so
 * the RFC test vectors can be reproduced exactly; in production they are fresh
 * per message (a new key pair per message is what the RFC prescribes, and it
 * costs nothing at these volumes).
 *
 * Returns the bytes to POST plus the headers that describe them.
 */
export function encryptPayload(plaintext, subscription, options = {}) {
  const text = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext);
  const keys = subscription?.keys || {};
  const uaPublic = assertP256Key(keys.p256dh, "subscription p256dh");
  const authSecret = fromB64url(keys.auth, "subscription auth");
  if (authSecret.length !== 16)
    throw new Error("subscription auth must be 16 octets (RFC 8291 §3.2)");

  const padding = Math.max(0, Number.isFinite(Number(options.padding)) ? Number(options.padding) : 0);
  const recordSize = Number.isFinite(Number(options.recordSize)) ? Number(options.recordSize) : RECORD_SIZE;
  const body = Buffer.concat([text, Buffer.from([2]), Buffer.alloc(padding)]); // 0x02 delimiter
  // Three separate budgets, checked separately so the error names the real
  // culprit: the plaintext the caller supplied, the RFC 8188 record rule, and
  // the whole-body budget a push service will accept.
  if (text.length > MAX_PAYLOAD)
    throw new Error(`payload is ${text.length} octets; the limit is ${MAX_PAYLOAD}`);
  if (body.length + 16 >= recordSize)
    throw new Error(`plaintext + padding + tag must be smaller than the record size (${recordSize})`);
  if (HEADER_SIZE + body.length + 16 > RECORD_SIZE)
    throw new Error(
      `the encrypted body would be ${HEADER_SIZE + body.length + 16} octets; a push service accepts ${RECORD_SIZE}`,
    );

  const salt = options.salt
    ? Buffer.from(options.salt)
    : randomBytes(16);
  if (salt.length !== 16) throw new Error("salt must be 16 octets");

  const server = createECDH(CURVE);
  if (options.serverKeys?.privateKey) server.setPrivateKey(fromB64url(options.serverKeys.privateKey, "server private key"));
  else server.generateKeys();
  const asPublic = options.serverKeys?.publicKey
    ? assertP256Key(options.serverKeys.publicKey, "server public key")
    : server.getPublicKey();
  if (!Buffer.from(server.getPublicKey()).equals(asPublic))
    throw new Error("server public key does not match the server private key");

  const ecdhSecret = server.computeSecret(uaPublic);

  // PRK_key = HKDF-Extract(salt=auth_secret, IKM=ecdh_secret)
  // IKM     = HKDF-Expand(PRK_key, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const ikm = Buffer.from(
    hkdfSync("sha256", ecdhSecret, authSecret, Buffer.concat([PUSH_INFO, uaPublic, asPublic]), 32),
  );
  // CEK   = HKDF-Expand(HKDF-Extract(salt, IKM), "Content-Encoding: aes128gcm" || 0x00, 16)
  // NONCE = HKDF-Expand(HKDF-Extract(salt, IKM), "Content-Encoding: nonce" || 0x00, 12)
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, CEK_INFO, 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, NONCE_INFO, 12));

  // Header: salt(16) || rs(4, big-endian) || idlen(1) || keyid(idlen)  [RFC 8188 §2.1]
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(asPublic.length, 20);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);

  return {
    body: Buffer.concat([header, asPublic, ciphertext]),
    header: Buffer.concat([header, asPublic]),
    salt,
    serverKeys: { publicKey: b64url(asPublic), privateKey: b64url(server.getPrivateKey()) },
    cek,
    nonce,
    ikm,
    ecdhSecret,
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
  };
}

/**
 * The whole derivation chain, exposed so the RFC 8291 Appendix A intermediate
 * values can be checked one by one (and so a future reader can see exactly
 * which HKDF call produces which value).
 *
 *   PRK_key = HMAC-SHA-256(auth_secret, ecdh_secret)      [HKDF-Extract]
 *   IKM     = HMAC-SHA-256(PRK_key, key_info || 0x01)     [HKDF-Expand, L=32]
 *   PRK     = HMAC-SHA-256(salt, IKM)                     [HKDF-Extract]
 *   CEK     = HMAC-SHA-256(PRK, cek_info || 0x01)[0..15]
 *   NONCE   = HMAC-SHA-256(PRK, nonce_info || 0x01)[0..11]
 */
export function deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt) {
  const prkKey = createHmac("sha256", authSecret).update(ecdhSecret).digest();
  const ikm = Buffer.from(
    hkdfSync("sha256", ecdhSecret, authSecret, Buffer.concat([PUSH_INFO, uaPublic, asPublic]), 32),
  );
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return {
    prkKey,
    ikm,
    prk,
    cek: Buffer.from(hkdfSync("sha256", ikm, salt, CEK_INFO, 16)),
    nonce: Buffer.from(hkdfSync("sha256", ikm, salt, NONCE_INFO, 12)),
  };
}

/* ---------------------------------------------------------------- VAPID ---- */

const jsonSegment = (value) => b64url(Buffer.from(JSON.stringify(value), "utf8"));

/**
 * Build a VAPID Authorization header value (RFC 8292 §3).
 *
 * `exp` must not be more than 24 hours out, and `aud` must be the origin of the
 * push resource, so a token cannot be replayed against another push service.
 */
export function vapidAuthorization(endpoint, keys, options = {}) {
  const url = new URL(endpoint);
  // `Number(x) || fallback` would silently ignore an explicit 0 (epoch zero is
  // a legitimate clock, and expiresIn: 0 means "already expired"), so finiteness
  // is what decides, not truthiness.
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const requested = Number.isFinite(Number(options.expiresIn)) ? Number(options.expiresIn) : 12 * 3600;
  const nowSeconds = Math.floor(now / 1000);
  const expiresIn = Math.min(Math.max(0, requested), 24 * 3600);
  const header = { typ: "JWT", alg: "ES256" };
  const claims = { aud: `${url.protocol}//${url.host}`, exp: nowSeconds + expiresIn };
  if (options.subject) {
    // RFC 8292 §2.1: "The 'sub' claim SHOULD include a contact URI for the
    // application server as either a mailto: or https: URI."
    if (!/^(mailto:|https:\/\/)/.test(String(options.subject)))
      throw new Error("VAPID subject must be a mailto: or https: URI (RFC 8292 §2.1)");
    claims.sub = String(options.subject);
  }

  const signing = Buffer.from(`${jsonSegment(header)}.${jsonSegment(claims)}`, "utf8");
  const privateKey = privateKeyObject(keys.privateKey, keys.publicKey);
  // JOSE wants the raw r||s signature, not DER (RFC 7515 §3.4).
  const signature = cryptoSign("sha256", signing, { key: privateKey, dsaEncoding: "ieee-p1363" });
  return {
    value: `vapid t=${signing.toString("utf8")}.${b64url(signature)}, k=${keys.publicKey}`,
    token: `${signing.toString("utf8")}.${b64url(signature)}`,
    claims,
  };
}

/* ------------------------------------------------------------- delivery ---- */

/** Urgency values defined by RFC 8030 §5.3. Anything else is a header a push service will reject. */
export const URGENCIES = ["very-low", "low", "normal", "high"];

/**
 * Check the optional headers a caller can set, so a configuration typo is
 * reported as a configuration typo instead of arriving as a bare HTTP 400.
 * Returns "" when everything is acceptable.
 */
export function headerProblem(options) {
  if (options.urgency !== undefined && options.urgency !== null && !URGENCIES.includes(options.urgency))
    return `urgency must be one of ${URGENCIES.join(", ")} (got ${JSON.stringify(options.urgency)})`;
  if (options.topic !== undefined && options.topic !== null) {
    const topic = String(options.topic);
    if (!topic) return "topic must not be empty";
    if (topic.length > 32) return `topic must be at most 32 characters (got ${topic.length})`;
    if (!/^[A-Za-z0-9_-]+$/.test(topic))
      return "topic must use only the URL- and filename-safe base64 alphabet (RFC 8030 §5.4)";
  }
  return "";
}

/**
 * POST one encrypted message to one subscription (RFC 8030 §5).
 *
 * Nothing is reported as delivered that was not: the caller gets the real
 * status. 404 and 410 mean the subscription is permanently gone (RFC 8030 §7.3,
 * §7.6) and the caller should forget it; 429 and 5xx are worth retrying later.
 */
export async function sendPush(subscription, payload, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const endpoint = subscription?.endpoint;
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint))
    return { ok: false, status: 0, error: "subscription has no https endpoint", gone: false };

  let encrypted;
  try {
    encrypted = encryptPayload(payload, subscription, options.encryption || {});
  } catch (error) {
    return { ok: false, status: 0, error: `could not encrypt: ${error.message}`, gone: false };
  }

  const problem = headerProblem(options);
  if (problem) return { ok: false, status: 0, error: problem, gone: false };

  let vapid;
  try {
    vapid = options.vapid ? vapidAuthorization(endpoint, options.vapid, options) : null;
  } catch (error) {
    return { ok: false, status: 0, error: `could not authenticate: ${error.message}`, gone: false };
  }

  // TTL is mandatory: some push services (Apple's, in testing) answer 400 to a
  // request without one. It must be a non-negative integer of seconds; the
  // fallback applies to a missing *or unusable* value, not only to undefined.
  const requestedTtl = Number(options.ttl ?? 60 * 60);
  const ttl = Number.isFinite(requestedTtl)
    ? Math.min(Math.max(0, Math.floor(requestedTtl)), 24 * 60 * 60)
    : 60 * 60;
  const headers = {
    ...encrypted.headers,
    TTL: String(ttl),
    ...(vapid ? { Authorization: vapid.value } : {}),
  };
  if (options.topic) headers.Topic = String(options.topic);
  if (options.urgency) headers.Urgency = options.urgency;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: encrypted.body,
    });
    const status = response.status;
    return {
      ok: status >= 200 && status < 300,
      status,
      // 201 Created is the success response (RFC 8030 §5); 202 is accepted too.
      gone: status === 404 || status === 410,
      retryAfter: response.headers?.get?.("retry-after") || "",
      error: status >= 200 && status < 300 ? "" : `HTTP ${status}`,
      bytes: encrypted.body.length,
    };
  } catch (error) {
    return { ok: false, status: 0, gone: false, error: String(error?.message || error) };
  }
}

/* -------------------------------------------------- subscription storage --- */

const SUBSCRIPTION_FILE = "push-subscriptions.json";

/** Validate one subscription as the browser would send it, or throw with a reason. */
export function normalizeSubscription(value) {
  if (!value || typeof value !== "object") throw new Error("subscription must be an object");
  const endpoint = value.endpoint;
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint))
    throw new Error("subscription.endpoint must be an https URL");
  if (endpoint.length > 2048) throw new Error("subscription.endpoint is implausibly long");
  const keys = value.keys || {};
  assertP256Key(keys.p256dh, "subscription.keys.p256dh");
  const auth = fromB64url(keys.auth, "subscription.keys.auth");
  if (auth.length !== 16) throw new Error("subscription.keys.auth must be 16 octets");
  return {
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    ...(value.expirationTime ? { expirationTime: value.expirationTime } : {}),
    ...(value.label ? { label: String(value.label) } : {}),
  };
}

/**
 * Read the subscription store. Everything that can go wrong — no file yet, a
 * truncated file, one entry with a bad key — degrades to "fewer subscriptions"
 * rather than an exception, because a broken store must not take down the
 * watcher that is watching a game for you.
 *
 * The file holds capability URLs: whoever reads an endpoint can send to that
 * device, so it is written 0600 and should stay on the watcher's own disk.
 */
export function readSubscriptions(file, fs = NODE_FS) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.subscriptions;
    if (!Array.isArray(list)) return [];
    return list
      .map((entry) => {
        try {
          return normalizeSubscription(entry);
        } catch (_) {
          return null; // a single bad entry must not disable the others
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * Write the subscription store, atomically: a temporary file next to the real
 * one, then rename over it. A watcher killed at the wrong instant must never
 * leave a half-written store behind, because that would silently stop the
 * alerts this project exists to send. Returns true only when the rename landed.
 */
export function writeSubscriptions(file, subscriptions, fs = NODE_FS) {
  const temporary = `${file}.tmp`;
  try {
    fs.mkdirSync(dirname(file), { recursive: true });
    // 0600: an endpoint is a capability URL, and this file is the list of them.
    fs.writeFileSync(temporary, `${JSON.stringify({ subscriptions: [...subscriptions] }, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    return true;
  } catch (_) {
    try {
      fs.unlinkSync(temporary); // never leave the temporary behind either
    } catch (_) {
      /* nothing to clean up */
    }
    return false;
  }
}

/**
 * A push endpoint is a capability URL: anyone holding it can send notifications
 * to that device. Logs are the most-likely-to-be-shared artefact this project
 * produces, so they get the origin and a short tail, never the whole thing.
 */
export function maskEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint));
    const tail = url.pathname.slice(-6);
    return `${url.origin}/…${tail}`;
  } catch (_) {
    return "(unparseable endpoint)";
  }
}

/** Add or replace by endpoint (a browser re-subscribing returns the same one). */
export function addSubscription(subscriptions, value) {
  const subscription = normalizeSubscription(value);
  const others = subscriptions.filter((entry) => entry.endpoint !== subscription.endpoint);
  return [...others, subscription];
}

export function removeSubscription(subscriptions, endpoint) {
  return subscriptions.filter((entry) => entry.endpoint !== endpoint);
}

/* ------------------------------------------------------------- CLI --------- */

async function main(argv) {
  const flags = new Set(argv.slice(2));
  const keysFile =
    process.env.WATCHER_VAPID_KEYS ||
    `${process.env.WATCHER_LOG_DIR || "./data"}/vapid-keys.json`;

  if (flags.has("--generate")) {
    const keys = generateVapidKeys();
    if (flags.has("--write")) {
      if (existsSync(keysFile) && !flags.has("--force")) {
        console.error(
          `${keysFile} already exists. Refusing to replace a key pair that subscribers are pinned to.\n` +
            "Re-run with --force only if you mean to invalidate every existing subscription.",
        );
        return 1;
      }
      mkdirSync(dirname(keysFile), { recursive: true });
      // 0600: this file is the VAPID signing key. Nothing else needs to read it.
      writeFileSync(keysFile, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
      console.log(`Wrote ${keysFile} (mode 0600).`);
      console.log(`Public key: ${keys.publicKey}`);
      console.log(
        "\nPut that public key in assets/js/vapid-config.js so the page subscribes with it.\n" +
          "The private key is intentionally not printed here; it is in the file above,\n" +
          "which must never be committed (data/ and *.json key files are ignored).",
      );
      return 0;
    }
    console.log(JSON.stringify(keys, null, 2));
    console.log(
      "\nPut the public key in assets/js/vapid-config.js (so the page subscribes with it),\n" +
        "keep the private key next to the watcher, and never commit it.",
    );
    return 0;
  }

  if (flags.has("--public")) {
    try {
      const keys = JSON.parse(readFileSync(keysFile, "utf8"));
      console.log(keys.publicKey);
      return 0;
    } catch (error) {
      console.error(`No readable key file at ${keysFile} (${error.message}).`);
      return 1;
    }
  }

  console.log(
    "Usage: node tools/webpush.mjs --generate [--write] | --public\n\n" +
      `  keys file: ${keysFile} (WATCHER_VAPID_KEYS)\n` +
      `  subscriptions: ${process.env.WATCHER_PUSH_SUBSCRIPTIONS || `${process.env.WATCHER_LOG_DIR || "./data"}/${SUBSCRIPTION_FILE}`}\n`,
  );
  return flags.size ? 1 : 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(await main(process.argv));
