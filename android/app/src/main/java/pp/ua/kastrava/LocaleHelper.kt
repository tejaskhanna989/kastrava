package pp.ua.kastrava

import android.content.Context
import android.content.res.Configuration
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import java.util.Locale

/** Runtime language choice. Applied via AppCompatDelegate per-app locales. */
object LocaleHelper {
    const val SYSTEM = "system"
    const val EN = "en"
    const val RU = "ru"

    /** (code, native label) — every shipped language; picked in Settings. */
    val LANGS = listOf(
        "en" to "English", "hi" to "हिन्दी", "ru" to "Русский", "ja" to "日本語",
        "ko" to "한국어", "zh" to "中文", "ar" to "العربية", "de" to "Deutsch",
        "fr" to "Français", "es" to "Español", "pt" to "Português", "tr" to "Türkçe",
        "id" to "Bahasa Indonesia", "th" to "ไทย",
        "uk" to "Українська", "it" to "Italiano", "pl" to "Polski",
        "nl" to "Nederlands", "bn" to "বাংলা"
    )

    fun apply(code: String) {
        val supported = LANGS.any { it.first == code }
        val locales = if (code == SYSTEM || !supported) {
            LocaleListCompat.getEmptyLocaleList()
        } else {
            LocaleListCompat.forLanguageTags(code)
        }
        AppCompatDelegate.setApplicationLocales(locales)
    }

    /**
     * Forced-build hook, called from every Activity's attachBaseContext.
     * On the RuStore flavor (FORCE_RU) the base context is rebuilt with a
     * Russian configuration before any resource resolves, so the UI comes
     * up Russian regardless of the device locale, an Android 13+ per-app
     * language override or any stored pref. No-op on the std flavor.
     */
    fun force(base: Context): Context {
        if (!BuildConfig.FORCE_RU) return base
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(Locale(RU))
        return base.createConfigurationContext(cfg)
    }
}
