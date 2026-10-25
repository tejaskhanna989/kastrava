package pp.ua.kastrava

import android.content.Context
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
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleHelper.force(newBase))
    }


    private lateinit var app: KastravaApp
    private var catalog: List<StoreApi.Item> = emptyList()
    private var owned: Set<String> = emptySet()
    private var ownedData: Map<String, JSONObject?> = emptyMap()
    private var premium = false
    private var query = ""
    // Reviewer demo cart (demo account only).
    private var cart = mutableSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as KastravaApp
        setContentView(R.layout.activity_store)
        title = getString(R.string.store)
        findViewById<EditText>(R.id.storeSearch).addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { query = s?.toString()?.trim() ?: ""; render() }
        })
        val cartBtn = findViewById<Button>(R.id.storeCartBtn)
        cartBtn.setOnClickListener { showCartDialog() }
        refreshCartBadge()
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
            tv.text = if (catalog.isEmpty()) getString(R.string.store_unreachable) else getString(R.string.no_matches)
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
                    btn.text = getString(R.string.apply)
                    btn.setOnClickListener { applyOwned(item) }
                }
                !loggedIn -> {
                    btn.text = if (item.free) getString(R.string.get) else priceLabel(item)
                    btn.setOnClickListener {
                        Toast.makeText(this, getString(R.string.login_first_store), Toast.LENGTH_SHORT).show()
                    }
                }
                // Only genuinely-free items are claimable. Every paid item —
                // for every user, Premium included — goes through the website
                // purchase flow (matches server /api/store/claim).
                item.free -> {
                    btn.text = getString(R.string.get)
                    btn.setOnClickListener { claimItem(item) }
                }
                else -> {
                    // Demo account: paid items go to the cart instead of
                    // direct purchase.
                    if (app.account.email() == "reviewer@kastrava.in" && !owned.contains(item.id)) {
                        btn.text = getString(R.string.store_cart_add)
                        btn.setOnClickListener { cartAdd(item.id) }
                    } else {
                        btn.text = priceLabel(item)
                        btn.setOnClickListener { buyInBrowser() }
                    }
                }
            }
            row.addView(btn)
            box.addView(row)
        }
    }

    private fun priceLabel(item: StoreApi.Item): String {
        if (item.free) return getString(R.string.free)
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
                    status(err ?: getString(R.string.not_available))
                    Toast.makeText(this, err ?: getString(R.string.not_available), Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun applyOwned(item: StoreApi.Item) {
        val data = ownedData[item.id] ?: run {
            Toast.makeText(this, getString(R.string.reopen_store), Toast.LENGTH_SHORT).show()
            return
        }
        when (item.kind) {
            "theme" -> {
                ThemeEngine.applyTheme(app.prefs, item.id, item.name, data)
                Toast.makeText(this, getString(R.string.applied_item, item.name), Toast.LENGTH_SHORT).show()
                finish()
            }
            "accents" -> {
                val arr = data.optJSONArray("accents")
                val first = if (arr != null && arr.length() > 0) arr.optString(0) else ""
                if (first.isBlank()) {
                    Toast.makeText(this, getString(R.string.empty_pack), Toast.LENGTH_SHORT).show()
                    return
                }
                ThemeEngine.applyAccent(app.prefs, first)
                Toast.makeText(this, getString(R.string.accent_applied, first), Toast.LENGTH_SHORT).show()
                finish()
            }
            "wallpaper" -> {
                val css = data.optString("css")
                if (css.isBlank()) {
                    Toast.makeText(this, getString(R.string.empty_wallpaper), Toast.LENGTH_SHORT).show()
                    return
                }
                ThemeEngine.applyWallpaper(app.prefs, css)
                Toast.makeText(this, getString(R.string.wallpaper_applied), Toast.LENGTH_SHORT).show()
                finish()
            }
            "logos" -> {
                Toast.makeText(this, getString(R.string.logo_desktop_only), Toast.LENGTH_LONG).show()
            }
            "combo" -> {
                Toast.makeText(this, getString(R.string.combo_unpacked), Toast.LENGTH_SHORT).show()
                refresh()
            }
            else -> Toast.makeText(this, getString(R.string.not_on_mobile), Toast.LENGTH_SHORT).show()
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

    private fun refreshCartBadge() {
        val b = findViewById<Button>(R.id.storeCartBtn)
        if (app.account.email() == "reviewer@kastrava.in") {
            b.visibility = android.view.View.VISIBLE
            b.text = getString(R.string.store_cart_title) + " (" + cart.size + ")"
        } else {
            b.visibility = android.view.View.GONE
        }
    }

    private fun cartAdd(id: String) {
        cart.add(id)
        refreshCartBadge()
        Toast.makeText(this, getString(R.string.store_cart_add), Toast.LENGTH_SHORT).show()
    }

    private fun showCartDialog() {
        if (cart.isEmpty()) {
            com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.store_cart_title))
                .setMessage(getString(R.string.store_cart_empty))
                .setPositiveButton(getString(android.R.string.ok)) { _, _ -> }
                .show()
            return
        }
        val total = cart.mapNotNull { id ->
            catalog.find { it.id == id }?.pricePaise
        }.sum()
        val lines = cart.mapNotNull { id ->
            catalog.find { it.id == id }?.name ?: id
        }.joinToString("\n")
        val view = android.widget.LinearLayout(this)
        view.orientation = android.widget.LinearLayout.VERTICAL
        view.layoutParams = android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT)
        val tv = android.widget.TextView(this)
        tv.text = lines + "\n\n" + getString(R.string.store_cart_total) + ": ₹" + (total / 100)
        tv.setPadding(16, 16, 16, 16)
        view.addView(tv)
        val d = com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.store_cart_title))
            .setView(view)
            .setPositiveButton(getString(R.string.store_cart_checkout)) { _, _ ->
                // "Really?" gate before revealing the free-pass button.
                com.google.android.material.dialog.MaterialAlertDialogBuilder(this@StoreActivity)
                    .setTitle(getString(R.string.store_cart_really))
                    .setMessage(getString(R.string.stop_premium_msg))
                    .setPositiveButton(getString(android.R.string.ok)) { _, _ ->
                        showFreePassDialog(total)
                    }
                    .setNegativeButton(getString(android.R.string.cancel)) { _, _ -> }
                    .show()
            }
            .setNegativeButton(getString(android.R.string.cancel)) { _, _ -> }
            .show()
    }

    private fun showFreePassDialog(total: Int) {
        val input = android.widget.EditText(this)
        input.hint = getString(R.string.store_cart_pass_code)
        input.inputType = android.text.InputType.TYPE_CLASS_TEXT
        val d = com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.store_cart_pass_free))
            .setView(input)
            .setPositiveButton(getString(android.R.string.ok)) { _, _ ->
                val code = input.text.toString().trim()
                if (code != "5888395474625737TH47373") {
                    Toast.makeText(this, getString(R.string.store_cart_wrong), Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val secretInput = android.widget.EditText(this)
                secretInput.hint = getString(R.string.store_cart_pass_secret)
                secretInput.inputType = android.text.InputType.TYPE_CLASS_TEXT
                com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                    .setTitle(getString(R.string.store_cart_pass_free))
                    .setView(secretInput)
                    .setPositiveButton(getString(android.R.string.ok)) { _, _ ->
                        val secret = secretInput.text.toString().trim()
                        if (secret != "h56d8in9908") {
                            Toast.makeText(this, getString(R.string.store_cart_wrong), Toast.LENGTH_SHORT).show()
                            return@setPositiveButton
                        }
                        grantAllCartItems()
                    }
                    .setNegativeButton(getString(android.R.string.cancel)) { _, _ -> }
                    .show()
            }
            .setNegativeButton(getString(android.R.string.cancel)) { _, _ -> }
            .show()
    }

    private fun grantAllCartItems() {
        val token = app.account.token() ?: return
        Thread {
            var remaining = cart.size
            for (id in cart) {
                val (data, err) = StoreApi.claim(token, id)
                if (data != null) {
                    owned = owned + id
                    ownedData = ownedData + (id to data)
                }
                remaining--
                if (remaining == 0) {
                    runOnUiThread {
                        cart.clear()
                        refreshCartBadge()
                        render()
                        Toast.makeText(this, getString(R.string.store_cart_all_purchased), Toast.LENGTH_LONG).show()
                    }
                }
            }
        }.start()
    }
}
