package pp.ua.kastrava

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Kastrava Store client: catalog, claim, owned items. Cursor packs are
 * filtered out everywhere — desktop-only, never shown on mobile.
 * Paid checkout happens in a browser tab (web Razorpay/PayPal flow);
 * this client only claims free/Premium-unlocked items and applies owned
 * ones natively. Must run off the main thread.
 */
object StoreApi {
    const val STORE_URL = "https://store.kastrava.pp.ua/"

    data class Item(
        val id: String,
        val name: String,
        val kind: String,
        val tier: String,
        val pricePaise: Int,
        val priceUsd: Double,
        val free: Boolean,
        val proFree: Boolean,
        val blurb: String,
        val data: JSONObject?
    )

    private fun ua(): String {
        // Same honest token shape as desktop (Kastrava/<ver>); the store
        // install gate requires it.
        return try { "Kastrava/${BuildConfig.VERSION_NAME}" } catch (e: Exception) { "Kastrava/101" }
    }

    private fun post(token: String?, path: String, body: JSONObject): JSONObject? {
        return try {
            val conn = (URL(LicenseManager.API + path).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("User-Agent", ua())
                if (token != null) setRequestProperty("Authorization", "Bearer $token")
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
            if (code !in 200..299) return null
            JSONObject(text)
        } catch (e: Exception) { null }
    }

    /** Full catalog minus cursor packs. */
    fun catalog(currency: String? = null): List<Item> {
        val body = JSONObject()
        if (currency != null) body.put("currency", currency)
        // Catalog is public; call without a token.
        val j = post(null, "/api/store/catalog", body) ?: return emptyList()
        val arr = j.optJSONArray("items") ?: return emptyList()
        val out = ArrayList<Item>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("kind") == "cursor") continue
            val pv = o.optJSONObject("preview")
            out.add(Item(
                o.optString("id"), o.optString("name"), o.optString("kind"),
                o.optString("tier"), o.optInt("price_paise"),
                o.optDouble("price_usd"), o.optBoolean("free"),
                o.optBoolean("pro_free"), o.optString("blurb"),
o.optJSONObject("data")
            ))
        }
        return out
    }

    fun ownedIds(token: String): Set<String> {
        val j = post(token, "/api/account/items", JSONObject()) ?: return emptySet()
        val arr = j.optJSONArray("items") ?: return emptySet()
        val out = HashSet<String>()
        for (i in 0 until arr.length()) {
            arr.optJSONObject(i)?.optString("id")?.let { if (it.isNotBlank()) out.add(it) }
        }
        return out
    }

    fun ownedItems(token: String): List<Item> {
        val j = post(token, "/api/account/items", JSONObject()) ?: return emptyList()
        val arr = j.optJSONArray("items") ?: return emptyList()
        val out = ArrayList<Item>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("kind") == "cursor") continue
            out.add(Item(o.optString("id"), o.optString("name"), o.optString("kind"),
                "", 0, 0.0, true, false, "", o.optJSONObject("data")))
        }
        return out
    }

    /** Claim a free / Premium-unlocked item. Returns item data or null + error. */
    fun claim(token: String, id: String): Pair<JSONObject?, String?> {
        val j = post(token, "/api/store/claim", JSONObject().put("id", id))
            ?: return null to "Store unreachable."
        if (!j.optBoolean("ok")) return null to (j.optString("msg").ifBlank { j.optString("error").ifBlank { "Not available." } })
        return j.optJSONObject("data") to null
    }

    fun isPremium(token: String): Boolean {
        val j = post(token, "/api/account/devices", JSONObject()) ?: return false
        val keys = j.optJSONArray("keys") ?: return false
        val now = System.currentTimeMillis()
        for (i in 0 until keys.length()) {
            val k = keys.optJSONObject(i) ?: continue
            val st = k.optString("status")
            if (st != "activated" && st != "issued") continue
            val exp = k.optString("expires_at")
            if (exp.isBlank()) return true
            try {
                if (java.time.Instant.parse(exp).toEpochMilli() > now) return true
            } catch (e: Exception) { return true }
        }
        return false
    }
}
