package pp.ua.kastrava

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * Native Store: browse the catalog (cursor packs hidden — desktop-only),
 * claim free / Premium-unlocked items, buy paid ones in a browser tab
 * (web Razorpay/PayPal checkout), apply owned themes/accents/wallpapers.
 */
class StoreActivity : AppCompatActivity() {

    private lateinit var app: KastravaApp
    private var catalog: List<StoreApi.Item> = emptyList()
    private var owned: Set<String> = emptySet()
    private var ownedData: Map<String, JSONObject?> = emptyMap()
    private var premium = false
    private var query = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as KastravaApp
        setContentView(R.layout.activity_store)
        title = "Store"
        findViewById<EditText>(R.id.storeSearch).addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { query = s?.toString()?.trim() ?: ""; render() }
        })
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun status(t: String) {
        try { findViewById<TextView>(R.id.storeStatus).text = t } catch (e: Exception) { }
    }

    private fun refresh() {
        val token = app.account.token()
        if (token.isNullOrBlank()) {
            status("Log in (Settings → Account) to get items. Browsing is free.")
        } else {
            status("Loading…")
        }
        Thread {
            try {
                catalog = StoreApi.catalog()
                if (!token.isNullOrBlank()) {
                    owned = StoreApi.ownedIds(token)
                    premium = StoreApi.isPremium(token)
                    val items = StoreApi.ownedItems(token)
                    ownedData = items.associate { it.id to it.data }
                }
            } catch (e: Exception) { }
            runOnUiThread { render() }
        }.start()
    }

    private fun render() {
        val box = findViewById<LinearLayout>(R.id.storeList) ?: return
        box.removeAllViews()
        val token = app.account.token()
        val loggedIn = !token.isNullOrBlank()
        if (loggedIn) status("${catalog.size} items · ${owned.size} owned" + if (premium) " · Pro" else "")
        val shown = catalog.filter { item ->
            if (query.isNotBlank() &&
                !(item.name + " " + item.id + " " + item.kind).contains(query, ignoreCase = true)) return@filter false
            true
        }.take(80)
        if (shown.isEmpty()) {
            val tv = TextView(this)
            tv.text = if (catalog.isEmpty()) "Store unreachable — pull to retry by reopening." else "No matches."
            box.addView(tv)
            return
        }
        for (item in shown) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 12)
            }
            val txt = TextView(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                text = item.name + "\n" + item.kind + " · " + priceLabel(item)
            }
            row.addView(txt)
            val btn = Button(this).apply { isAllCaps = false }
            when {
                owned.contains(item.id) -> {
                    btn.text = "Apply"
                    btn.setOnClickListener { applyOwned(item) }
                }
                !loggedIn -> {
                    btn.text = if (item.free) "Get" else priceLabel(item)
                    btn.setOnClickListener {
                        Toast.makeText(this, "Log in first (Settings → Account).", Toast.LENGTH_SHORT).show()
                    }
                }
                item.free || (premium && (item.proFree || item.tier == "premium")) -> {
                    btn.text = "Get"
                    btn.setOnClickListener { claimItem(item) }
                }
                else -> {
                    btn.text = priceLabel(item)
                    btn.setOnClickListener { buyInBrowser() }
                }
            }
            row.addView(btn)
            box.addView(row)
        }
    }

    private fun priceLabel(item: StoreApi.Item): String {
        if (item.free) return "Free"
        return if (item.pricePaise > 0) "₹" + (item.pricePaise / 100) else "$" + item.priceUsd
    }

    private fun claimItem(item: StoreApi.Item) {
        val token = app.account.token() ?: return
        status("Getting ${item.name}…")
        Thread {
            val (data, err) = StoreApi.claim(token, item.id)
            runOnUiThread {
                if (data != null) {
                    owned = owned + item.id
                    ownedData = ownedData + (item.id to data)
                    status("Got ${item.name}. Tap Apply.")
                    render()
                } else {
                    status(err ?: "Not available.")
                    Toast.makeText(this, err ?: "Not available.", Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun applyOwned(item: StoreApi.Item) {
        val data = ownedData[item.id] ?: run {
            Toast.makeText(this, "Reopen the store to refresh.", Toast.LENGTH_SHORT).show()
            return
        }
        when (item.kind) {
            "theme" -> {
                ThemeEngine.applyTheme(app.prefs, item.id, item.name, data)
                Toast.makeText(this, "Applied ${item.name}.", Toast.LENGTH_SHORT).show()
                finish()
            }
            "accents" -> {
                val arr = data.optJSONArray("accents")
                val first = if (arr != null && arr.length() > 0) arr.optString(0) else ""
                if (first.isBlank()) {
                    Toast.makeText(this, "Empty pack.", Toast.LENGTH_SHORT).show()
                    return
                }
                ThemeEngine.applyAccent(app.prefs, first)
                Toast.makeText(this, "Accent $first applied.", Toast.LENGTH_SHORT).show()
                finish()
            }
            "wallpaper" -> {
                val css = data.optString("css")
                if (css.isBlank()) {
                    Toast.makeText(this, "Empty wallpaper.", Toast.LENGTH_SHORT).show()
                    return
                }
                ThemeEngine.applyWallpaper(app.prefs, css)
                Toast.makeText(this, "Wallpaper applied.", Toast.LENGTH_SHORT).show()
                finish()
            }
            "logos" -> {
                Toast.makeText(this, "Logo packs apply on desktop; owned on your account.", Toast.LENGTH_LONG).show()
            }
            "combo" -> {
                Toast.makeText(this, "Combo unpacked into its items — apply them below.", Toast.LENGTH_SHORT).show()
                refresh()
            }
            else -> Toast.makeText(this, "Not applicable on mobile.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun buyInBrowser() {
        try {
            val i = Intent(Intent.ACTION_VIEW, Uri.parse(StoreApi.STORE_URL))
            i.`package` = packageName
            startActivity(i)
        } catch (e: Exception) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(StoreApi.STORE_URL)))
            } catch (e2: Exception) { }
        }
    }
}
