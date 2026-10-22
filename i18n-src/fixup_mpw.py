#!/usr/bin/env python3
"""Post-pass: add the dangling `m_pw` key properly.

index.html has data-wlp="m_pw" but the key never existed in any dict — the
password placeholder on the login card was English-only for every language.
Adds the key to site.en.json and to all 19 non-English site dictionaries.

Run AFTER all translation agents have finished (they validate against
site.en.json — adding keys mid-flight would race them).
"""
import json
import os
import re

ROOT = os.path.expanduser('~/Projects/antersurf')
KEY = 'm_pw'
SOURCE = 'Password (8+ characters)'

# Hand-written, consistent with each language's product tone elsewhere.
TRANSLATIONS = {
    'ru': 'Пароль (8+ символов)',
    'hi': 'पासवर्ड (8+ अक्षर)',
    'ja': 'パスワード（8文字以上）',
    'ko': '비밀번호 (8자 이상)',
    'zh': '密码（8+ 个字符）',
    'ar': 'كلمة المرور (8+ أحرف)',
    'de': 'Passwort (8+ Zeichen)',
    'fr': 'Mot de passe (8+ caractères)',
    'es': 'Contraseña (8+ caracteres)',
    'pt': 'Senha (8+ caracteres)',
    'tr': 'Parola (8+ karakter)',
    'id': 'Kata sandi (8+ karakter)',
    'th': 'รหัสผ่าน (8+ อักขระ)',
    'uk': 'Пароль (8+ символів)',
    'it': 'Password (8+ caratteri)',
    'pl': 'Hasło (8+ znaków)',
    'nl': 'Wachtwoord (8+ tekens)',
    'bn': 'পাসওয়ার্ড (৮+ অক্ষর)',
}


def main():
    src_path = os.path.join(ROOT, 'i18n-src', 'site.en.json')
    src = json.load(open(src_path))
    src[KEY] = SOURCE
    json.dump(src, open(src_path, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
    print('site.en.json -> %d keys' % len(src))

    for code, tr in TRANSLATIONS.items():
        p = os.path.join(ROOT, 'site', 'lang', code + '.js')
        if not os.path.exists(p):
            print('%-3s SKIPPED (file missing)' % code)
            continue
        raw = open(p, encoding='utf-8').read()
        m = re.match(r'(var WEBSTR_X=)(?:globalThis\.WEBSTR_X=)?(\{.*\})(;?\s*)$', raw, re.S)
        if not m:
            print('%-3s SKIPPED (unparseable — in flight?)' % code)
            continue
        d = json.loads(m.group(2))
        if KEY in d:
            print('%-3s already has m_pw' % code)
            continue
        d[KEY] = tr
        body = 'var WEBSTR_X={' + ','.join(
            '%s:%s' % (json.dumps(k), json.dumps(d[k], ensure_ascii=False))
            for k in sorted(d)) + '};'  # canonical: also drops any mirror
        open(p, 'w', encoding='utf-8').write(body + '\n')
        print('%-3s m_pw added (%d keys)' % (code, len(d)))


if __name__ == '__main__':
    main()
