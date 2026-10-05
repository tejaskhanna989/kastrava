package pp.ua.kastrava

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * F13 vault (free): password-locked notes, AES-256-GCM with a PBKDF2 key.
 * Everything sensitive lives in one encrypted blob; the password and the
 * key never touch disk. Wrong password fails closed (GCM auth tag).
 */
class VaultStore(context: Context) {

    data class Note(val id: Long, val title: String, val body: String, val updated: Long)

    private val prefs = context.getSharedPreferences("kastrava_vault", Context.MODE_PRIVATE)
    private var key: SecretKeySpec? = null
    private val notes = mutableListOf<Note>()

    val unlocked: Boolean get() = key != null

    fun hasVault(): Boolean = prefs.contains("salt") && prefs.contains("blob")

    private fun derive(password: String, salt: ByteArray): SecretKeySpec {
        val f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(password.toCharArray(), salt, 120000, 256)
        return SecretKeySpec(f.generateSecret(spec).encoded, "AES")
    }

    fun setup(password: String): Boolean {
        if (password.length < 4) return false
        return try {
            val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
            key = derive(password, salt)
            notes.clear()
            persist(salt)
        } catch (e: Exception) {
            key = null
            false
        }
    }

    fun unlock(password: String): Boolean {
        return try {
            val saltB64 = prefs.getString("salt", null) ?: return false
            key = derive(password, Base64.decode(saltB64, Base64.DEFAULT))
            load()
            true
        } catch (e: Exception) {
            key = null
            notes.clear()
            false
        }
    }

    fun lock() {
        key = null
        notes.clear()
    }

    fun list(): List<Note> = notes.sortedByDescending { it.updated }

    fun save(title: String, body: String, id: Long = 0L): Boolean {
        if (key == null) return false
        val nid = if (id == 0L) System.currentTimeMillis() else id
        notes.removeAll { it.id == nid }
        notes.add(Note(nid, title, body, System.currentTimeMillis()))
        return persist()
    }

    fun delete(id: Long): Boolean {
        if (key == null) return false
        notes.removeAll { it.id == id }
        return persist()
    }

    private fun persist(saltOverride: ByteArray? = null): Boolean {
        return try {
            val k = key ?: return false
            val salt = saltOverride
                ?: Base64.decode(prefs.getString("salt", null) ?: return false, Base64.DEFAULT)
            val arr = JSONArray()
            notes.forEach {
                arr.put(JSONObject().put("id", it.id).put("t", it.title).put("b", it.body).put("u", it.updated))
            }
            val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, k, GCMParameterSpec(128, iv))
            val ct = c.doFinal(arr.toString().toByteArray(Charsets.UTF_8))
            val blob = ByteArray(iv.size + ct.size)
            System.arraycopy(iv, 0, blob, 0, iv.size)
            System.arraycopy(ct, 0, blob, iv.size, ct.size)
            prefs.edit()
                .putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString("blob", Base64.encodeToString(blob, Base64.NO_WRAP))
                .apply()
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun load() {
        val k = key ?: throw IllegalStateException("locked")
        val blobB64 = prefs.getString("blob", null) ?: throw IllegalStateException("empty")
        val blob = Base64.decode(blobB64, Base64.DEFAULT)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, blob, 0, 12))
        val pt = c.doFinal(blob, 12, blob.size - 12)
        val arr = JSONArray(String(pt, Charsets.UTF_8))
        notes.clear()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            notes.add(Note(o.optLong("id"), o.optString("t"), o.optString("b"), o.optLong("u")))
        }
    }
}
