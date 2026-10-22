# Translation task instructions (Kastrava — 20-language release)

You are localizing the Kastrava browser (privacy browser, GPLv3, desktop
Electron app + Android app + public website) into ONE target language.
Follow this document exactly. Work in `/home/tejas/Projects/antersurf`.

## Sources (read all that apply to your language)

| file | what | keys/strings |
|---|---|---|
| `i18n-src/site.en.json` | website strings, flat `{key: English}` | 419 |
| `i18n-src/desktop.en.json` | desktop app UI, flat `{key: English}` | 130 |
| `i18n-src/android.en.json` | Android app, `{name: {"xml": innerXML, "formatted": attr-or-null}}` | 246 |
| `i18n-src/site.ru-prefill.json` | RU-only: already-approved Russian for 135 site keys — **copy these verbatim, translate only the rest** | 135 |

## Your outputs (3 files, RU has only the first)

1. **`site/lang/<CODE>.js`** — website dictionary. Exact shape:

   ```js
   var WEBSTR_X={"nav_feat":"…","pri1":"…", /* every key from site.en.json */};
   ```

   - ONE single line, `var WEBSTR_X=` prefix, no other code, no exports.
   - Must contain **every key** from `i18n-src/site.en.json` (419 keys).
   - Some values contain HTML (`<b>…</b>`, `<br>`, `<em>`, `<a href=…>…</a>`,
     `<span class="grad-text">…</span>`). **Keep the tags inside the
     translation**, only the human text changes.
   - Keys starting with `cat_` are store category labels.

2. **`static/locales/<CODE>.json`** — desktop app dictionary: plain JSON
   object with **every key** from `i18n-src/desktop.en.json` (130 keys).
   These strings appear in tooltips, menus, dialogs and settings headings.

3. **`android/app/src/main/res/values-<ANDROID_DIR>/strings.xml`** — full
   Android resource file, same structure as
   `android/app/src/main/res/values/strings.xml`:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <resources>
       <string name="app_name">…</string>
       … all 246 strings, same names, same order …
   </resources>
   ```

   - Translate the `>text<` content only; keep `name="…"` attributes as-is.
   - **Placeholders must be preserved exactly**: `%1$s`, `%2$s`, `%1$d`, `%s`
     — same placeholders per string, may move position if grammar needs it
     but positional ones (`%1$s`) must keep referring to the same value.
   - **Android escaping rules**: apostrophe in a translation → `\'`
     (or wrap the whole value in double quotes); double quote → `\"` or
     `&quot;`; ampersand → `&amp;`. (The English source avoids all of these,
     your language may not.)
   - Keep `<string name="…">` attribute spelling identical; a build breaks
     on one missing name.

## Translation quality rules

- Idiomatic, natural UI language of a polished consumer app — not literal
  word-by-word rendering. Short imperative button labels; sentence-case.
- Privacy/security terminology: use the standard terms of the target
  language (the ones Chromium/Firefox use there when such exist).
- **Never translate**: Kastrava, KastravaSearch, Premium, GPL, GPLv3,
  Chromium, Electron, DevTools, Razorpay, PayPal, DuckDuckGo, Brave,
  Ecosia, GitHub, Localhost (as in "Localhost Dashboard" keep the technical
  word, translate "Dashboard"), URLs, e-mail addresses, file names,
  platform names (Linux, Windows, Android, APK, AppImage).
- Keep numbers, prices ($49/mo, ₹499, $4.99), version strings (v101.5.25),
  and key formats (KAS-XXXX-…) exactly as in the source.
- Right-to-left languages (Arabic): normal translation, no manual RTL marks.
- No English text left in translations except the untranslatable items
  above. No TODOs, no "...", no omissions — every key must be translated.

## Validation (run and fix until green)

```bash
cd /home/tejas/Projects/antersurf
# 1. site dict: parses + key parity (eval in global scope — require() would
#    module-scope `var WEBSTR_X` and hide it, exactly as the browser does NOT)
node -e "eval(require('fs').readFileSync('/home/tejas/Projects/antersurf/site/lang/<CODE>.js','utf8'));var k=Object.keys(WEBSTR_X);var src=Object.keys(JSON.parse(require('fs').readFileSync('/home/tejas/Projects/antersurf/i18n-src/site.en.json','utf8')));var miss=src.filter(x=>!k.includes(x));var extra=k.filter(x=>!src.includes(x));console.log('keys',k.length,'missing',miss,'extra',extra);if(miss.length)process.exit(1)"
# 2. desktop dict: JSON + key parity
python3 -c "import json;d=json.load(open('static/locales/<CODE>.json'));s=json.load(open('i18n-src/desktop.en.json'));m=[k for k in s if k not in d];print('keys',len(d),'missing',m);assert not m"
# 3. Android: XML parses, names match, placeholders match
python3 -c "
import json,re,xml.etree.ElementTree as ET
s=json.load(open('i18n-src/android.en.json'))
t=ET.parse('android/app/src/main/res/values-<ANDROID_DIR>/strings.xml').getroot()
d={e.get('name'):''.join(e.itertext()) for e in t}
m=[k for k in s if k not in d]
ph=lambda x:sorted(re.findall(r'%\d+\\\$?[sd]|%s',x))
bad=[k for k in s if k in d and ph(s[k]['xml'])!=ph(d[k])]
print('strings',len(d),'missing',m,'placeholder-mismatch',bad);assert not m and not bad"
```

Write each output file with the write tool as soon as it is complete
(site first, then Android, then desktop). If a file would be too large for
one write, split it into two writes (write part 1, then append part 2 with a
second tool call that rewrites the complete file). Validate at the end.
