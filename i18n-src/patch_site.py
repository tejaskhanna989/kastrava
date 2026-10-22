#!/usr/bin/env python3
"""Patch all 8 site pages for the shared wl.js runtime."""
import re

SITE = '/home/tejas/Projects/antersurf/site'
PAGES = ['index', 'store', 'privacy', 'terms', 'refunds', 'contact', 'authors']
WL_TAG = '<script src="/wl.js?v=1"></script>'


def patch_include(raw, page):
    assert WL_TAG not in raw, page + ' already patched'
    first = raw.find('\n<script')
    assert first > 0, page
    head_end = raw.find('</head>')
    assert 0 < first < head_end, '%s: first script not in head (%d vs %d)' % (page, first, head_end)
    nl = raw.rfind('\n', 0, first)
    return raw[:nl + 1] + '  ' + WL_TAG + '\n' + raw[nl + 1:]


def replace_i18n_block(raw, replacement, page):
    start = raw.find('function wlLang()')
    assert start > 0, page + ': wlLang not found'
    m = re.search(r'\n\(function\(\)\{var b=document\.getElementById\(\'lang-btn\'\).*?\}\)\(\);\n', raw[start:])
    assert m, page + ': lang-btn IIFE not found'
    end = start + m.end()
    return raw[:start] + replacement + '\n' + raw[end:]


def patch_index(raw):
    # old i18n block -> shared-runtime hooks
    hooks = (
        "window.wlSkipKeys=['hero-prem'];\n"
        "window.wlApplyExtra=function(){var hp=document.getElementById('hero-prem');"
        "if(!hp||hp.dataset.geo)return;var k=(typeof wlT==='function')?wlT('hero-prem'):'';"
        "if(k&&k!=='hero-prem')hp.innerHTML=k;};"
    )
    raw = replace_i18n_block(raw, hooks, 'index')
    # apkr_note key into inline dicts (en + ru)
    a_old = '"signup_cont": "Create account & continue"},ru:'
    a_new = '"signup_cont": "Create account & continue", "apkr_note": "Russian edition — interface locked to Russian."},ru:'
    assert raw.count(a_old) == 1, 'index en-dict tail'
    raw = raw.replace(a_old, a_new)
    b_old = '"signup_cont": "Создать аккаунт и продолжить"}};'
    b_new = '"signup_cont": "Создать аккаунт и продолжить", "apkr_note": "Русская версия — интерфейс всегда на русском."}};'
    assert raw.count(b_old) == 1, 'index ru-dict tail'
    raw = raw.replace(b_old, b_new)
    # geo os-note uses wlT now
    c_old = "an.textContent=wlLang()==='ru'?'Русская версия — интерфейс всегда на русском.':'Russian edition — interface locked to Russian.';"
    c_new = "an.textContent=(typeof wlT==='function'&&wlT('apkr_note')!=='apkr_note')?wlT('apkr_note'):'Russian edition — interface locked to Russian.';"
    assert raw.count(c_old) == 1, 'index os-note'
    raw = raw.replace(c_old, c_new)
    return raw


def patch_store(raw):
    hooks = (
        "window.wlApplyExtra=function(){try{if(typeof paint==='function'&&typeof ALL_ITEMS!=='undefined'"
        "&&ALL_ITEMS.length)paint(ALL_ITEMS);}catch(e){}};"
    )
    raw = replace_i18n_block(raw, hooks, 'store')
    # cat_* labels into inline dicts (wlCat now reads cat_<id>)
    en_old = '"wrong": "Wrong email or password."},ru:'
    en_new = ('"wrong": "Wrong email or password.", '
              '"cat_all": "All", "cat_theme": "Themes", "cat_accents": "Accents", '
              '"cat_logos": "Logos", "cat_wallpaper": "Wallpapers", "cat_combo": "Combos"},ru:')
    assert raw.count(en_old) == 1, 'store en-dict tail'
    raw = raw.replace(en_old, en_new)
    ru_old = '"wrong": "Неверная почта или пароль."},cats:'
    ru_new = ('"wrong": "Неверная почта или пароль.", '
              '"cat_all": "Все", "cat_theme": "Темы", "cat_accents": "Акценты", '
              '"cat_logos": "Логотипы", "cat_wallpaper": "Обои", "cat_combo": "Комбо"},cats:')
    assert raw.count(ru_old) == 1, 'store ru-dict tail'
    raw = raw.replace(ru_old, ru_new)
    return raw


def main():
    for page in PAGES:
        path = '%s/%s.html' % (SITE, page)
        raw = open(path, encoding='utf-8').read()
        raw = patch_include(raw, page)
        if page == 'index':
            raw = patch_index(raw)
        elif page == 'store':
            raw = patch_store(raw)
        open(path, 'w', encoding='utf-8').write(raw)
        print('patched', page)


if __name__ == '__main__':
    main()
