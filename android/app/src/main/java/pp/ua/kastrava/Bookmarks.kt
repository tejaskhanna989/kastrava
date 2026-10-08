package pp.ua.kastrava

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Bookmarks survive on purpose: they are the user's own saved places, not
 * website data. Everything else still wipes on exit.
 *
 * Own prefs file (not the default one): "Reset all settings" clears the
 * default file and must never eat bookmarks. One-time migration pulls the
 * old default-prefs copy over.
 */
data class Bookmark(val title: String, val url: String)

class BookmarkStore(context: Context) {
    private val p = context.getSharedPreferences("kastrava_bookmarks", Context.MODE_PRIVATE).also { own ->
        try {
            if (!own.contains("bookmarks")) {
                val legacy = androidx.preference.PreferenceManager
                    .getDefaultSharedPreferences(context)
                    .getString("bookmarks", null)
                if (!legacy.isNullOrBlank()) {
                    own.edit().putString("bookmarks", legacy).apply()
                }
            }
        } catch (e: Exception) { }
    }

    fun load(): MutableList<Bookmark> {
        val out = mutableListOf<Bookmark>()
        try {
            val arr = JSONArray(p.getString("bookmarks", "[]") ?: "[]")
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val url = o.optString("url")
                if (url.startsWith("http")) out.add(Bookmark(o.optString("title", url), url))
            }
        } catch (e: Exception) { }
        return out
    }

    private fun save(list: List<Bookmark>) {
        val arr = JSONArray()
        list.forEach { arr.put(JSONObject().put("title", it.title).put("url", it.url)) }
        p.edit().putString("bookmarks", arr.toString()).apply()
    }

    fun contains(url: String): Boolean = load().any { it.url == url }

    fun add(title: String, url: String) {
        val list = load()
        list.removeAll { it.url == url }
        list.add(0, Bookmark(title.ifBlank { url }, url))
        save(list)
    }

    fun remove(url: String) {
        val list = load()
        list.removeAll { it.url == url }
        save(list)
    }
}
