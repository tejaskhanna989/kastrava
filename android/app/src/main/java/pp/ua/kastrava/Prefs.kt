package pp.ua.kastrava

import android.content.Context
import androidx.preference.PreferenceManager

/**
 * User settings. Free ships KastravaSearch + DuckDuckGo and one light/dark
 * theme pair; Premium unlocks Brave/Google/Ecosia and accent themes —
 * same split as the desktop free/Premium FAQ.
 */
class Prefs(context: Context) {
    private val p = PreferenceManager.getDefaultSharedPreferences(context)

    var engine: String
        get() = p.getString("engine", "kastrava") ?: "kastrava"
        set(v) { p.edit().putString("engine", v).apply() }

    var theme: String
        get() = p.getString("theme", "system") ?: "system"
        set(v) { p.edit().putString("theme", v).apply() }

    /** UI language: system | en | ru. Default comes from the flavor
     *  (std = follow the device, ru = pinned to Russian). */
    var language: String
        get() = p.getString("language", BuildConfig.DEFAULT_LANG) ?: BuildConfig.DEFAULT_LANG
        set(v) { p.edit().putString("language", v).apply() }

    // Store theme (data-only cosmetics from the Kastrava Store).
    // Applied natively by ThemeEngine; cursors are desktop-only and
    // never stored here.
    var storeThemeId: String
        get() = p.getString("storeThemeId", "") ?: ""
        set(v) { p.edit().putString("storeThemeId", v).apply() }
    var storeThemeBg: String
        get() = p.getString("storeThemeBg", "") ?: ""
        set(v) { p.edit().putString("storeThemeBg", v).apply() }
    var storeThemeBar: String
        get() = p.getString("storeThemeBar", "") ?: ""
        set(v) { p.edit().putString("storeThemeBar", v).apply() }
    var storeAccent: String
        get() = p.getString("storeAccent", "") ?: ""
        set(v) { p.edit().putString("storeAccent", v).apply() }
    var storeWallpaper: String
        get() = p.getString("storeWallpaper", "") ?: ""
        set(v) { p.edit().putString("storeWallpaper", v).apply() }

    var blockers: Boolean
        get() = p.getBoolean("blockers", true)
        set(v) { p.edit().putBoolean("blockers", v).apply() }

    var javaScript: Boolean
        get() = p.getBoolean("javascript", true)
        set(v) { p.edit().putBoolean("javascript", v).apply() }

    var textZoom: Int
        get() = p.getInt("textZoom", 100).coerceIn(50, 200)
        set(v) { p.edit().putInt("textZoom", v.coerceIn(50, 200)).apply() }

    // Default page font size (px), desktop Font Size equivalent.
    var fontSize: Int
        get() = p.getInt("fontSize", 16).coerceIn(12, 24)
        set(v) { p.edit().putInt("fontSize", v.coerceIn(12, 24)).apply() }

    // Ported desktop controls.
    // Cookie mode: block-all (desktop "off", default), first-party-only
    // (desktop "third"), or allow. Legacy cookiesBlocked kept for old sync
    // blobs: true maps to block-all.
    var cookieMode: String
        get() = p.getString("cookieMode", if (p.getBoolean("cookiesBlocked", true)) "block" else "allow") ?: "block"
        set(v) { p.edit().putString("cookieMode", v).apply() }

    var cookiesBlocked: Boolean
        get() = cookieMode == "block"
        set(v) { cookieMode = if (v) "block" else "allow" }

    var loadImages: Boolean
        get() = p.getBoolean("loadImages", true)
        set(v) { p.edit().putBoolean("loadImages", v).apply() }

    var desktopDefault: Boolean
        get() = p.getBoolean("desktopDefault", false)
        set(v) { p.edit().putBoolean("desktopDefault", v).apply() }

    var showQuick: Boolean
        get() = p.getBoolean("showQuick", true)
        set(v) { p.edit().putBoolean("showQuick", v).apply() }

    // Restore tabs on launch (desktop Startup = restore session).
    var restoreTabs: Boolean
        get() = p.getBoolean("restoreTabs", true)
        set(v) { p.edit().putBoolean("restoreTabs", v).apply() }

    // Tab cap: 0 = no limit (desktop maxTabs).
    var maxTabs: Int
        get() = p.getInt("maxTabs", 0)
        set(v) { p.edit().putInt("maxTabs", v).apply() }

    // Ask before closing all tabs (desktop Confirm Close).
    var confirmClose: Boolean
        get() = p.getBoolean("confirmClose", true)
        set(v) { p.edit().putBoolean("confirmClose", v).apply() }

    // Full URL in the address bar vs site name (desktop showFullUrls).
    var showFullUrls: Boolean
        get() = p.getBoolean("showFullUrls", false)
        set(v) { p.edit().putBoolean("showFullUrls", v).apply() }

    // Custom search template, %s = query (desktop customEngine, free).
    var customEngine: String
        get() = p.getString("customEngine", "") ?: ""
        set(v) { p.edit().putString("customEngine", v).apply() }

    // Quick-access tiles on home (desktop ntpTiles 4/8/12).
    var ntpTiles: Int
        get() = p.getInt("ntpTiles", 8)
        set(v) { p.edit().putInt("ntpTiles", v).apply() }

    // Recording switches (desktop historyEnabled / bookmarksEnabled).
    // Website data is still always wiped on exit — off only stops keeping
    // session/bookmarks UI around.
    var historyEnabled: Boolean
        get() = p.getBoolean("historyEnabled", true)
        set(v) { p.edit().putBoolean("historyEnabled", v).apply() }

    var bookmarksEnabled: Boolean
        get() = p.getBoolean("bookmarksEnabled", true)
        set(v) { p.edit().putBoolean("bookmarksEnabled", v).apply() }

    // Content hardening (desktop Privacy & Security equivalents).
    var safeBrowsing: Boolean
        get() = p.getBoolean("safeBrowsing", true)
        set(v) { p.edit().putBoolean("safeBrowsing", v).apply() }

    var blockMixed: Boolean
        get() = p.getBoolean("blockMixed", true)
        set(v) { p.edit().putBoolean("blockMixed", v).apply() }

    var geoEnabled: Boolean
        get() = p.getBoolean("geoEnabled", false)
        set(v) { p.edit().putBoolean("geoEnabled", v).apply() }

    var fileAccess: Boolean
        get() = p.getBoolean("fileAccess", false)
        set(v) { p.edit().putBoolean("fileAccess", v).apply() }

    // Hardware acceleration for page rendering (desktop hwAcc).
    var hwAccel: Boolean
        get() = p.getBoolean("hwAccel", true)
        set(v) { p.edit().putBoolean("hwAccel", v).apply() }

    // Sync bookkeeping (server revision, last merged base, content hash).
    fun syncRev(): Long = p.getLong("sync_rev", 0)
    fun syncBase(): String = p.getString("sync_base", "{}") ?: "{}"
    fun syncHash(): String = p.getString("sync_hash", "") ?: ""
    fun syncAt(): Long = p.getLong("sync_last_at", 0)
    fun setSyncState(rev: Long, base: String, hash: String) {
        p.edit().putLong("sync_rev", rev).putString("sync_base", base).putString("sync_hash", hash).apply()
    }
    fun setSyncAt(t: Long) {
        p.edit().putLong("sync_last_at", t).apply()
    }

    // Battery saver (default on): hidden tabs are paused so their pages
    // stop burning CPU; everything resumes on switch. App backgrounding
    // additionally freezes all JS timers until return.
    var batterySaver: Boolean
        get() = p.getBoolean("batterySaver", true)
        set(v) { p.edit().putBoolean("batterySaver", v).apply() }

    // Session restore (URLs only — pages reload fresh, logged out, exactly
    // like the desktop volatile session). Empty means fresh start.
    var sessionTabs: String
        get() = p.getString("session_tabs", "") ?: ""
        set(v) { p.edit().putString("session_tabs", v).apply() }

    var sessionActive: Int
        get() = p.getInt("session_active", -1)
        set(v) { p.edit().putInt("session_active", v).apply() }

    companion object {
        const val KASTRA_SEARCH = "https://search.kastrava.in/search?q="
        // KastravaSearch (SearXNG) picks the result language from the
        // requester's IP when none is given. The RU build pins it to Russian
        // so results match the UI regardless of where the device is.
        private val SEARCH_LANG_SUFFIX =
            if (BuildConfig.SEARCH_LANG.isEmpty()) "" else "&language=" + BuildConfig.SEARCH_LANG
        val ENGINES = mapOf(
            "kastrava" to ("KastravaSearch" to KASTRA_SEARCH),
            "duckduckgo" to ("DuckDuckGo" to "https://duckduckgo.com/?q="),
            "brave" to ("Brave" to "https://search.brave.com/search?q="),
            "google" to ("Google" to "https://www.google.com/search?q="),
            "ecosia" to ("Ecosia" to "https://www.ecosia.org/search?q="),
            "custom" to ("Custom" to ""),
        )
        val FREE_ENGINES = setOf("kastrava", "duckduckgo", "custom")

        fun searchUrl(engine: String, premium: Boolean, query: String, custom: String = ""): String {
            if (engine == "custom") {
                val t = custom.trim()
                if (t.isNotEmpty() && (premium || !customIsPremium(t))) {
                    return if (t.contains("%s")) t.replace("%s", query) else t + query
                }
                return KASTRA_SEARCH + query + SEARCH_LANG_SUFFIX
            }
            val key = if (!premium && engine !in FREE_ENGINES) "kastrava" else engine
            val base = ENGINES[key]?.second ?: KASTRA_SEARCH
            // Pin the result language only for KastravaSearch; other engines
            // follow their own locale handling.
            val suffix = if (base == KASTRA_SEARCH) SEARCH_LANG_SUFFIX else ""
            return base + query + suffix
        }

        /** True when a custom template points at a Premium engine's domain. */
        fun customIsPremium(template: String): Boolean {
            return try {
                val h = android.net.Uri.parse(template.trim()).host?.lowercase() ?: return false
                h == "search.brave.com" || h == "brave.com" ||
                    h == "ecosia.org" || h == "www.ecosia.org" ||
                    h == "google.com" || h.startsWith("google.") || h.endsWith(".google.com") ||
                    (h.startsWith("www.google.") || h.startsWith("maps.google."))
            } catch (e: Exception) {
                false
            }
        }
    }
}
