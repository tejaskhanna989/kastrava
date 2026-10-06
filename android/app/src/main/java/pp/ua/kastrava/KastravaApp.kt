package pp.ua.kastrava

import android.app.Application
import android.webkit.CookieManager
import android.webkit.WebStorage

/**
 * App-scoped singletons. Website data (cookies, DOM storage, WebView cache,
 * session downloads) is wiped on exit — mirroring the desktop volatile
 * session. Settings and the Premium license persist.
 */
class KastravaApp : Application() {
    lateinit var prefs: Prefs
    lateinit var filters: FilterLists
    lateinit var downloads: SessionDownloads
    lateinit var license: LicenseManager
    lateinit var account: AccountManager

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        filters = FilterLists(this)
        downloads = SessionDownloads(this)
        license = LicenseManager(this)
        account = AccountManager(this)
        applyTheme()
        // Crash leftovers must never outlive their session.
        Thread { downloads.wipe() }.start()
        Thread { filters.load() }.start()
    }

    fun applyTheme() {
        val mode = when (prefs.theme) {
            "light" -> androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_NO
            "dark" -> androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_YES
            else -> androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
        }
        androidx.appcompat.app.AppCompatDelegate.setDefaultNightMode(mode)
    }

    /** Drop all website data. Called when the browser task is removed. */
    fun wipeSession() {
        try {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
        } catch (e: Exception) { }
        try {
            WebStorage.getInstance().deleteAllData()
        } catch (e: Exception) { }
        try {
            cacheDir.resolve("volatile-dl").deleteRecursively()
        } catch (e: Exception) { }
        downloads.wipe()
    }
}
