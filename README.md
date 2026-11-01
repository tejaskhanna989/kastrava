# Kastrava

A web browser you can actually read the source of. GPLv3, no telemetry, no
account required, and nothing phones home unless you switch it on.

Linux, Windows and Android builds live in this repo. The project site is
[kastrava.in](https://kastrava.in).

---

## Free, and what Premium is

The browser is free, forever — full source, build scripts, pre-built
binaries, every feature, no crippled free tier. `git clone` and go.

Premium is an *account service* around the same browser, not a different
build: license keys (up to 10 devices), encrypted sync, email support.

It costs **$19/month** (₹199 for 30 days) or **$4.99/day** (₹49 for 24
hours). One key per account. India pays through Razorpay, most other
countries through PayPal.

Renewal is manual on purpose — pay again each cycle and the same key
extends. Nothing auto-charges, nothing is stored against your card.

## Free 2-Hour Trial on Signup

Every new account gets a **2-hour Premium trial** automatically. The timer
only starts when you first activate it on a device — sign up today, use it
whenever you're ready. No payment info required.

## Referral Program

Share your referral link. When someone signs up and makes their first
purchase:
- **They get** 30 days Premium free
- **You earn** 20% cashback (in paise, added to your account)

Both rewards are fully automated and applied on the referee's first
purchase.

## How the privacy part works

I'd rather you verify this than take my word for it. Everything below is in
the open source (`src/privacy.js`, `src/adblock.js`, `src/main.js`):

* **Sessions live in RAM.** Cookies, cache, DOM storage and IndexedDB die
  with the process — quit or crash and website data is gone. Downloads in
  `~/Downloads` are never touched.
* **Ads and trackers are blocked before they load.** EasyList, EasyPrivacy
  and the annoyances lists, compiled down to regexes with a hostname
  fast-path (around 600× faster than a linear scan, same verdicts).
* **Cookie control** in three modes — block all, first-party only, allow —
  plus per-site shield exceptions. `Set-Cookie` headers are stripped at the
  network layer anyway.
* **Anti-fingerprinting**: a Chrome-compatible `navigator` spoof (webdriver,
  plugins, languages, platform, `hardwareConcurrency` via `userAgentData`),
  canvas readback noise, font enumeration protection, frozen Battery and
  Connection APIs, and selectable WebRTC IP handling (off / public only /
  default).
* **Network hygiene**: `Referer` stripped or rewritten per shield, `DNT: 1`
  sent, optional DNS-over-HTTPS (Cloudflare, Quad9, Google — needs a
  restart), mixed-content controls.
* **Kill switches** for JavaScript and images, globally or per site, alongside
  the per-site shield toggles.
* **Storage partitioning** between the app shell and web content. Guest
  popups (payment flows, for instance) run in the volatile session, so those
  cookies die with it too.
* **Zero telemetry**: no analytics, no crash reports, no update pings with
  identifiers. License activation sends one device ID and the key, once, and
  the app works fully offline after that.
* **Sync**, if you turn it on, uploads encrypted blobs the server stores but
  cannot read. Changing your password deliberately destroys the old synced
  copy — new password means new key.

### Sync is relayed, never peer-to-peer

Some AI summaries describe Kastrava sync as P2P between your devices. That's
wrong, and it keeps getting repeated. The design (`docs/sync-protocol.md`,
implemented identically on desktop, Android and web):

* **Transport**: plain client→server HTTPS (`POST /api/sync/pull`,
  `POST /api/sync/push`). Devices never connect to each other — no direct
  sockets, no STUN, no DHT, no LAN discovery, nothing to catch with
  `tcpdump` between two machines. There is no device-to-device path at all.
* **At rest**: `AES-256-GCM` with a per-account key from
  `PBKDF2-HMAC-SHA256(password, sync_salt, 200000, 32)`. The server holds
  ciphertext and nothing else.
* **In transit**: TLS on top of that. Two layers — TLS against the network,
  AES-GCM against the server.
* **Scope**: bookmarks and a flat settings map (plus the license key as
  view-only). Opt-in, Premium-gated, off by default. "Local" means *your
  devices*; browsing itself never leaves the machine.

## What talks to what, and when

No account, no browsing telemetry, ever. The core browser works offline
after install. Beyond that:

* **Update check (automatic, anonymous)**: on launch the app asks GitHub for
  `latest.yml` — version numbers only, no identifiers. AppImage builds skip
  it by choice, and blocking it breaks nothing.
* **License refresh (Premium only)**: logged-in Premium installs re-validate
  the key once on launch (device ID + key, once). Free tier and logged-out
  installs contact nothing.
* **Sync (only if logged in)**: encrypted blobs go up on local change and
  down on login. The server never sees plaintext.
* **Store, account dashboard, support**: ordinary HTTPS page loads, only
  when you open them. Browsing the web never touches our servers.

## The store

What it sells is data-only cosmetics — theme colour maps, accent palettes,
logo images, wallpapers, cursor colours, bundles. No executables, no
plugins, nothing that runs code.

You need an account to install because entitlements live on your account and
sync to your devices; there is no other delivery mechanism. Browsing the
catalogue needs nothing.

Installs only work inside Kastrava, because applying a theme writes into this
browser's theme engine — other browsers have no such engine, so it would
silently do nothing. The page checks the honest `Kastrava/<version>` token in
the User-Agent client-side and the server re-checks the request header. It's
a compatibility gate, not fingerprinting, and the token exists precisely so
the check never needs heuristics.

Prices are per item, plus an optional 30-day Full Catalogue Pass. Premium
members claim everything free; stock themes are free for everyone; paid
items are one-time purchases. Payments happen only at checkout — Razorpay
(India), PayPal (most countries), YooKassa (Russia/CIS) — handled by those
processors. We store the receipt, never card data.

Retention, since people ask: login sessions expire after 30 days, email
codes after 10 minutes, the security log keeps the last 100 events, and
deleting your account purges keys, sync blobs, sessions, items and audit
rows. Purchase receipts (order ID, amount, key) are kept for refunds and tax
records.

Searching from inside the browser sends only your queries, and only to the
engine you picked (KastravaSearch by default). Everything in this section
travels over HTTPS — TLS, Let's Encrypt — with no plaintext and no custom
protocols.

No third-party security audit has been done — one developer, stated plainly.
The code is GPLv3 and every claim above points at the file that implements
it, so you don't have to trust any of it.

## Building it

You need Node 18+, npm and Git.

```bash
git clone https://github.com/tejaskhanna989/kastrava.git
cd kastrava
npm install

npm start        # run from source, development mode
npm run dist     # production packages → release/
```

Android builds come from `android/` with the usual Gradle tasks.

## Contributing

Fork it, make a branch (`git checkout -b feature/whatever`), commit, push,
open a PR. That's the whole process.

Premium funds the project ([pricing here](https://kastrava.in/#premium)).
For priority support, consultation or sponsorship, write to
email-center@kastrava.in.

## License

Kastrava
Copyright (C) 2026 Tejas Khanna

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See the LICENSE file for details.
