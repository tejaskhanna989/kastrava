# Kastrava Browser

An open-source, GPLv3-licensed, privacy-first web browser designed for modern web standards, deep desktop integration, and flexible user workflows.

---

## Model & Licensing

Kastrava is 100% open source under the **GNU General Public License v3.0 (GPLv3)** for both free and paid offerings—with **zero cloud dependence and zero telemetry**.

* **Free, forever**: Complete access to the full source code, build scripts, pre-compiled binaries, and core browser features under GPLv3. Downloads cost nothing.
* **Premium (paid service, not software)**: A paid account service — license keys (up to 10 devices), encrypted sync infrastructure, and email support. The browser itself stays free and open.

## Premium & Renewal

Premium is **$49/month (₹499, 30 days)** or **$4.99/day (₹49, 24 hours)**, one key per account, up to 10 devices. India pays in INR via Razorpay; most other countries pay in local currency via PayPal.

* **Manual renewal only** — pay again each cycle. Nothing auto-charges, nothing is stored. Renewing extends the same key.

Old 34-day keys keep working till their expiry date.

---

## How privacy works (mechanisms, not promises)

Everything below is implemented in the open source (`src/privacy.js`, `src/adblock.js`, `src/main.js`) — verify, don't trust:

* **Memory-only sessions**: cookies, cache, DOM storage, and IndexedDB live in RAM and die with the process. Quit (or crash) wipes website data; downloads in `~/Downloads` are never touched.
* **Tracker & ad blocking**: EasyList + EasyPrivacy + annoyances lists, compiled to regexes with a hostname fast-path (~600x faster than linear scan, verdict-identical). Blocks ad/tracker subresources before they load.
* **Cookie control**: three modes — block all, first-party only, allow — plus per-site shield exceptions. `Set-Cookie` headers are stripped at the network layer.
* **Anti-fingerprinting**: generic-Chrome `navigator` spoof (webdriver, plugins, languages, platform, hardwareConcurrency via `userAgentData`), canvas readback noise, font enumeration protection, frozen Battery/Connection APIs, WebRTC IP handling policies (disable / public-only / default).
* **Network hygiene**: `Referer` stripped or rewritten per shield, `DNT: 1` sent, optional DNS-over-HTTPS (Cloudflare/Quad9/Google, needs restart), mixed-content controls.
* **Script & image switches**: global JavaScript/images kill-switches plus per-site shields (JS off / images off / cookies allow / shields down).
* **Storage partitioning**: separate persistent partitions for app shell vs web content; guest popups (e.g. payment flows) run in the volatile session so bank cookies die too.
* **Zero telemetry**: no analytics, no crash reports, no update pings with identifiers. License activation sends one device ID + key, once; the app works fully offline after that.
* **Sync privacy**: bookmarks/settings sync as encrypted blobs the server stores but cannot read. Password resets intentionally destroy the old synced copy (new password = new key).

## Network truth: what talks to what, and when

No account, no browsing telemetry — ever. The core browser works fully offline after install. Anything below happens only as stated:

* **Update check (automatic, anonymous)**: on launch the app asks GitHub for `latest.yml` — version numbers only, no identifiers, no account needed. Disable it with AppImage builds (excluded by choice) or by blocking it; nothing breaks.
* **License refresh (only if Premium)**: logged-in Premium installs re-validate the key on launch (device ID + key, once). Free tier and logged-out installs contact nothing.
* **Sync (only if logged in)**: encrypted blobs upload on local change, download on login. The server never sees plaintext.
* **Store, account dashboard, support pages**: ordinary HTTPS page loads, only when you open them. Browsing the web never touches our servers.
* **Payments (only during checkout)**: Razorpay (India), PayPal (most countries), YooKassa (Russia/CIS). Handled by those processors; we store the receipt, never card data.
* **Search**: only your queries, only to the engine you picked (KastravaSearch default).
* **Transport**: everything above is HTTPS (TLS, Let's Encrypt). No plaintext, no custom protocols.
* **Retention**: login sessions expire after 30 days; email codes after 10 minutes; security log keeps the last 100 events per account; deleting your account purges keys, sync blobs, sessions, items, and audit. Purchase receipts (order ID, amount, key) are kept for refunds and tax records.
* **No security audit (yet)**: one developer, no third-party audit — stated plainly. The code is GPLv3 and every claim above points at the file that implements it, so anyone can verify.

## Features

* **Privacy-First & Offline-Focused**: No user tracking. Browsing data stays on your machine; optional account sync is end-to-end encrypted.
* **100% Open Codebase**: Fully transparent, community-driven, and licensed under GPLv3.
* **Desktop Integration**: Direct system hooks for high-performance navigation and shell interactions.
* **Modern Web Standards**: Full support for contemporary web APIs, client-side frameworks, and browser features.
* **Extensible Ecosystem**: Local-only plugin architecture for custom client modifications and offline extensions.

---

## Getting Started

### Prerequisites

Ensure you have the following installed on your system before building:

* Node.js (v18.0.0 or higher)
* npm or yarn
* Git

### Installation

1. Clone the repository:
   git clone https://github.com/tejaskhanna989/kastrava.git
   cd kastrava

2. Install dependencies:
   npm install

3. Run the application in development mode:
   npm start

---

## Building from Source

To compile production executables locally:

npm install
npm run dist

The finished packages are generated in the release/ directory. (`npm start` runs a dev build from source.)

---

## Premium & Sponsorship

Kastrava is entirely free and open source. The project is funded by Premium subscriptions ($49/month or $4.99/day at https://kastrava.pp.ua/#premium):

* Premium buyers get license keys, encrypted sync, and direct email support.
* Contact khannatejas989@gmail.com for priority handling, consultation, or enterprise sponsorship.

---

## Contributing

1. Fork the repository.
2. Create your feature branch (git checkout -b feature/NewFeature).
3. Commit your changes (git commit -m 'Add NewFeature').
4. Push to the branch (git push origin feature/NewFeature).
5. Open a Pull Request.

---

## License

Kastrava Browser  
Copyright (C) 2026 Tejas Khanna

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the LICENSE file for details.
