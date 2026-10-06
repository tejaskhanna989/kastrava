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
class AccountManager(context: Context) {

    private val prefs = context.getSharedPreferences("kastrava_account", Context.MODE_PRIVATE)

    fun email(): String? = prefs.getString("email", null)

    fun token(): String? = prefs.getString("token", null)

    fun loggedIn(): Boolean = !token().isNullOrBlank()

    /** Network — must run off the main thread. Returns null on success. */
    fun login(email: String, password: String): String? {
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
            conn.outputStream.use {
                it.write(JSONObject().put("email", e).put("password", password).toString().toByteArray(Charsets.UTF_8))
            }
            val code = conn.responseCode
            val text = try {
                (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.readText() ?: ""
            } catch (ex: Exception) { "" }
            if (code !in 200..299) {
                val err = try { JSONObject(text).optString("error") } catch (ex: Exception) { "" }
                return if (err == "bad_login") "Wrong email or password." else "Login failed (HTTP $code)."
            }
            val j = JSONObject(text)
            prefs.edit()
                .putString("email", j.optString("email", e))
                .putString("token", j.getString("token"))
                .apply()
            null
        } catch (e: Exception) {
            "Could not reach the Kastrava server. Check your connection."
        }
    }

    fun logout() {
        prefs.edit().clear().apply()
    }
}
