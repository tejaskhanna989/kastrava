package pp.ua.kastrava

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Phase 3: Android sync engine. Same zero-knowledge protocol as desktop
 * (docs/sync-protocol.md) — PBKDF2-HMAC-SHA256 (200k) + AES-256-GCM, the
 * server storing only an opaque blob. Merges bookmarks (union by URL) and
 * prefs (per-key: untouched-take-remote, changed-keep-local).
 */
object Sync {

    data class Result(val ok: Boolean, val msg: String, val rev: Long = 0)

    private const val PREF_REV = "sync_rev"
    private const val PREF_BASE = "sync_base"
    private const val PREF_HASH = "sync_hash"
    private const val PREF_AT = "sync_last_at"

    fun derive(password: String, saltHex: String): ByteArray {
        val salt = try {
            Base64.decode(saltHex, Base64.DEFAULT)
        } catch (e: Exception) {
            saltHex.toByteArray(Charsets.UTF_8)
        }
        val spec = PBEKeySpec(password.toCharArray(), salt, 200000, 256)
        val f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return SecretKeySpec(f.generateSecret(spec).encoded, "AES").encoded
    }

    fun encrypt(key: ByteArray, json: String): String {
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        val ct = c.doFinal(json.toByteArray(Charsets.UTF_8))
        val out = ByteArray(iv.size + ct.size)
        System.arraycopy(iv, 0, out, 0, iv.size)
        System.arraycopy(ct, 0, out, iv.size, ct.size)
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    fun decrypt(key: ByteArray, blob: String): JSONObject? {
        return try {
            val raw = Base64.decode(blob, Base64.DEFAULT)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, raw, 0, 12))
            JSONObject(String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }

    private fun snapshotPrefs(app: KastravaApp): JSONObject {
        val p = app.prefs
        return JSONObject()
            .put("engine", p.engine)
            .put("theme", p.theme)
            .put("blockers", p.blockers)
            .put("javascript", p.javaScript)
            .put("textZoom", p.textZoom)
            .put("fontSize", p.fontSize)
            .put("batterySaver", p.batterySaver)
            .put("cookieMode", p.cookieMode)
            .put("cookiesBlocked", p.cookiesBlocked)
            .put("loadImages", p.loadImages)
            .put("desktopDefault", p.desktopDefault)
            .put("showQuick", p.showQuick)
            .put("restoreTabs", p.restoreTabs)
            .put("maxTabs", p.maxTabs)
            .put("confirmClose", p.confirmClose)
            .put("showFullUrls", p.showFullUrls)
            .put("customEngine", p.customEngine)
            .put("ntpTiles", p.ntpTiles)
            .put("historyEnabled", p.historyEnabled)
            .put("bookmarksEnabled", p.bookmarksEnabled)
            .put("safeBrowsing", p.safeBrowsing)
            .put("blockMixed", p.blockMixed)
            .put("geoEnabled", p.geoEnabled)
            .put("fileAccess", p.fileAccess)
            .put("hwAccel", p.hwAccel)
    }

    private fun stable(o: Any?): String {
        if (o == null || o === JSONObject.NULL) return "null"
        if (o is JSONObject) {
            val keys = mutableListOf<String>()
            val it = o.keys()
            while (it.hasNext()) keys.add(it.next())
            keys.sort()
            return "{" + keys.joinToString(",") { k -> JSONObject.quote(k) + ":" + stable(o.opt(k)) } + "}"
        }
        if (o is JSONArray) {
            return "[" + (0 until o.length()).joinToString(",") { stable(o.opt(it)) } + "]"
        }
        return JSONObject.valueToString(o)
    }

    private fun sha(s: String): String {
        val d = java.security.MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }
    }

    private fun post(token: String, path: String, body: JSONObject): JSONObject? {
        return try {
            val conn = (URL(LicenseManager.API + path).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                connectTimeout = 25000
                readTimeout = 25000
                doOutput = true
            }
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val text = try {
                (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.readText() ?: ""
            } catch (e: Exception) { "" }
            if (code !in 200..299) {
                if (code == 409) return JSONObject(text)
                return null
            }
            JSONObject(text)
        } catch (e: Exception) {
            null
        }
    }

    /** Must run off the main thread. */
    fun syncNow(app: KastravaApp): Result {
        val token = app.account.token() ?: return Result(false, "Not logged in.")
        val key = app.account.loadSyncKey() ?: return Result(false, "Log in again to unlock sync.")
        val prefs = app.prefs
        val store = BookmarkStore(app)

        val pulled = post(token, "/api/sync/pull", JSONObject())
            ?: return Result(false, "Sync server unreachable.")
        var localRev = prefs.syncRev()
        var base = try {
            JSONObject(prefs.syncBase())
        } catch (e: Exception) {
            JSONObject()
        }
        val serverRev = pulled.optLong("rev", 0)
        if (serverRev > localRev && !pulled.isNull("blob")) {
            val remote = decrypt(key, pulled.optString("blob")) ?: return Result(false, "Could not decrypt server copy.")
            if (remote.optInt("v", 0) != 1) return Result(false, "Unknown sync format.")
            val cur = snapshotPrefs(app)
            val rPrefs = remote.optJSONObject("prefs") ?: JSONObject()
            val merged = JSONObject()
            val keys = mutableSetOf<String>()
            cur.keys().forEach { keys.add(it) }
            rPrefs.keys().forEach { keys.add(it) }
            for (k in keys) {
                val c = if (cur.has(k)) cur.opt(k) else null
                val b = if (base.has(k)) base.opt(k) else null
                merged.put(k, if (stable(c) == stable(b)) rPrefs.opt(k) else c)
            }
            applyPrefs(app, merged)
            val have = store.load().map { it.url }.toSet()
            val rMarks = remote.optJSONArray("bookmarks") ?: JSONArray()
            for (i in 0 until rMarks.length()) {
                val o = rMarks.optJSONObject(i) ?: continue
                val u = o.optString("u")
                if (u.isNotBlank() && u !in have) store.add(o.optString("t", u), u)
            }
            base = merged
            localRev = serverRev
            prefs.setSyncState(localRev, base.toString(), prefs.syncHash())
        }

        val marks = JSONArray()
        store.load().forEach { marks.put(JSONObject().put("t", it.title).put("u", it.url)) }
        val finalPrefs = snapshotPrefs(app)
        val fingerprint = sha(stable(finalPrefs) + stable(marks))
        if (fingerprint != prefs.syncHash()) {
            val envelope = JSONObject()
                .put("v", 1)
                .put("bookmarks", marks)
                .put("prefs", finalPrefs)
                .put("license", JSONObject().put("key", app.license.status().key ?: JSONObject.NULL))
            var blob = encrypt(key, envelope.toString())
            var push = post(token, "/api/sync/push",
                JSONObject().put("blob", blob).put("base_rev", localRev))
                ?: return Result(false, "Sync upload failed.")
            if (push.optString("error") == "conflict" && !push.isNull("blob")) {
                // Lost the race: merge once against the winner, retry once.
                val remote2 = decrypt(key, push.optString("blob")) ?: return Result(false, "Sync conflict.")
                val have2 = store.load().map { it.url }.toMutableSet()
                val rMarks2 = remote2.optJSONArray("bookmarks") ?: JSONArray()
                for (i in 0 until rMarks2.length()) {
                    val o = rMarks2.optJSONObject(i) ?: continue
                    val u = o.optString("u")
                    if (u.isNotBlank() && u !in have2) {
                        store.add(o.optString("t", u), u)
                        have2.add(u)
                        marks.put(JSONObject().put("t", o.optString("t", u)).put("u", u))
                    }
                }
                blob = encrypt(key, JSONObject()
                    .put("v", 1).put("bookmarks", marks).put("prefs", snapshotPrefs(app))
                    .put("license", JSONObject().put("key", app.license.status().key ?: JSONObject.NULL)).toString())
                push = post(token, "/api/sync/push",
                    JSONObject().put("blob", blob).put("base_rev", push.optLong("rev", localRev)))
                    ?: return Result(false, "Sync upload failed.")
            }
            if (!push.optBoolean("ok", false)) return Result(false, "Sync upload failed.")
            localRev = push.optLong("rev", localRev)
            prefs.setSyncState(localRev, stable(snapshotPrefs(app)), sha(stable(snapshotPrefs(app)) + stable(marks)))
        }
        prefs.setSyncAt(System.currentTimeMillis())
        return Result(true, "Synced.", localRev)
    }

    private fun applyPrefs(app: KastravaApp, merged: JSONObject) {
        val p = app.prefs
        try {
            if (merged.has("engine")) p.engine = merged.optString("engine", p.engine)
            if (merged.has("theme")) {
                val t = merged.optString("theme", p.theme)
                if (t != p.theme) {
                    p.theme = t
                    app.applyTheme()
                }
            }
            if (merged.has("blockers")) p.blockers = merged.optBoolean("blockers", p.blockers)
            if (merged.has("javascript")) p.javaScript = merged.optBoolean("javascript", p.javaScript)
            if (merged.has("textZoom")) p.textZoom = merged.optInt("textZoom", p.textZoom)
            if (merged.has("fontSize")) p.fontSize = merged.optInt("fontSize", p.fontSize)
            if (merged.has("batterySaver")) p.batterySaver = merged.optBoolean("batterySaver", p.batterySaver)
            if (merged.has("cookieMode")) p.cookieMode = merged.optString("cookieMode", p.cookieMode)
            else if (merged.has("cookiesBlocked")) p.cookiesBlocked = merged.optBoolean("cookiesBlocked", p.cookiesBlocked)
            if (merged.has("loadImages")) p.loadImages = merged.optBoolean("loadImages", p.loadImages)
            if (merged.has("desktopDefault")) p.desktopDefault = merged.optBoolean("desktopDefault", p.desktopDefault)
            if (merged.has("showQuick")) p.showQuick = merged.optBoolean("showQuick", p.showQuick)
            if (merged.has("restoreTabs")) p.restoreTabs = merged.optBoolean("restoreTabs", p.restoreTabs)
            if (merged.has("maxTabs")) p.maxTabs = merged.optInt("maxTabs", p.maxTabs)
            if (merged.has("confirmClose")) p.confirmClose = merged.optBoolean("confirmClose", p.confirmClose)
            if (merged.has("showFullUrls")) p.showFullUrls = merged.optBoolean("showFullUrls", p.showFullUrls)
            if (merged.has("customEngine")) p.customEngine = merged.optString("customEngine", p.customEngine)
            if (merged.has("ntpTiles")) p.ntpTiles = merged.optInt("ntpTiles", p.ntpTiles)
            if (merged.has("historyEnabled")) p.historyEnabled = merged.optBoolean("historyEnabled", p.historyEnabled)
            if (merged.has("bookmarksEnabled")) p.bookmarksEnabled = merged.optBoolean("bookmarksEnabled", p.bookmarksEnabled)
            if (merged.has("safeBrowsing")) p.safeBrowsing = merged.optBoolean("safeBrowsing", p.safeBrowsing)
            if (merged.has("blockMixed")) p.blockMixed = merged.optBoolean("blockMixed", p.blockMixed)
            if (merged.has("geoEnabled")) p.geoEnabled = merged.optBoolean("geoEnabled", p.geoEnabled)
            if (merged.has("fileAccess")) p.fileAccess = merged.optBoolean("fileAccess", p.fileAccess)
            if (merged.has("hwAccel")) p.hwAccel = merged.optBoolean("hwAccel", p.hwAccel)
        } catch (e: Exception) { }
    }
}
