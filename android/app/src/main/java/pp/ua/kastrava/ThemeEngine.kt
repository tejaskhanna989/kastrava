package pp.ua.kastrava

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.View
import android.view.WindowManager

/**
 * Native counterpart of the desktop theme engine — data-only cosmetics,
 * no code execution. Applies store themes (toolbar/status/background),
 * accent packs (single highlight color) and wallpapers (home gradient).
 * Cursor packs are desktop-only and never applied here.
 */
object ThemeEngine {

    data class AppliedTheme(
        val id: String,
        val bg: String,
        val bar: String,
        val accent: String,
        val wallpaper: String
    )

    fun current(prefs: Prefs): AppliedTheme? {
        val id = prefs.storeThemeId
        if (id.isBlank()) return null
        return AppliedTheme(
            id, prefs.storeThemeBg, prefs.storeThemeBar,
            prefs.storeAccent, prefs.storeWallpaper
        )
    }

    fun applyTheme(prefs: Prefs, id: String, name: String, data: org.json.JSONObject) {
        prefs.storeThemeId = id
        prefs.storeThemeBg = data.optString("bg", "")
        // Desktop toolbar color doubles as the Android bar color.
        prefs.storeThemeBar = data.optString("tbg", data.optString("tb", ""))
        val ac = data.optString("ac", "")
        if (ac.isNotBlank()) prefs.storeAccent = ac
    }

    fun applyAccent(prefs: Prefs, color: String) {
        prefs.storeAccent = color
    }

    fun applyWallpaper(prefs: Prefs, css: String) {
        prefs.storeWallpaper = css
    }

    fun clear(prefs: Prefs) {
        prefs.storeThemeId = ""
        prefs.storeThemeBg = ""
        prefs.storeThemeBar = ""
        prefs.storeAccent = ""
        prefs.storeWallpaper = ""
    }

    fun parse(hex: String): Int? {
        return try {
            var h = hex.trim()
            if (!h.startsWith("#")) return null
            if (h.length == 4) h = "#" + h[1].toString().repeat(2) + h[2].toString().repeat(2) + h[3].toString().repeat(2)
            if (h.length != 7 && h.length != 9) return null
            Color.parseColor(h)
        } catch (e: Exception) { null }
    }

    /** Tint a MainActivity: status bar, toolbar area, home background. Safe no-ops on failure. */
    fun applyToActivity(activity: MainActivity, prefs: Prefs) {
        val t = current(prefs) ?: return
        try {
            parse(t.bar)?.let { bar ->
                if (Build.VERSION.SDK_INT >= 21) activity.window.statusBarColor = bar
                try {
                    val toolbar = activity.findViewById<View>(
                        activity.resources.getIdentifier("toolbar", "id", activity.packageName))
                    toolbar?.setBackgroundColor(bar)
                } catch (e: Exception) { }
            }
            val homeBg: View? = try {
                activity.findViewById(activity.resources.getIdentifier("homeView", "id", activity.packageName))
            } catch (e: Exception) { null }
            if (homeBg != null) {
                val wp = wallpaperGradient(t.wallpaper)
                if (wp != null) homeBg.background = wp
                else parse(t.bg)?.let { homeBg.setBackgroundColor(it) }
            }
        } catch (e: Exception) { }
    }

    /** linear-gradient(135deg, #a, #b) -> GradientDrawable, else null. */
    fun wallpaperGradient(css: String): GradientDrawable? {
        return try {
            val cols = Regex("#[0-9a-fA-F]{6}").findAll(css).map { parse(it.value) }.filterNotNull().toList()
            if (cols.size < 2) return null
            GradientDrawable(GradientDrawable.Orientation.TL_BR, cols.toIntArray()).apply { cornerRadius = 0f }
        } catch (e: Exception) { null }
    }
}
