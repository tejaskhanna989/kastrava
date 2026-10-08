package pp.ua.kastrava

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Kastrava account (login/logout) for Premium auto-activate + sync.
 * Session token + email live in private prefs; the encryption/password
 * never touch disk. License keys stay server-bound to the account —
 * up to 10 devices share one key.
 */
class AccountManager(private val context: Context) {

    private val prefs = context.getSharedPreferences("kastrava_account", Context.MODE_PRIVATE)

    fun email(): String? = prefs.getString("email", null)

    fun token(): String? = prefs.getString("token", null)

    fun syncSalt(): String? = prefs.getString("sync_salt", null)?.takeIf { it.isNotBlank() }

    fun loggedIn(): Boolean = !token().isNullOrBlank()

    /** Sync encryption key vault (AndroidKeyStore). Null when unavailable. */
    fun saveSyncKey(key: ByteArray): Boolean {
        return try {
            val alias = androidx.security.crypto.MasterKeys.getOrCreate(
                androidx.security.crypto.MasterKeys.AES256_GCM_SPEC,
            )
            val enc = androidx.security.crypto.EncryptedSharedPreferences.create(
                "kastrava_synckey", alias, context,
                androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            enc.edit().putString("key", android.util.Base64.encodeToString(key, android.util.Base64.NO_WRAP)).apply()
            true
        } catch (e: Exception) {
            false
        }
    }

    fun loadSyncKey(): ByteArray? {
        return try {
            val alias = androidx.security.crypto.MasterKeys.getOrCreate(
                androidx.security.crypto.MasterKeys.AES256_GCM_SPEC,
            )
            val enc = androidx.security.crypto.EncryptedSharedPreferences.create(
                "kastrava_synckey", alias, context,
                androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            val b64 = enc.getString("key", null) ?: return null
            android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
        } catch (e: Exception) {
            null
        }
    }

    fun clearSyncKey() {
        try {
            context.getSharedPreferences("kastrava_synckey", Context.MODE_PRIVATE).edit().clear().apply()
        } catch (e: Exception) { }
    }

    /** Network — must run off the main thread. Returns null on success. */
    /** Returns null on success, an error message, or NEED_TOTP. */
    fun login(email: String, password: String, totp: String = ""): String? {
        val e = email.trim().lowercase()
        if (!e.contains("@") || password.length < 8) return "Enter a valid email and 8+ character password."
        return try {
            val url = URL(LicenseManager.API + "/api/account/login")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                connectTimeout = 20000
                readTimeout = 20000
                doOutput = true
            }
            val payload = JSONObject().put("email", e).put("password", password)
            if (totp.isNotBlank()) payload.put("totp", totp.trim())
            conn.outputStream.use {
                it.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
            val code = conn.responseCode
            val text = try {
                (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.readText() ?: ""
            } catch (ex: Exception) { "" }
            if (code !in 200..299) {
                val je = try { JSONObject(text) } catch (ex: Exception) { null }
                val err = je?.optString("error") ?: ""
                if (err == "need_totp") return NEED_TOTP
                if (err == "bad_login") return "Wrong email or password."
                return je?.optString("msg")?.takeIf { it.isNotBlank() } ?: "Login failed (HTTP $code)."
            }
            val j = JSONObject(text)
            prefs.edit()
                .putString("email", j.optString("email", e))
                .putString("token", j.getString("token"))
                .putString("sync_salt", j.optString("sync_salt", ""))
                .putString("auth_salt", j.optString("auth_salt", ""))
                .apply()
            null
        } catch (e: Exception) {
            "Could not reach the Kastrava server. Check your connection."
        }
    }

    companion object {
        const val NEED_TOTP = "NEED_TOTP_SENTINEL"
    }

    fun logout() {
        prefs.edit().clear().apply()
        clearSyncKey()
    }
}
