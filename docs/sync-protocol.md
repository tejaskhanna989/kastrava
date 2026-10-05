# Kastrava sync protocol (v1, locked 2026-10-05)

Zero-knowledge: the server stores one opaque blob per account and can never
read it. Clients do all crypto.

## Crypto (all platforms, identical parameters)
- Key: `PBKDF2-HMAC-SHA256(password, sync_salt, 200000, 32)` where `sync_salt`
  comes from signup/login (hex). scrypt is NOT used client-side so desktop
  (Node), Android (SecretKeyFactory) and web agree byte-for-byte.
- Cipher: `AES-256-GCM`, 12-byte random IV prepended to ciphertext.
- Blob envelope (JSON, then encrypted as UTF-8):
  `{"v":1,"bookmarks":[...],"prefs":{...},"license":{"key":"KAS-..."}}`
- `bookmarks`: `[{t, u}]` (title, url). `prefs`: flat settings map.
- `license.key`: reference ONLY, displayed, never auto-activated (keys are
  machine-bound; activating elsewhere returns machine_mismatch).

## Transport
- Auth: `Authorization: Bearer kas_…` (30-day sessions).
- `POST /api/sync/pull` → `{rev, blob|null}`.
- `POST /api/sync/push {blob, base_rev}` → `{rev}` or `409 {rev, blob}`.
- First push uses `base_rev: 0`. On 409: decrypt server blob, merge
  (bookmarks union by URL, prefs last-write-wins per key), push merged with
  `base_rev: rev`.
- Blob cap: 256 KB.

## Server trust model (honest)
- Sees: email, salts (public), login times, blob size/rev. Never plaintext.
- No email verification and no password reset (reset orphans the sync key
  by design) — resets go through the maintainer manually.
- Auth endpoints throttled (20/min/IP). Sessions expire in 30 days.
