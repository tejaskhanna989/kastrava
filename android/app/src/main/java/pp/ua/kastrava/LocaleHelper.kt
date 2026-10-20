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

    fun apply(code: String) {
        val locales = when (code) {
            EN -> LocaleListCompat.forLanguageTags("en")
            RU -> LocaleListCompat.forLanguageTags("ru")
            else -> LocaleListCompat.getEmptyLocaleList()
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
