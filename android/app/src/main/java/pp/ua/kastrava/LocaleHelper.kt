package pp.ua.kastrava

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

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
}
