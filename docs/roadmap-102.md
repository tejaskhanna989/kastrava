# Kastrava 102 — "more advanced" roadmap (locked 2026-10-05)

Tier principle: commodity = free, differentiators + anything with server cost = pro.
Reader Mode stays free. Premium gating strict on every entry point, as before.

## FREE (core, both apps unless noted)
- F2 Per-site shields panel (JS / blockers / cookies per domain)
- F3 Memory saver — auto-sleep inactive tabs + lazy load (desktop; Android: WebView pause)
- F6 Session restore + recently-closed tabs
- F7 Full-page screenshot + annotate
- F8 Command palette (Ctrl+K / in-app quick actions)
- F9 Cookie-banner auto-reject + tracking-param stripping
- F13 Vault — password-locked notes/bookmarks, local AES (user chose Free)

## PRO (one-time $2.8 / 34-day cycle, same key extends)
- P1 Tab groups + saved workspaces (desktop), grouped tab switcher (Android)
- P4 Theme engine v2 — custom accents, NTP art, custom CSS (user chose Pro)
- P5 Userscripts / userstyles manager
- P10 Disposable identity sessions — one-tap temp profile, wiped after
- P11 Encrypted sync desktop↔Android via passphrase (only feature with server cost)
- P12 Read-aloud TTS + read-later queue
- P14 Background audio + PiP queue (Android) / PiP gallery (desktop)
- P15 Advanced download manager — parallel chunks, auto-save rules

## Build order (proposed)
- Batch A (free, desktop, no server): F6, F8, F7, F9, F3, F2
- Batch B (free, Android): F6, F7, F9, F3-webview, F13
- Batch C (pro, desktop): P1, P5, P10, P4, P12, P15
- Batch D (pro, Android): P1-switcher, P14, P12, P15-dm, P4
- Batch E (sync, both + server): P11 + P13-cross-device
