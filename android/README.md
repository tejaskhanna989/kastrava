# Kastrava for Android

Native Kotlin/WebView app — a separate project from the Electron desktop
builds (Electron cannot produce APKs). Same brand, same defaults, same
license server.

## What it is (v1)

- Tabbed browser (WebView): omnibox, home with KastravaSearch default,
  back/forward/reload, tab list, external-scheme delegation.
- Tracker/ad blocking at the network layer from the same EasyList +
  EasyPrivacy + Fanboy Cookiemonster sources as desktop (host rules,
  refreshed every 24h).
- Session downloads: files stream into a volatile app-cache area and reach
  shared Downloads only via an explicit Save — same rule as desktop.
- Website data (cookies, DOM storage, cache) wiped on exit; crash leftovers
  purged at launch. Settings + Premium license persist.
- Premium: same `KAS2-…` machine-code format (`android|abi|android-id`
  hashed — the server treats `machine_id` as opaque), same
  `POST /api/activate`, Ed25519 signature verified on-device with the same
  kastrasoft public key. Free ships KastravaSearch + DuckDuckGo;
  Premium unlocks Brave/Google/Ecosia.

## Build

CI (`android` job in `.github/workflows/release.yml`) builds a **release**
APK on every tag/dispatch: `Kastrava-<version>.apk`, attached to the GitHub
Release and served from `kastrava.in/dl/`. It is signed with the release
keystore when the `ANDROID_KS_B64` / `ANDROID_KS_PASS` repo secrets exist,
otherwise debug-signed (CI says so in the log — never ship that one).

Local build needs the Android SDK (API 34) + JDK 17:

```sh
cd android
gradle :app:assembleDebug
```

## Play Store (you publish, like the MSIX)

1. Create the app in Play Console (`pp.ua.kastrava`).
2. The upload keystore already exists (RSA-2048, 30y, alias `kastrava`,
   held by the maintainer — never committed). Its base64 + password live in
   the `ANDROID_KS_B64` / `ANDROID_KS_PASS` GitHub secrets; **back them up
   offline — losing the keystore means losing update continuity forever**.
3. Add a `release` signing config pointing at it (never commit the
   keystore/passwords — use env vars or `local.properties`).
4. `gradle :app:bundleRelease` → upload the `.aab`. Google signs the APKs.
