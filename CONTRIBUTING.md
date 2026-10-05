# Contributing to Kastrava

Kastrava is built by the community, for the community — under **GPLv3**.
Land a PR and you land on the [Authors page](https://kastrava.pp.ua/authors.html).

## Golden rule: never push to `main`

All work happens on a **new branch**, reviewed via pull request:

```sh
git checkout main
git pull origin main
git checkout -b feature/vertical-tabs-drag
# ... work ...
git push origin feature/vertical-tabs-drag
```

Then open a PR against `main` on GitHub. Direct pushes to `main` will be
reverted. Name branches `feature/<what>`, `fix/<what>` or `docs/<what>`.

## Setup

```sh
git clone https://github.com/tejaskhanna989/kastrava.git
cd kastrava
npm ci
npm run build:dev   # desktop: webpack dev bundle
npm start           # runs the Electron app
```

Android lives in `android/` (needs JDK 17 + Android SDK, API 34):

```sh
cd android
gradle :app:assembleDebug
```

## What to work on

- Bugs reported on the [KendraServer Discord](https://discord.gg/UsgF73RJbx)
- Anything in the app marked RC / unfinished
- Docs, icons, translations, tests

Unsure? Ask on Discord before writing code — a 2-minute question can save
a 2-day PR.

## Rules for code

1. **Privacy claims stay literally true.** If your change touches browsing
   data, sessions, downloads, telemetry (there is none — keep it that way)
   or licensing, say so in the PR description.
2. **Premium stays strictly pro.** Every Premium feature must be gated
   behind `isPremium()`/`requirePremium()` on *every* entry point
   (buttons, shortcuts, settings controls, setup wizard). If you add a new
   way to reach a Premium feature, gate it the same way.
3. **No new network calls without disclosure.** List every new host/endpoint
   in the PR.
4. Match the existing code style (plain JS in `src/`, Kotlin in `android/`).
5. Don't commit secrets, keystores, payment keys or personal data. Ever.

## Testing a PR

- Desktop: `npm run build:prod` must succeed; smoke-test install, launch,
  a fresh profile (check the first-run setup), and one Premium gate.
- Android: `gradle :app:assembleRelease` must succeed.
- Site (`site/`): open `index.html` — valid HTML, all links live.

## License

By contributing you agree your work is released under the
[GNU GPLv3](LICENSE) like everything else here. If you fork, your changes
stay open too.
