package pp.ua.kastrava

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import androidx.preference.PreferenceManager
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sideload self-update: version.json feed -> DownloadManager -> install
 * prompt. Only for direct-download builds; Play builds update via Play.
 */
data class UpdateInfo(
    val code: Long,
    val name: String,
    val url: String,
    val size: Long,
    val notes: String,
)

object Updater {
    const val FEED = "https://kastrava.pp.ua/version.json"
    private const val PREF_LAST_CHECK = "update_last_check"
    private const val PREF_DL_ID = "update_dl_id"
    private const val CHECK_INTERVAL = 48L * 60 * 60 * 1000

    private fun prefs(ctx: Context) =
        PreferenceManager.getDefaultSharedPreferences(ctx)

    private fun installedCode(ctx: Context): Long {
        return try {
            val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            PackageInfoCompat.getLongVersionCode(pi)
        } catch (e: Exception) {
            -1L
        }
    }

    /** Network + parse. Must run off the main thread. Returns null when fresh/failed. */
    fun check(ctx: Context, force: Boolean = false): UpdateInfo? {
        if (!force) {
            val last = prefs(ctx).getLong(PREF_LAST_CHECK, 0)
            if (System.currentTimeMillis() - last < CHECK_INTERVAL) return null
        }
        return try {
            prefs(ctx).edit().putLong(PREF_LAST_CHECK, System.currentTimeMillis()).apply()
            val conn = (URL(FEED).openConnection() as HttpURLConnection).apply {
                setRequestProperty("User-Agent", "Kastrava-Android")
                connectTimeout = 15000
                readTimeout = 15000
            }
            if (conn.responseCode != 200) return null
            val j = JSONObject(conn.inputStream.bufferedReader().readText())
            val code = j.optLong("version_code", -1)
            if (code <= installedCode(ctx)) return null
            val url = j.optString("apk_url")
            if (url.isBlank()) return null
            UpdateInfo(code, j.optString("version", "?"), url,
                j.optLong("apk_size", -1), j.optString("notes", ""))
        } catch (e: Exception) {
            null
        }
    }

    fun download(ctx: Context, info: UpdateInfo): Long {
        val file = File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
            "Kastrava-${info.name}.apk")
        try { if (file.exists()) file.delete() } catch (e: Exception) { }
        val req = DownloadManager.Request(Uri.parse(info.url)).apply {
            setTitle("Kastrava ${info.name}")
            setDescription("Downloading update")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationUri(Uri.fromFile(file))
            setAllowedOverMetered(true)
        }
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val id = dm.enqueue(req)
        prefs(ctx).edit().putLong(PREF_DL_ID, id).apply()
        return id
    }

    fun downloadedFile(ctx: Context): File? {
        val files = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?.listFiles { f -> f.name.startsWith("Kastrava-") && f.name.endsWith(".apk") }
            ?.sortedByDescending { it.lastModified() }
        return files?.firstOrNull()?.takeIf { it.length() > 1024 * 1024 }
    }

    fun promptInstall(ctx: Context, file: File): Boolean {
        return try {
            val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", file)
            val open = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (Build.VERSION.SDK_INT >= 29) {
                    putExtra(Intent.EXTRA_RETURN_RESULT, false)
                }
            }
            // Android 8+: unknown-source installs go through a system prompt.
            try {
                ctx.startActivity(open)
            } catch (e: Exception) {
                val settings = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    .setData(Uri.parse("package:" + ctx.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(settings)
                Toast.makeText(ctx, "Allow installs, then tap the downloaded APK", Toast.LENGTH_LONG).show()
                return false
            }
            true
        } catch (e: Exception) {
            Toast.makeText(ctx, "Could not open installer", Toast.LENGTH_SHORT).show()
            false
        }
    }

    class CompleteReceiver : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
            if (id != prefs(ctx).getLong(PREF_DL_ID, -2)) return
            val file = downloadedFile(ctx) ?: return
            promptInstall(ctx, file)
        }
    }
}
