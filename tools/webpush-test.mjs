#!/usr/bin/env node
/* Web Push encryption and VAPID authentication, checked against the RFCs.
 *
 * These are not self-consistency tests: the expected bytes come from the
 * published test vectors in RFC 8291 (§5 and Appendix A) and RFC 8292 (§2.4),
 * and the VAPID signature this code produces is verified with an independent
 * key object built from the JWK in the RFC.
 *
 * Run: node tools/webpush-test.mjs
 */
import assert from "node:assert/strict";
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";

const {
  MAX_PAYLOAD,
  RECORD_SIZE,
  addSubscription,
  assertP256Key,
  isOnCurveP256,
  b64url,
  deriveKeys,
  encryptPayload,
  fromB64url,
  generateVapidKeys,
  maskEndpoint,
  headerProblem,
  isValidPublicKey,
  normalizeSubscription,
  privateKeyObject,
  readSubscriptions,
  readVapidKeys,
  removeSubscription,
  sendPush,
  vapidAuthorization,
  writeSubscriptions,
} = await import("./webpush.mjs");

let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks += 1;
};
const ok = (condition, label) => {
  assert.ok(condition, label);
  checks += 1;
};
const throws = (fn, pattern, label) => {
  assert.throws(fn, pattern, label);
  checks += 1;
};

/* ========================================================================
 * RFC 8291 section 5 / Appendix A — the published worked example
 * ====================================================================== */

const b64 = (value) => Buffer.from(value.replace(/\s+/g, ""), "base64url");

const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
  authSecret: b64("BTBZMqHH6r4Tts7J_aSIgg"),
  uaPublic: b64(
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  ),
  uaPrivate: b64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"),
  asPublic: b64(
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ),
  asPrivate: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
  ecdhSecret: b64("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"),
  prkKey: b64("Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k"),
  keyInfo: b64(
    "V2ViUHVzaDogaW5mbwAEJXGyvs3942BVGq8e0PTNNmwRzr5VX4m8t7GGpTM5FzFo7OLr4BhZe9MEebhuPI-OztV3ylkYfpJGmQ22ggCLDgT-M_SrDepxkU21WCP3O1SUj0EwbZIHMtu5pZpTKGSCIA5Zent7wmC6HCJ5mFgJkuk5cwAvMBKiiujwa7t45ewP",
  ),
  ikm: b64("S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg"),
  prk: b64("09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc"),
  cek: b64("oIhVW04MRdy2XN9CiKLxTg"),
  nonce: b64("4h_95klXJ5E_qnoN"),
  paddedPlaintext: b64(
    "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24C",
  ),
  ciphertextAndTag: b64(
    "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  ),
};

// The published 86-octet header (RFC 8291 §5) and the full published body.
const RFC_HEADER = Buffer.concat([
  RFC.salt,
  Buffer.from([0x00, 0x00, 0x10, 0x00]), // rs = 4096
  Buffer.from([65]), // idlen
  RFC.asPublic,
]);
check(RFC_HEADER.length, 86, "The RFC header is 86 octets (salt 16 + rs 4 + idlen 1 + keyid 65)");
const RFC_BODY = Buffer.concat([RFC_HEADER, RFC.ciphertextAndTag]);
check(
  RFC_BODY.length,
  144,
  "The published body decodes to 144 octets — the RFC's own \"Content-Length: 145\" is off by one",
);
check(
  RFC.asPublic.length,
  65,
  "The application-server public key is a 65-octet uncompressed point",
);

/* ---- the key derivation, step by step (Appendix A intermediate values) ---- */

// Recompute the ECDH secret the way the RFC describes: the receiver's private
// key against the sender's public key. If this matches, the rest of the chain
// is arithmetic we can check value by value.
const { createECDH } = await import("node:crypto");
const ua = createECDH("prime256v1");
ua.setPrivateKey(RFC.uaPrivate);
check(
  b64url(ua.getPublicKey()),
  b64url(RFC.uaPublic),
  "The receiver private key reproduces the receiver public key from the RFC",
);
check(
  b64url(ua.computeSecret(RFC.asPublic)),
  b64url(RFC.ecdhSecret),
  "ECDH(receiver private, sender public) matches the RFC's ecdh_secret",
);

const sender = createECDH("prime256v1");
sender.setPrivateKey(RFC.asPrivate);
check(
  b64url(sender.getPublicKey()),
  b64url(RFC.asPublic),
  "The sender private key reproduces the sender public key from the RFC",
);
check(
  b64url(sender.computeSecret(RFC.uaPublic)),
  b64url(RFC.ecdhSecret),
  "The sender side agrees on the same ECDH secret (both directions match the RFC)",
);

const derived = deriveKeys(RFC.ecdhSecret, RFC.authSecret, RFC.uaPublic, RFC.asPublic, RFC.salt);
check(b64url(derived.prkKey), b64url(RFC.prkKey), "The derived PRK_key matches the RFC's PRK_key");
check(b64url(derived.ikm), b64url(RFC.ikm), "The derived IKM matches the RFC's IKM");
check(b64url(derived.prk), b64url(RFC.prk), "The derived PRK (for content encryption) matches the RFC's PRK");
// The RFC's key_info is "WebPush: info" || 0x00 || ua_public || as_public; check
// the concatenation we feed to HKDF really is that, octet for octet.
check(
  b64url(Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), RFC.uaPublic, RFC.asPublic])),
  b64url(RFC.keyInfo),
  "The key_info we build matches the RFC's published key_info byte for byte",
);
check(
  RFC.cek.length,
  16,
  "The CEK is 16 octets (AES-128-GCM) — the RFC truncates the HKDF output",
);
check(b64url(derived.cek), b64url(RFC.cek), "The derived CEK matches the RFC's CEK");
check(b64url(derived.nonce), b64url(RFC.nonce), "The derived NONCE matches the RFC's NONCE");

/* ---- the full message body, byte for byte ---- */

const encrypted = encryptPayload(RFC.plaintext, {
  endpoint: "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
  keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(RFC.authSecret) },
}, {
  salt: RFC.salt,
  serverKeys: { privateKey: b64url(RFC.asPrivate), publicKey: b64url(RFC.asPublic) },
  recordSize: RECORD_SIZE,
});

check(
  b64url(encrypted.body),
  b64url(RFC_BODY),
  "Encrypting the RFC's plaintext reproduces its published 144-octet body exactly",
);
check(
  b64url(encrypted.header),
  b64url(RFC_HEADER),
  "…including the 86-octet header (salt || rs || idlen || server key)",
);
check(
  b64url(encrypted.body.subarray(86)),
  b64url(RFC.ciphertextAndTag),
  "…and the record (ciphertext || 16-octet GCM tag)",
);
// Header layout (RFC 8188 §2.1): salt[0..16] rs[16..20] idlen[20] keyid[21..86]
check(encrypted.body.readUInt32BE(16), 4096, "The record size in the header is 4096");
check(
  encrypted.body.readUInt8(20),
  65,
  "The keyid length in the header is 65 (the RFC notes this is deliberately not UTF-8)",
);
check(
  encrypted.body.subarray(21, 86).equals(RFC.asPublic),
  true,
  "The keyid is the application server's uncompressed public key",
);
check(
  encrypted.headers["Content-Encoding"],
  "aes128gcm",
  "The only permitted content encoding is advertised (RFC 8291 §4)",
);

// Independent decryption, using only the receiver's private key and the
// published bytes: proves the message really is decryptable by the subscriber
// rather than merely self-consistent with our own encryption path.
const receiver = createECDH("prime256v1");
receiver.setPrivateKey(RFC.uaPrivate);
const serverPublic = encrypted.body.subarray(21, 86);
const shared = receiver.computeSecret(serverPublic);
const receiverKeys = deriveKeys(shared, RFC.authSecret, RFC.uaPublic, serverPublic, encrypted.body.subarray(0, 16));
const tag = encrypted.body.subarray(encrypted.body.length - 16);
const ciphertext = encrypted.body.subarray(86, encrypted.body.length - 16);
const decipher = createDecipheriv("aes-128-gcm", receiverKeys.cek, receiverKeys.nonce);
decipher.setAuthTag(tag);
// The decrypted record is plaintext || 0x02 [|| padding]; the RFC publishes that
// intermediate value, so it can be checked too, not just the final string.
const decryptedRecord = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
check(
  b64url(decryptedRecord),
  b64url(RFC.paddedPlaintext),
  "The decrypted record is exactly the RFC's padded plaintext (plaintext + 0x02, no extra padding)",
);
check(
  decryptedRecord[decryptedRecord.length - 1],
  2,
  "…ending in the 0x02 padding delimiter (values other than 0x02 must be discarded)",
);
const decrypted = decryptedRecord.subarray(0, decryptedRecord.length - 1);
check(
  decrypted.toString("utf8"),
  RFC.plaintext,
  "A receiver decrypts the message back to the RFC's plaintext (independent code path)",
);
check(
  decryptedRecord.length,
  42,
  "…and the record carries no padding bytes it did not need",
);

/* ========================================================================
 * RFC 8292 section 2.4 — the published VAPID example
 * ====================================================================== */

const RFC_VAPID = {
  endpoint: "https://push.example.net/p/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
  publicKey:
    "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs",
  jwk: { x: "DUfHPKLVFQzVvnCPGyfucbECzPDa7rWbXriLcysAjEc", y: "F6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs" },
  token:
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA",
};

// The RFC's own key must pass our validation, and the RFC's own token must
// verify — that pins the claim format and the signature encoding we produce.
assertP256Key(RFC_VAPID.publicKey, "RFC VAPID public key");
checks += 1;
{
  const [headerSegment, claimsSegment, signatureSegment] = RFC_VAPID.token.split(".");
  const header = JSON.parse(Buffer.from(headerSegment, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(claimsSegment, "base64url").toString("utf8"));
  check(header, { typ: "JWT", alg: "ES256" }, "The RFC's JWT header is the profile we emit");
  check(claims.aud, "https://push.example.net", "The RFC's aud is the push service origin");
  check(claims.sub, "mailto:push@example.com", "The RFC's sub is a mailto contact URI");
  const key = createPublicKey({
    key: { kty: "EC", crv: "P-256", ...RFC_VAPID.jwk },
    format: "jwk",
  });
  const verified = cryptoVerify(
    "sha256",
    Buffer.from(`${headerSegment}.${claimsSegment}`, "utf8"),
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signatureSegment, "base64url"),
  );
  ok(verified, "The RFC's published JWT verifies with its published JWK (ieee-p1363 is right)");
  check(
    Buffer.from(signatureSegment, "base64url").length,
    64,
    "…and its signature is the raw 64-octet r||s form, not DER",
  );
}

/* ---- our VAPID header ---- */

const vapidKeys = generateVapidKeys();
const auth = vapidAuthorization(RFC_VAPID.endpoint, vapidKeys, {
  subject: "mailto:push@example.com",
  now: 1_453_523_768_000,
  expiresIn: 12 * 3600,
});
ok(
  auth.value.startsWith("vapid t="),
  "The Authorization header uses the vapid scheme with a t parameter (RFC 8292 §3)",
);
ok(
  auth.value.includes(`, k=${vapidKeys.publicKey}`),
  "…and carries the signing public key in the k parameter",
);
check(auth.claims.aud, "https://push.example.net", "aud is the origin of the endpoint, not the full path");
check(auth.claims.exp, 1_453_523_768 + 12 * 3600, "exp is the requested lifetime");
check(auth.claims.sub, "mailto:push@example.com", "sub carries the contact URI");

{
  const [headerSegment, claimsSegment, signatureSegment] = auth.token.split(".");
  check(
    JSON.parse(Buffer.from(headerSegment, "base64url").toString("utf8")),
    { typ: "JWT", alg: "ES256" },
    "Our JWT header is {typ:JWT, alg:ES256}",
  );
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(fromB64url(vapidKeys.publicKey).subarray(1, 33)),
      y: b64url(fromB64url(vapidKeys.publicKey).subarray(33, 65)),
    },
    format: "jwk",
  });
  ok(
    cryptoVerify(
      "sha256",
      Buffer.from(`${headerSegment}.${claimsSegment}`, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signatureSegment, "base64url"),
    ),
    "Our own VAPID token verifies against the public key we publish",
  );
  check(Buffer.from(signatureSegment, "base64url").length, 64, "Our signature is 64 octets (r||s)");
}

// The 24-hour ceiling (RFC 8292 §2) and the audience rule are enforced, not trusted.
check(
  vapidAuthorization(RFC_VAPID.endpoint, vapidKeys, { now: 0, expiresIn: 48 * 3600 }).claims.exp,
  24 * 3600,
  "A lifetime longer than 24 hours is clamped to 24 hours",
);
check(
  vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapidKeys, { now: 0 }).claims.aud,
  "https://fcm.googleapis.com",
  "A real push-service endpoint yields its origin as aud",
);
ok(
  !JSON.parse(Buffer.from(vapidAuthorization(RFC_VAPID.endpoint, vapidKeys, { now: 0 }).token.split(".")[1], "base64url").toString("utf8")).sub,
  "sub is omitted when no contact is configured (it is optional)",
);

/* ------------------------------------------------------------- key hygiene */

throws(() => fromB64url("not/base64!", "value"), /not base64url/, "A non-base64url value is rejected");
check(isValidPublicKey("AAAA"), false, "A short key is not a valid public key");
check(
  isValidPublicKey(vapidKeys.publicKey),
  true,
  "A generated public key is a valid uncompressed point",
);
const pointAtInfinity = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]); // encoded as (0, 0)
throws(
  () => assertP256Key(b64url(pointAtInfinity), "key"),
  /not a valid point on P-256/,
  "The point (0, 0) — not on P-256 — is rejected before it can be used (RFC 8291 §7)",
);
throws(
  () => assertP256Key(b64url(Buffer.alloc(65, 4)), "key"),
  /not a valid point on P-256/,
  "…and so is a point that only looks structurally right",
);
check(
  isOnCurveP256(0n, 0n),
  false,
  "The curve equation itself rejects (0, 0) — the check does not rely on the library",
);
{
  // Regression guard: Node/OpenSSL *accept* (0, 0) as a JWK, which is why this
  // module does its own arithmetic. If a future Node release starts rejecting
  // it, this check keeps the reason for the hand-rolled check visible.
  let libraryVerdict;
  try {
    createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: b64url(Buffer.alloc(32)),
        y: b64url(Buffer.alloc(32)),
      },
      format: "jwk",
    });
    libraryVerdict = "accepted";
  } catch (_) {
    libraryVerdict = "rejected";
  }
  check(
    libraryVerdict,
    "rejected",
    "Node's own JWK import also rejects (0, 0) — the two checks agree",
  );
}
{
  const keys = generateVapidKeys();
  throws(
    () => privateKeyObject(b64url(Buffer.alloc(32)), keys.publicKey, "key"),
    /scalar in \[1, n-1\]/,
    "A VAPID private key of zero is rejected (it is outside [1, n-1])",
  );
  throws(
    () => privateKeyObject(b64url(Buffer.from("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", "hex")), keys.publicKey, "key"),
    /scalar in \[1, n-1\]/,
    "…and so is the group order n itself, which is the same point as zero",
  );
  throws(
    () => privateKeyObject(keys.privateKey, generateVapidKeys().publicKey, "key"),
    /does not match the VAPID private key/,
    "A private key paired with somebody else's public key is rejected up front",
  );
  check(
    privateKeyObject(keys.privateKey, keys.publicKey).asymmetricKeyType,
    "ec",
    "A well-formed VAPID pair produces a signing key",
  );
}
{
  const keys = generateVapidKeys();
  check(fromB64url(keys.privateKey, "private").length, 32, "A VAPID private key is 32 octets");
  check(fromB64url(keys.publicKey, "public").length, 65, "A VAPID public key is 65 octets");
  ok(keys.publicKey !== keys.privateKey, "Key generation produces a pair, not a repeat");
  ok(/^[A-Za-z0-9_-]+$/.test(keys.publicKey), "Keys are URL-safe base64 (safe in a header)");
}

/* ------------------------------------------------------- payload handling -- */

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/example-token",
  keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(RFC.authSecret) },
};

// Salt and server key are fresh per message by default: two encryptions of the
// same alert must not be byte-identical, or the push service could correlate them.
const first = encryptPayload("same alert", subscription);
const second = encryptPayload("same alert", subscription);
ok(!first.body.equals(second.body), "Each message is encrypted with a fresh salt and key pair");
check(first.salt.length, 16, "A generated salt is 16 octets");
ok(
  !Buffer.from(first.serverKeys.publicKey, "base64url").equals(
    Buffer.from(second.serverKeys.publicKey, "base64url"),
  ),
  "…and a fresh application-server key pair (RFC 8291 §3.1)",
);

throws(
  () => encryptPayload("x", { endpoint: "https://x/", keys: { p256dh: "AAAA", auth: b64url(RFC.authSecret) } }),
  /p256dh/,
  "A malformed subscription key is refused with a reason",
);
throws(
  () => encryptPayload("x", { endpoint: "https://x/", keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(Buffer.alloc(8)) } }),
  /16 octets/,
  "An auth secret that is not 16 octets is refused",
);
throws(
  () => encryptPayload("x".repeat(MAX_PAYLOAD + 10), subscription),
  /limit is 3993/,
  "A payload larger than the push-service limit is refused before it is sent",
);
throws(
  () => encryptPayload("x".repeat(200), subscription, { recordSize: 128 }),
  /smaller than the record size/,
  "A payload that cannot fit one record is refused (RFC 8291 §4 requires a single record)",
);
{
  // The documented 3993-octet limit is not arbitrary: it is what leaves the
  // 86-octet header, the 0x02 delimiter and the 16-octet tag inside the 4096
  // octets a push service will accept for the whole body (RFC 8188 §2.1).
  const atLimit = encryptPayload("x".repeat(MAX_PAYLOAD), subscription);
  check(
    MAX_PAYLOAD,
    3993,
    "The plaintext limit is 3993 octets (4096 - 86 header - 1 delimiter - 16 tag)",
  );
  check(
    atLimit.body.length,
    RECORD_SIZE,
    "A payload at the documented limit still produces a 4096-octet request body",
  );
}
throws(
  () => encryptPayload("x".repeat(MAX_PAYLOAD + 1), subscription),
  /limit is 3993/,
  "The refusal names the plaintext length, not an inflated one",
);
throws(
  () => encryptPayload("short", subscription, { padding: RECORD_SIZE }),
  /smaller than the record size/,
  "Padding that would overflow the record is refused rather than sent",
);
// With the default record size the record rule is the tighter of the two, so the
// whole-body budget only shows its teeth when a caller advertises a larger rs.
// A push service still refuses a body over 4096 octets, and that is the limit
// the last guard enforces (RFC 8291 §4).
throws(
  () => encryptPayload("short", subscription, { recordSize: 8192, padding: RECORD_SIZE }),
  /push service accepts 4096/,
  "…and a body that outgrows what a push service accepts is refused too",
);
check(
  encryptPayload("hi", subscription, { padding: 100 }).body.length - encryptPayload("hi", subscription).body.length,
  100,
  "Padding is added exactly as asked (length is not leaked for free)",
);

/* ------------------------------------------------------------- delivery ---- */

const responses = [];
const fakeFetch = (response) => async (url, options) => {
  responses.push({ url, options });
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    headers: { get: (name) => response.headers?.[name.toLowerCase()] || null },
  };
};

const delivered = await sendPush(subscription, "ALERT: bases loaded", {
  vapid: vapidKeys,
  fetchImpl: fakeFetch({ status: 201 }),
  ttl: 3600,
  topic: "loaded-late",
  urgency: "high",
});
check(delivered, { ok: true, status: 201, gone: false, retryAfter: "", error: "", bytes: delivered.bytes },
  "A 201 Created is reported as delivered, with the real status");
ok(
  delivered.bytes > 86,
  "…and the message that was posted is a real encrypted body, not an empty one",
);
check(responses[0].options.method, "POST", "Push delivery is an HTTP POST");
check(responses[0].url, subscription.endpoint, "…to the subscription's endpoint");
check(
  responses[0].options.headers["Content-Encoding"],
  "aes128gcm",
  "…with Content-Encoding: aes128gcm",
);
check(responses[0].options.headers.TTL, "3600", "…with a TTL (RFC 8030 requires one)");
check(
  responses[0].options.headers.Authorization.startsWith("vapid t="),
  true,
  "…and a VAPID Authorization header",
);
check(responses[0].options.headers.Topic, "loaded-late", "…and an optional collapse Topic");
check(responses[0].options.headers.Urgency, "high", "…and an urgency hint");
check(responses[0].options.headers["Content-Type"], "application/octet-stream", "The body is opaque bytes");
ok(
  Buffer.isBuffer(responses[0].options.body),
  "The body handed to fetch is a Buffer the service can byte-count",
);

check(
  (await sendPush(subscription, "x", { vapid: vapidKeys, fetchImpl: fakeFetch({ status: 410 }) })).gone,
  true,
  "410 Gone marks the subscription as permanently gone (RFC 8030 §7.6)",
);
check(
  (await sendPush(subscription, "x", { vapid: vapidKeys, fetchImpl: fakeFetch({ status: 404 }) })).gone,
  true,
  "404 also means forget the subscription",
);
const throttled = await sendPush(subscription, "x", {
  vapid: vapidKeys,
  fetchImpl: fakeFetch({ status: 429, headers: { "retry-after": "120" } }),
});
check([throttled.ok, throttled.gone, throttled.retryAfter], [false, false, "120"],
  "429 is a temporary failure and its Retry-After is surfaced");
check(
  (await sendPush(subscription, "x", { vapid: vapidKeys, fetchImpl: async () => { throw new Error("ECONNRESET"); } })).error,
  "ECONNRESET",
  "A network failure is reported with its reason, never as delivered",
);
check(
  (await sendPush({ endpoint: "http://insecure.example/x", keys: subscription.keys }, "x", {})).ok,
  false,
  "A non-https endpoint is refused (RFC 8030 §5 requires HTTPS)",
);
check(
  (await sendPush({ keys: subscription.keys }, "x", {})).error,
  "subscription has no https endpoint",
  "A subscription with no endpoint is refused with a reason",
);
check(
  (await sendPush({ endpoint: "https://x/", keys: { p256dh: "AAAA", auth: "AAAA" } }, "x", { vapid: vapidKeys })).error.startsWith(
    "could not encrypt",
  ),
  true,
  "An unsendable subscription reports the encryption failure instead of throwing",
);

/* --------------------------------------------------- header hygiene ------ */

check(
  headerProblem({ ttl: 60, topic: "loaded-late", urgency: "high" }),
  "",
  "A clean set of options raises no complaint",
);
check(
  headerProblem({ urgency: "urgent" }),
  'urgency must be one of very-low, low, normal, high (got "urgent")',
  "An urgency outside RFC 8030 §5.3 is named, not silently sent",
);
check(
  headerProblem({ topic: "x".repeat(33) }),
  "topic must be at most 32 characters (got 33)",
  "A Topic longer than 32 characters is refused by us, not by the push service",
);
check(
  headerProblem({ topic: "bases loaded!" }),
  "topic must use only the URL- and filename-safe base64 alphabet (RFC 8030 §5.4)",
  "…and so is a Topic outside the permitted alphabet",
);
check(headerProblem({ topic: "" }), "topic must not be empty", "An empty Topic is refused");

{
  // TTL has to be present and sane whatever the caller passes: some services
  // answer 400 without it, and "NaN" is not a number of seconds.
  const ttlOf = async (options) => {
    let sent;
    await sendPush(subscription, "x", {
      vapid: vapidKeys,
      fetchImpl: async (url, request) => {
        sent = request.headers;
        return { status: 201, headers: { get: () => null } };
      },
      ...options,
    });
    return sent.TTL;
  };
  check(await ttlOf({}), "3600", "A missing TTL falls back to one hour");
  check(await ttlOf({ ttl: Number.NaN }), "3600", "An unusable TTL falls back too");
  check(await ttlOf({ ttl: -5 }), "0", "A negative TTL is clamped to zero, never sent negative");
  check(await ttlOf({ ttl: 3 * 24 * 3600 }), "86400", "A TTL beyond a day is clamped to 24 hours");
  check(await ttlOf({ ttl: 90.7 }), "90", "TTL is an integer number of seconds");
  const badUrgency = await sendPush(subscription, "x", { vapid: vapidKeys, urgency: "nope" });
  check(
    [badUrgency.ok, badUrgency.status, badUrgency.error],
    [false, 0, 'urgency must be one of very-low, low, normal, high (got "nope")'],
    "sendPush refuses a bad urgency before it reaches the network",
  );
  const badTopic = await sendPush(subscription, "x", { vapid: vapidKeys, topic: "x".repeat(40) });
  check(
    [badTopic.ok, badTopic.status],
    [false, 0],
    "…and a bad Topic, with no request attempted (status 0)",
  );
}

throws(
  () => vapidAuthorization(RFC_VAPID.endpoint, vapidKeys, { subject: "push@example.com" }),
  /mailto: or https:/,
  "A VAPID subject that is neither mailto: nor https: is refused (RFC 8292 §2.1)",
);
ok(
  vapidAuthorization(RFC_VAPID.endpoint, vapidKeys, { subject: "https://example.com/contact" }).claims.sub,
  "an https: subject is accepted",
);

/* ------------------------------------------------- VAPID key file I/O ---- */

{
  const good = { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey };
  const reader = (text) => ({ readFileSync: () => text });
  check(
    readVapidKeys("/k/vapid.json", reader(JSON.stringify(good))).publicKey,
    vapidKeys.publicKey,
    "A well-formed key file loads",
  );
  throws(
    () => readVapidKeys("/k/vapid.json", reader("{ not json")),
    /cannot read VAPID keys from \/k\/vapid.json/,
    "An unreadable key file says which file and why",
  );
  throws(
    () => readVapidKeys("/k/vapid.json", reader("{}")),
    /must contain publicKey and privateKey/,
    "A key file missing a key is refused with the command that fixes it",
  );
  throws(
    () => readVapidKeys("/k/vapid.json", reader(JSON.stringify({ ...good, publicKey: generateVapidKeys().publicKey }))),
    /does not match the VAPID private key/,
    "…and a mismatched pair is caught at load time, not as a mysterious 401 later",
  );
}

check(
  maskEndpoint("https://fcm.googleapis.com/fcm/send/AAAABBBBCCCCDDDDEEEEFFFF"),
  "https://fcm.googleapis.com/…EEFFFF",
  "An endpoint is masked for logs: origin plus a short tail, never the whole capability URL",
);
check(
  maskEndpoint("not a url"),
  "(unparseable endpoint)",
  "…and an unparseable endpoint degrades to a readable placeholder",
);

/* ------------------------------------------------ subscription bookkeeping - */

const normalized = normalizeSubscription({
  endpoint: "https://fcm.googleapis.com/fcm/send/a",
  keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(RFC.authSecret) },
  expirationTime: null,
  label: "phone",
  extra: "dropped",
});
check(Object.keys(normalized).sort(), ["endpoint", "keys", "label"], "Only the fields that matter are stored");
check(normalized.keys.p256dh, b64url(RFC.uaPublic), "The p256dh key survives normalization verbatim");
throws(() => normalizeSubscription({ endpoint: "ftp://x", keys: {} }), /https/, "A non-https subscription is rejected");
throws(() => normalizeSubscription(null), /must be an object/, "A null subscription is rejected");
throws(
  () => normalizeSubscription({ endpoint: `https://push.example/${"a".repeat(2100)}`, keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(RFC.authSecret) } }),
  /implausibly long/,
  "An implausibly long endpoint is refused before it is stored",
);

let list = [];
list = addSubscription(list, { endpoint: "https://push/1", keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(RFC.authSecret) } });
list = addSubscription(list, { endpoint: "https://push/2", keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(RFC.authSecret) } });
check(list.length, 2, "Two different endpoints are two subscriptions");
list = addSubscription(list, { endpoint: "https://push/1", keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(RFC.authSecret) }, label: "re-subscribed" });
check(list.length, 2, "Re-subscribing to the same endpoint replaces it instead of duplicating");
check(list.find((entry) => entry.endpoint === "https://push/1").label, "re-subscribed", "…and keeps the newer copy");
check(removeSubscription(list, "https://push/1").length, 1, "A gone endpoint can be dropped");
throws(() => addSubscription([], { endpoint: "https://push/3", keys: { p256dh: "AAAA", auth: b64url(RFC.authSecret) } }),
  /p256dh/, "A subscription with a bad key is refused before it is stored");

const written = [];
const renames = [];
const fsStub = {
  writeFileSync: (file, text) => written.push({ file, text }),
  mkdirSync() {},
  renameSync: (from, to) => renames.push({ from, to }),
  unlinkSync() {},
};
ok(writeSubscriptions("/tmp/subs.json", [normalized], fsStub), "A successful store write reports success");
check(written.length, 1, "…by writing exactly one file");
check(written[0].file, "/tmp/subs.json.tmp", "…to a temporary path beside the real one, never in place");
check(renames[0].to, "/tmp/subs.json", "…then renaming it over the real path (a crash cannot leave half a store)");
check(
  JSON.parse(written[0].text).subscriptions.length,
  1,
  "…as a JSON object with a subscriptions array (the shape readSubscriptions expects)",
);
ok(
  !writeSubscriptions("/tmp/subs.json", [], {
    writeFileSync: () => {
      throw new Error("EACCES");
    },
    mkdirSync() {},
    renameSync() {},
    unlinkSync() {},
  }),
  false,
  "An unwritable store reports failure instead of pretending",
);
{
  const removed = [];
  ok(
    !writeSubscriptions("/tmp/subs.json", [], {
      writeFileSync() {},
      mkdirSync() {},
      renameSync: () => {
        throw new Error("EXDEV");
      },
      unlinkSync: (file) => removed.push(file),
    }),
    false,
    "A failed rename is reported as failure too",
  );
  check(
    removed,
    ["/tmp/subs.json.tmp"],
    "…and the temporary file is cleaned up rather than left lying around",
  );
}
check(readSubscriptions("/tmp/definitely-missing.json"), [], "A missing store is empty state, not an error");
check(
  readSubscriptions("/tmp/x.json", { readFileSync: () => "{ not json" }),
  [],
  "A corrupt store degrades to empty state",
);
{
  const good = { endpoint: "https://push/good", keys: { p256dh: b64url(RFC.uaPublic), auth: b64url(RFC.authSecret) } };
  const bad = { endpoint: "https://push/bad", keys: { p256dh: "AAAA", auth: "AAAA" } };
  const parsed = readSubscriptions("/tmp/x.json", {
    readFileSync: () => JSON.stringify({ subscriptions: [bad, good] }),
  });
  check(parsed.length, 1, "One broken entry does not disable the others");
  check(parsed[0].endpoint, "https://push/good", "…and the good one is kept");
}

console.log(`✓ ${checks} web push checks passed`);
