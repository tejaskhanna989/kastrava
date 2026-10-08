package pp.ua.kastrava

import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.SeekBar
import com.google.android.material.snackbar.Snackbar
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.app.Activity
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import android.graphics.Bitmap
import android.util.TypedValue
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * Kastrava for Android: tabbed WebView browser.
 * - Omnibox (URL or search via the configured engine)
 * - Tracker/ad blocking at the network layer (FilterLists)
 * - Session downloads (volatile area + explicit Save)
 * - Website data wiped on exit (cookies, DOM storage, cache)
 */
class MainActivity : AppCompatActivity() {

    private lateinit var app: KastravaApp
    private lateinit var container: FrameLayout
    private lateinit var homeView: ScrollView
    private lateinit var omnibox: EditText
    private lateinit var homeSearch: EditText
    private lateinit var homePremium: TextView
    private lateinit var progress: ProgressBar
    private lateinit var btnTabs: ImageButton
    private lateinit var tabCount: TextView
    private lateinit var findBar: LinearLayout
    private lateinit var etFind: EditText

    private data class WebTab(
        val view: WebView,
        var favicon: Bitmap? = null,
        var desktopMode: Boolean = false,
        var defaultUa: String? = null,
        var blockedCount: Int = 0,
    )

    private val tabs = mutableListOf<WebTab>()
    private var current = -1

    // <input type=file> support: at most one pending chooser.
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val filePicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { res ->
        val cb = filePathCallback
        filePathCallback = null
        try {
            if (res.resultCode == Activity.RESULT_OK) {
                val data = res.data
                val uris = mutableListOf<Uri>()
                data?.clipData?.let { clip ->
                    for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
                }
                data?.data?.let { uris.add(it) }
                cb?.onReceiveValue(uris.toTypedArray())
            } else {
                cb?.onReceiveValue(null)
            }
        } catch (e: Exception) {
            try { cb?.onReceiveValue(null) } catch (ignored: Exception) { }
        }
    }

    // Fullscreen video (<video> fullscreen button).
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    companion object {
        private const val DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as KastravaApp
        setContentView(R.layout.activity_main)

        container = findViewById(R.id.webContainer)
        homeView = findViewById(R.id.homeView)
        omnibox = findViewById(R.id.omnibox)
        homeSearch = findViewById(R.id.homeSearch)
        homePremium = findViewById(R.id.homePremium)
        progress = findViewById(R.id.progress)
        btnTabs = findViewById(R.id.btnTabs)
        tabCount = findViewById(R.id.tabCount)
        findBar = findViewById(R.id.findBar)
        etFind = findViewById(R.id.etFind)
        findViewById<ImageButton>(R.id.btnFindClose).setOnClickListener { closeFindBar() }
        findViewById<ImageButton>(R.id.btnFindNext).setOnClickListener { currentTab()?.findNext(true) }
        findViewById<ImageButton>(R.id.btnFindPrev).setOnClickListener { currentTab()?.findNext(false) }
        etFind.setOnEditorActionListener { v, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                hideKeyboard(v)
                currentTab()?.findAllAsync((v as EditText).text.toString())
                true
            } else false
        }
        findViewById<LinearLayout>(R.id.tileNewTab).setOnClickListener { newTab() }
        findViewById<LinearLayout>(R.id.tileDownloads).setOnClickListener { openDownloads() }
        findViewById<LinearLayout>(R.id.tilePremium).setOnClickListener { openPremium() }
        findViewById<LinearLayout>(R.id.tileSettings).setOnClickListener { openSettings() }
        updateTabCount()

        applyCookiePolicy()

        findViewById<ImageButton>(R.id.btnBack).setOnClickListener { currentTab()?.goBack() }
        findViewById<ImageButton>(R.id.btnForward).setOnClickListener { currentTab()?.goForward() }
        findViewById<ImageButton>(R.id.btnReload).setOnClickListener { currentTab()?.reload() }
        btnTabs.setOnClickListener { showTabs() }
        findViewById<ImageButton>(R.id.btnMenu).setOnClickListener { showMenu(it) }
        val bottomBar: LinearLayout = findViewById(R.id.bottomBar)
        val swipes = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
                if (e1 == null) return false
                val dx = e2.x - e1.x
                if (kotlin.math.abs(dx) > 120 && kotlin.math.abs(vx) > 200 &&
                    kotlin.math.abs(dx) > 2 * kotlin.math.abs(e2.y - e1.y)
                ) {
                    cycleTab(if (dx < 0) 1 else -1)
                    return true
                }
                return false
            }
        })
        bottomBar.setOnTouchListener { _, ev -> swipes.onTouchEvent(ev) }
        btnTabs.setOnLongClickListener { newTab(); true }
        findViewById<ImageButton>(R.id.btnBack).setOnLongClickListener { showHistory(backward = true); true }
        findViewById<ImageButton>(R.id.btnForward).setOnLongClickListener { showHistory(backward = false); true }

        val go = { query: String -> openQuery(query); true }
        omnibox.setOnFocusChangeListener { v, focused ->
            val wv = currentTab()
            if (focused) {
                (v as EditText).setText(wv?.url ?: "")
                (v as EditText).selectAll()
            } else {
                syncOmnibox()
            }
        }
        omnibox.setOnEditorActionListener { v, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                hideKeyboard(v)
                go((v as EditText).text.toString())
            } else false
        }
        homeSearch.setOnEditorActionListener { v, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                hideKeyboard(v)
                go((v as EditText).text.toString())
            } else false
        }

        // Restore last tabs first (URLs only, pages reload fresh), then layer
        // any incoming link on top as the active tab. Honors the Restore
        // tabs + session-recording switches.
        val restored = restoreSession()
        handleIntent(intent)
        if (current < 0 && !restored) showHome()
        refreshPremiumLine()
        Thread {
            val u = Updater.check(this)
            if (u != null) runOnUiThread {
                Toast.makeText(this, "Kastrava ${u.name} available — update in Settings", Toast.LENGTH_LONG).show()
            }
        }.start()
        // Silent license refresh once per process: an admin extend or renewal
        // only lands in-app after a re-activate. Failures keep the cache.
        // Silent license refresh once per process: logged-in accounts
        // re-activate by account (same key, device counted), otherwise the
        // legacy key refresh. Failures keep the cache.
        Thread {
            try {
                val tok = app.account.token()
                if (tok != null) {
                    if (app.license.activateAccount(tok) == null) {
                        runOnUiThread { refreshPremiumLine() }
                    }
                } else {
                    val st = app.license.status()
                    if (st.activated && st.key != null) {
                        if (app.license.activate(st.key) == null) {
                            runOnUiThread { refreshPremiumLine() }
                        }
                    }
                }
            } catch (e: Exception) { }
        }.start()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent) {
        val url = when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.let {
                Regex("https?://\\S+").find(it)?.value
            }
            else -> null
        }
        if (!url.isNullOrBlank()) newTab(url)
    }

    private fun pauseTab(t: WebTab?) {
        if (!app.prefs.batterySaver) return
        try {
            val v = t?.view ?: return
            // Never freeze a page mid-load — a paused load stalls and the
            // tab looks broken. It sleeps on the next switch instead.
            if (v.progress in 1..99) return
            v.onPause()
        } catch (e: Exception) { }
    }

    private fun resumeTab(t: WebTab?) {
        try { t?.view?.onResume() } catch (e: Exception) { }
    }

    override fun onPause() {
        // Tabs persist (URLs only) so they survive process death, then freeze.
        saveSession()
        // App backgrounded: freeze every tab + all JS timers. Lowest drain.
        try { tabs.forEach { it.view.onPause() } } catch (e: Exception) { }
        try { tabs.firstOrNull()?.view?.pauseTimers() } catch (e: Exception) { }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        try { tabs.firstOrNull()?.view?.resumeTimers() } catch (e: Exception) { }
        resumeTab(currentWebTab())
        refreshPremiumLine()
        renderQuickBookmarks()
        // Settings may have changed while away: push every live switch
        // into all tabs and re-apply the global cookie policy.
        applyCookiePolicy()
        tabs.forEach { applyTabSettings(it.view) }
    }

    /** Global cookie jar follows the cookie-mode switch. */
    private fun applyCookiePolicy() {
        try {
            val cm = CookieManager.getInstance()
            val mode = app.prefs.cookieMode
            cm.setAcceptCookie(mode != "block")
            tabs.forEach { tab ->
                try { cm.setAcceptThirdPartyCookies(tab.view, mode == "allow") } catch (e: Exception) { }
            }
            if (mode == "block") {
                try { cm.removeAllCookies(null) } catch (e: Exception) { }
                try { cm.flush() } catch (e: Exception) { }
            }
        } catch (e: Exception) { }
    }

    /** Push every content switch into one WebView. */
    private fun applyTabSettings(wv: WebView) {
        try {
            val s = wv.settings
            s.javaScriptEnabled = app.prefs.javaScript
            s.textZoom = app.prefs.textZoom
            try { s.defaultFontSize = app.prefs.fontSize } catch (e: Exception) { }
            try { s.loadsImagesAutomatically = app.prefs.loadImages } catch (e: Exception) { }
            try { s.blockNetworkImage = !app.prefs.loadImages } catch (e: Exception) { }
            try {
                s.mixedContentMode =
                    if (app.prefs.blockMixed) android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    else android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            } catch (e: Exception) { }
            try { s.safeBrowsingEnabled = app.prefs.safeBrowsing } catch (e: Exception) { }
            try { s.setGeolocationEnabled(app.prefs.geoEnabled) } catch (e: Exception) { }
            try { s.allowFileAccess = app.prefs.fileAccess } catch (e: Exception) { }
            try {
                wv.setLayerType(
                    if (app.prefs.hwAccel) View.LAYER_TYPE_HARDWARE
                    else View.LAYER_TYPE_SOFTWARE, null,
                )
            } catch (e: Exception) { }
        } catch (e: Exception) { }
    }

    // ----- tabs -----

    private fun currentTab(): WebView? = tabs.getOrNull(current)?.view
    private fun currentWebTab(): WebTab? = tabs.getOrNull(current)

    /** Network + chrome clients shared by fresh and crash-rebuilt tabs. */
    private fun attachTabClients(wv: WebView, tab: WebTab) {
        wv.webViewClient = KastraWebClient(
            app.filters,
            { app.prefs.blockers },
            onBlocked = {
                tab.blockedCount++
            },
            onPageStart = {
                tab.blockedCount = 0
            },
            onCrashed = { crashed ->
                rebuildTab(crashed)
            },
        )
        wv.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, p: Int) {
                if (view == currentTab()) {
                    progress.visibility =
                        if (p in 1..99) ProgressBar.VISIBLE else ProgressBar.GONE
                    progress.progress = p
                }
                if (view == currentTab() && p == 100) syncOmnibox()
            }

            override fun onReceivedTitle(view: WebView, title: String?) {
                if (view == currentTab()) syncOmnibox()
            }

            override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
                tabs.find { it.view == view }?.favicon = icon
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback,
            ) {
                // Desktop location toggle equivalent: default deny.
                callback.invoke(origin, app.prefs.geoEnabled, false)
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                return try {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback
                    val intent = params.createIntent().apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                    }
                    filePicker.launch(intent)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    false
                }
            }

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                try {
                    container.addView(
                        view,
                        FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT,
                        ),
                    )
                } catch (e: Exception) {
                    onHideCustomView()
                }
            }

            override fun onHideCustomView() {
                try { container.removeView(customView) } catch (e: Exception) { }
                customView = null
                try { customViewCallback?.onCustomViewHidden() } catch (e: Exception) { }
                customViewCallback = null
            }
        }
    }

    private fun newTab(url: String? = null, desktopMode: Boolean = false) {
        // Desktop maxTabs equivalent: refuse with a message instead of
        // silently piling up renderers on a low-end phone.
        val cap = app.prefs.maxTabs
        if (cap > 0 && tabs.size >= cap) {
            Toast.makeText(this, "Tab limit reached ($cap) — close one first", Toast.LENGTH_SHORT).show()
            showTabs()
            return
        }
        val wv = buildWebView(this, app.prefs)
        try {
            CookieManager.getInstance().setAcceptThirdPartyCookies(wv, app.prefs.cookieMode == "allow")
        } catch (e: Exception) { }
        val tab = WebTab(wv)
        tab.defaultUa = wv.settings.userAgentString
        attachTabClients(wv, tab)
        wv.setOnLongClickListener {
            val result = wv.hitTestResult
            when (result?.type) {
                WebView.HitTestResult.SRC_ANCHOR_TYPE -> {
                    showLinkMenu(result.extra, isImage = false)
                    true
                }
                WebView.HitTestResult.IMAGE_TYPE,
                WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                    showLinkMenu(result.extra, isImage = true)
                    true
                }
                else -> false
            }
        }
        wv.setDownloadListener { dlUrl, _, contentDisposition, _, _ ->
            startSessionDownload(dlUrl, contentDisposition)
        }
        if (desktopMode || app.prefs.desktopDefault) applyDesktopMode(tab, true)
        tabs.add(tab)
        container.addView(
            wv,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        updateTabCount()
        switchTo(tabs.size - 1)
        if (url != null) wv.loadUrl(url) else showHome()
        saveSession()
    }

    private fun cycleTab(dir: Int) {
        if (tabs.size < 2) return
        val next = ((current + dir) % tabs.size + tabs.size) % tabs.size
        switchTo(next)
    }

    private var lastClosedUrl: String? = null

    private fun closeAllTabs() {
        if (tabs.isEmpty()) return
        if (app.prefs.confirmClose && tabs.size > 1) {
            MaterialAlertDialogBuilder(this)
                .setTitle("Close ${tabs.size} tabs?")
                .setPositiveButton("Close all") { _, _ ->
                    tabs.toList().indices.reversed().forEach { closeTab(it, quiet = true) }
                    showUndoSnackbar()
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        tabs.toList().indices.reversed().forEach { closeTab(it, quiet = true) }
        showUndoSnackbar()
    }

    /** Rebuild a tab whose renderer crashed, keeping its URL. */
    private fun rebuildTab(crashed: WebView) {
        val idx = tabs.indexOfFirst { it.view === crashed }
        if (idx < 0) return
        val url = try { crashed.url } catch (e: Exception) { null }
        runOnUiThread {
            try {
                val old = tabs[idx]
                container.removeView(old.view)
                try { old.view.destroy() } catch (e: Exception) { }
                val wv = buildWebView(this, app.prefs)
                try {
                    CookieManager.getInstance().setAcceptThirdPartyCookies(wv, app.prefs.cookieMode == "allow")
                } catch (e: Exception) { }
                val tab = WebTab(wv)
                tab.defaultUa = wv.settings.userAgentString
                if (old.desktopMode) applyDesktopMode(tab, true)
                attachTabClients(wv, tab)
                tabs[idx] = tab
                container.addView(
                    wv,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT,
                    ),
                )
                if (idx == current) switchTo(idx)
                else {
                    // Background tab: keep it hidden or it would overlay
                    // whatever is on screen.
                    try { tabs[idx].view.visibility = WebView.GONE } catch (e: Exception) { }
                }
                if (!url.isNullOrBlank()) wv.loadUrl(url)
                Toast.makeText(this, "Tab recovered after a crash", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) { }
        }
    }

    private fun showUndoSnackbar() {
        val url = lastClosedUrl ?: return
        lastClosedUrl = null
        try {
            Snackbar.make(container, "Tab closed", Snackbar.LENGTH_LONG)
                .setAction("Undo") { newTab(url) }
                .show()
        } catch (e: Exception) { }
    }

    private fun showHistory(backward: Boolean) {
        val wv = currentTab() ?: return
        val hist = try { wv.copyBackForwardList() } catch (e: Exception) { return }
        val idx = hist.currentIndex
        val range = if (backward) (idx - 1) downTo 0 else (idx + 1) until hist.size
        val items = range.mapNotNull { i ->
            try {
                hist.getItemAtIndex(i)?.let { it.title?.takeIf { t -> t.isNotBlank() } ?: it.url }?.let { t -> t to (hist.getItemAtIndex(i)?.url ?: "") }
            } catch (e: Exception) { null }
        }
        if (items.isEmpty()) {
            Toast.makeText(this, "No history", Toast.LENGTH_SHORT).show()
            return
        }
        MaterialAlertDialogBuilder(this)
            .setTitle(if (backward) "Back" else "Forward")
            .setItems(items.map { it.first }.toTypedArray()) { _, which ->
                val url = items[which].second
                if (url.isNotBlank()) currentTab()?.loadUrl(url)
            }
            .show()
    }

    private fun updateTabCount() {
        tabCount.text = tabs.size.toString()
    }

    private fun switchTo(i: Int) {
        if (i !in tabs.indices) return
        val old = tabs.getOrNull(current)
        if (old != null && old !== tabs[i]) {
            old.view.visibility = WebView.GONE
            pauseTab(old)
        }
        current = i
        val wv = tabs[i].view
        resumeTab(tabs[i])
        wv.visibility = WebView.VISIBLE
        homeView.visibility = ScrollView.GONE
        syncOmnibox()
    }

    private fun closeTab(i: Int, quiet: Boolean = false) {
        if (i !in tabs.indices) return
        lastClosedUrl = tabs[i].view.url
        val wv = tabs.removeAt(i).view
        container.removeView(wv)
        wv.destroy()
        if (tabs.isEmpty()) {
            current = -1
            updateTabCount()
            showHome()
        } else {
            current = -1
            switchTo(i.coerceAtMost(tabs.size - 1))
        }
        if (!quiet) showUndoSnackbar()
        saveSession()
    }

    private fun showHome() {
        pauseTab(currentWebTab())
        currentTab()?.visibility = WebView.GONE
        current = -1
        homeView.visibility = ScrollView.VISIBLE
        renderQuickBookmarks()
        updateTabCount()
        omnibox.setText("")
        // Fresh tab = empty search box. Otherwise the last query sits here
        // and one accidental Go re-opens the old results in the new tab.
        homeSearch.setText("")
        progress.visibility = ProgressBar.GONE
    }

    private var tabsSheet: BottomSheetDialog? = null
    private var tabsSheetList: LinearLayout? = null

    private fun showTabs() {
        val open = tabsSheet
        if (open != null && open.isShowing && tabsSheetList != null) {
            renderTabsSheet(tabsSheetList!!, open)
            return
        }
        val sheet = BottomSheetDialog(this)
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, pad)
        }
        tabsSheet = sheet
        tabsSheetList = list
        renderTabsSheet(list, sheet)
        sheet.setOnDismissListener {
            if (tabsSheet === sheet) {
                tabsSheet = null
                tabsSheetList = null
            }
        }
        sheet.setContentView(ScrollView(this).apply { addView(list) })
        sheet.show()
    }

    // Re-renders the open sheet in place: closing a tab must not dismiss
    // and re-show the whole panel (that replayed the enter animation).
    private fun refreshTabsSheet() {
        val sheet = tabsSheet
        val list = tabsSheetList
        if (sheet == null || list == null || !sheet.isShowing) return
        if (tabs.isEmpty()) sheet.dismiss() else renderTabsSheet(list, sheet)
    }

    private fun renderTabsSheet(list: LinearLayout, sheet: BottomSheetDialog) {
        list.removeAllViews()
        val density = resources.displayMetrics.density
        tabs.forEachIndexed { i, tab ->
            val wv = tab.view
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                isClickable = true
                isFocusable = true
                setBackgroundResource(selectableBackground())
                setPadding(0, (8 * density).toInt(), 0, (8 * density).toInt())
                setOnClickListener { sheet.dismiss(); switchTo(i) }
            }
            val icon = android.widget.ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams((40 * density).toInt(), (40 * density).toInt())
                val fav = tab.favicon
                if (fav != null) setImageBitmap(fav)
                else setImageResource(R.drawable.ic_globe)
            }
            row.addView(icon)
            val texts = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginStart = (12 * density).toInt()
                    marginEnd = (8 * density).toInt()
                }
            }
            val title = wv.title?.takeIf { it.isNotBlank() } ?: wv.url ?: "New tab"
            texts.addView(TextView(this).apply {
                text = title
                textSize = 15f
                maxLines = 1
                setTextColor(getColor(R.color.chrome_text))
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            texts.addView(TextView(this).apply {
                text = wv.url ?: ""
                textSize = 12f
                maxLines = 1
                setTextColor(getColor(R.color.chrome_hint))
            })
            row.addView(texts)
            val close = ImageButton(this).apply {
                setImageResource(R.drawable.ic_close)
                background = null
                contentDescription = "Close tab"
                setOnClickListener { closeTab(i); refreshTabsSheet() }
            }
            row.addView(close)
            if (i == current) row.setBackgroundColor(getColor(R.color.chrome_pill))
            list.addView(row)
        }
        if (tabs.size > 1) {
            val closeAllRow = TextView(this).apply {
                text = "Close all tabs"
                textSize = 16f
                val vpad = (14 * density).toInt()
                setPadding(0, vpad, 0, vpad)
                setTextColor(0xFFD32F2F.toInt())
                isClickable = true
                isFocusable = true
                setBackgroundResource(selectableBackground())
                setOnClickListener { sheet.dismiss(); closeAllTabs() }
            }
            list.addView(closeAllRow)
        }
        val newTabRow = TextView(this).apply {
            text = "+ New tab"
            textSize = 16f
            val vpad = (14 * density).toInt()
            setPadding(0, vpad, 0, vpad)
            setTextColor(getColor(R.color.kas_blue))
            setOnClickListener { sheet.dismiss(); newTab() }
        }
        list.addView(newTabRow)
    }

    // ----- navigation -----

    private fun engineUrl(): (String) -> String {
        val premium = app.license.status().activated
        val engine = app.prefs.engine
        val custom = app.prefs.customEngine
        return { q -> Prefs.searchUrl(engine, premium, q.ifBlank { "kastrava browser" }, custom) }
    }

    private fun openQuery(input: String) {
        if (input.isBlank()) return
        val url = resolveInput(input, engineUrl())
        if (current < 0) newTab(url) else currentTab()?.loadUrl(url)
    }

    private fun syncOmnibox() {
        val wv = currentTab()
        val url = wv?.url ?: ""
        omnibox.setText(if (omnibox.hasFocus()) url else displayHost(url))
    }

    private fun displayHost(url: String): String {
        if (url.isBlank()) return ""
        if (app.prefs.showFullUrls) return url
        return try {
            val uri = android.net.Uri.parse(url)
            val host = uri.host ?: return url
            if (uri.scheme == "https" || uri.scheme == "http") host else url
        } catch (e: Exception) {
            url
        }
    }

    private fun openDownloads() {
        startActivity(Intent(this, DownloadsActivity::class.java))
    }

    private fun openPremium() {
        startActivity(Intent(this, PremiumActivity::class.java))
    }

    private fun openVault() {
        startActivity(Intent(this, VaultActivity::class.java))
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    private fun menuIconCell(iconRes: Int, label: String, onClick: () -> Unit): LinearLayout {
        val density = resources.displayMetrics.density
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER_HORIZONTAL
            isClickable = true
            isFocusable = true
            setBackgroundResource(selectableBackground())
            setPadding(0, (10 * density).toInt(), 0, (10 * density).toInt())
            addView(ImageView(this@MainActivity).apply {
                layoutParams = LinearLayout.LayoutParams((28 * density).toInt(), (28 * density).toInt())
                setImageResource(iconRes)
            })
            addView(TextView(this@MainActivity).apply {
                text = label
                textSize = 11f
                maxLines = 1
                setTextColor(getColor(R.color.chrome_text))
                setPadding(0, (6 * density).toInt(), 0, 0)
            })
            setOnClickListener { onClick() }
        }
    }

    private fun showMenu(anchor: android.view.View) {
        val density = resources.displayMetrics.density
        val sheet = BottomSheetDialog(this)
        sheet.window?.setBackgroundDrawable(
            android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT))
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.sheet_bg)
            val m = (16 * density).toInt()
            val params = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
            ).apply { setMargins(m, 0, m, m) }
            layoutParams = params
            val pad = (20 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        // page header: favicon tile + title + url + share
        val wv = currentTab()
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val favTile = android.widget.FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams((48 * density).toInt(), (48 * density).toInt())
            background = getDrawable(R.drawable.dot_bg)
            addView(TextView(this@MainActivity).apply {
                layoutParams = android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                )
                gravity = android.view.Gravity.CENTER
                textSize = 20f
                setTextColor(getColor(R.color.chrome_text))
                text = (wv?.title?.trim()?.firstOrNull()?.uppercase() ?: "K")
            })
        }
        val wvFav = wv?.let { t -> tabs.find { it.view == t }?.favicon }
        if (wvFav != null) {
            favTile.removeAllViews()
            favTile.addView(android.widget.ImageView(this).apply {
                layoutParams = android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                )
                setImageBitmap(wvFav)
            })
        }
        header.addView(favTile)
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (12 * density).toInt()
                marginEnd = (8 * density).toInt()
            }
        }
        titleBox.addView(TextView(this).apply {
            text = wv?.title?.takeIf { it.isNotBlank() } ?: "Kastrava"
            textSize = 16f
            maxLines = 1
            setTextColor(getColor(R.color.chrome_text))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        titleBox.addView(TextView(this).apply {
            text = wv?.url ?: "kastrava.pp.ua"
            textSize = 12f
            maxLines = 1
            setTextColor(getColor(R.color.chrome_hint))
        })
        val blocked = currentWebTab()?.blockedCount ?: 0
        if (blocked > 0) {
            titleBox.addView(TextView(this).apply {
                text = "Blocked $blocked tracker${if (blocked == 1) "" else "s"} on this page"
                textSize = 12f
                maxLines = 1
                setTextColor(getColor(R.color.chrome_hint))
            })
        }
        header.addView(titleBox)
        header.addView(ImageButton(this).apply {
            layoutParams = LinearLayout.LayoutParams((44 * density).toInt(), (44 * density).toInt())
            setImageResource(R.drawable.ic_share)
            background = null
            contentDescription = "Share page"
            setOnClickListener { sheet.dismiss(); sharePage() }
        })
        body.addView(header)
        body.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, (1 * density).toInt(),
            ).apply {
                topMargin = (14 * density).toInt()
                bottomMargin = (6 * density).toInt()
            }
            setBackgroundColor(getColor(R.color.chrome_divider))
        })
        // top row: New tab | Bookmarks | Downloads | Share | Settings
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        val pageUrl = currentTab()?.url
        val saved = pageUrl != null && BookmarkStore(this@MainActivity).contains(pageUrl)
        val row1Items = if (app.prefs.bookmarksEnabled) listOf(
            Triple(R.drawable.ic_plus, "New tab", { newTab() }),
            Triple(R.drawable.ic_star, if (saved) "Saved" else "Bookmark", { toggleBookmark() }),
            Triple(R.drawable.ic_download, "Downloads", { openDownloads() }),
            Triple(R.drawable.ic_share, "Share", { sharePage() }),
            Triple(R.drawable.ic_settings, "Settings", { openSettings() }),
        ) else listOf(
            Triple(R.drawable.ic_plus, "New tab", { newTab() }),
            Triple(R.drawable.ic_download, "Downloads", { openDownloads() }),
            Triple(R.drawable.ic_share, "Share", { sharePage() }),
            Triple(R.drawable.ic_settings, "Settings", { openSettings() }),
        )
        row1.weightSum = row1Items.size.toFloat()
        row1Items.forEach { (icon, label, action) ->
            row1.addView(menuIconCell(icon, label) { sheet.dismiss(); action() }.apply {
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
        }
        body.addView(row1)
        // grid: find, desktop, text size, wipe, premium, default, about
        val desktopOn = currentWebTab()?.desktopMode == true
        val gridItems = listOf(
            Triple(R.drawable.ic_search, "Find on page", { openFindBar() }),
            Triple(R.drawable.ic_monitor, if (desktopOn) "Desktop ✓" else "Desktop site", { toggleDesktopMode() }),
            Triple(R.drawable.ic_textsize, "Text size", { openTextSize() }),
            Triple(R.drawable.ic_shot, "Screenshot", { takeScreenshot() }),
            Triple(R.drawable.ic_trash, "Delete data", { wipeNow() }),
            Triple(R.drawable.ic_vault, "Vault", { openVault() }),
            Triple(R.drawable.ic_premium, "Premium", { openPremium() }),
            Triple(R.drawable.ic_globe, "Default app", { requestDefaultBrowser() }),
            Triple(R.drawable.ic_info, "About", { showAbout() }),
        )
        val grid = android.widget.GridLayout(this).apply {
            columnCount = 4
        }
        val dm = resources.displayMetrics
        gridItems.forEach { (icon, label, action) ->
            val cell = menuIconCell(icon, label) { sheet.dismiss(); action() }
            val cp = android.widget.GridLayout.LayoutParams().apply {
                width = 0
                columnSpec = android.widget.GridLayout.spec(android.widget.GridLayout.UNDEFINED, 1f)
            }
            cell.layoutParams = cp
            grid.addView(cell)
        }
        body.addView(grid)
        sheet.setContentView(body)
        sheet.show()
    }

    private fun showAbout() {
        MaterialAlertDialogBuilder(this)
            .setTitle("Kastrava " + BuildConfig.VERSION_NAME)
            .setMessage(
                "Private browser · zero telemetry.\n" +
                    "Website data lives in memory and is wiped on exit.\n" +
                    "GPLv3 · kastrava.pp.ua",
            )
            .setPositiveButton("OK", null)
            .show()
    }

    private fun toggleBookmark() {
        if (!app.prefs.bookmarksEnabled) {
            Toast.makeText(this, "Bookmarks are turned off in Settings", Toast.LENGTH_SHORT).show()
            return
        }
        val wv = currentTab() ?: return
        val url = wv.url ?: return
        val store = BookmarkStore(this)
        if (store.contains(url)) {
            store.remove(url)
            Toast.makeText(this, "Bookmark removed", Toast.LENGTH_SHORT).show()
        } else {
            val title = wv.title?.takeIf { it.isNotBlank() } ?: url
            store.add(title, url)
            Toast.makeText(this, "Bookmarked", Toast.LENGTH_SHORT).show()
        }
    }

    private fun wipeNow() {
        try {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
        } catch (e: Exception) { }
        try {
            android.webkit.WebStorage.getInstance().deleteAllData()
        } catch (e: Exception) { }
        tabs.forEach {
            try {
                it.view.clearCache(true)
                it.view.clearHistory()
                it.view.clearFormData()
            } catch (e: Exception) { }
        }
        Toast.makeText(this, "Browsing data deleted", Toast.LENGTH_SHORT).show()
    }

    private fun requestDefaultBrowser() {
        try {
            if (android.os.Build.VERSION.SDK_INT < 29) {
                Toast.makeText(this, "Not supported on this Android version", Toast.LENGTH_SHORT).show()
                return
            }
            val rm = getSystemService(android.app.role.RoleManager::class.java) ?: return
            if (!rm.isRoleAvailable(android.app.role.RoleManager.ROLE_BROWSER)) {
                Toast.makeText(this, "Not supported on this device", Toast.LENGTH_SHORT).show()
                return
            }
            if (rm.isRoleHeld(android.app.role.RoleManager.ROLE_BROWSER)) {
                Toast.makeText(this, "Already the default browser", Toast.LENGTH_SHORT).show()
                return
            }
            startActivity(rm.createRequestRoleIntent(android.app.role.RoleManager.ROLE_BROWSER))
        } catch (e: Exception) {
            Toast.makeText(this, "Could not open system settings", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openTextSize() {
        val density = resources.displayMetrics.density
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * density).toInt(), (8 * density).toInt(), (20 * density).toInt(), 0)
        }
        val label = TextView(this).apply {
            text = "${app.prefs.textZoom}%"
            textSize = 16f
            gravity = android.view.Gravity.CENTER
        }
        val bar = SeekBar(this).apply {
            min = 50
            max = 200
            progress = app.prefs.textZoom
        }
        wrap.addView(label)
        wrap.addView(bar)
        bar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, v: Int, fromUser: Boolean) {
                if (!fromUser) return
                app.prefs.textZoom = v
                label.text = "${app.prefs.textZoom}%"
                tabs.forEach { it.view.settings.textZoom = app.prefs.textZoom }
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })
        MaterialAlertDialogBuilder(this)
            .setTitle("Text size")
            .setView(wrap)
            .setPositiveButton("Done", null)
            .show()
    }

    private fun renderQuickBookmarks() {
        val grid: GridLayout = try { findViewById(R.id.quickBookmarks) } catch (e: Exception) { return }
        grid.removeAllViews()
        // Desktop bookmarksEnabled + showQuick + ntpTiles equivalents.
        if (!app.prefs.bookmarksEnabled || !app.prefs.showQuick) {
            findViewById<TextView>(R.id.quickLabel).visibility = View.GONE
            grid.visibility = View.GONE
            return
        }
        val marks = try { BookmarkStore(this).load() } catch (e: Exception) { emptyList() }
        if (marks.isEmpty()) {
            findViewById<TextView>(R.id.quickLabel).visibility = View.GONE
            grid.visibility = View.GONE
            return
        }
        findViewById<TextView>(R.id.quickLabel).visibility = View.VISIBLE
        grid.visibility = View.VISIBLE
        val density = resources.displayMetrics.density
        marks.take(app.prefs.ntpTiles.coerceIn(1, 12)).forEach { bm ->
            val cell = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                isClickable = true
                isFocusable = true
                setBackgroundResource(selectableBackground())
                setPadding(0, (10 * density).toInt(), 0, (10 * density).toInt())
                setOnClickListener {
                    if (current < 0) newTab(bm.url) else currentTab()?.loadUrl(bm.url)
                }
            }
            val dot = TextView(this).apply {
                layoutParams = LinearLayout.LayoutParams((48 * density).toInt(), (48 * density).toInt())
                gravity = android.view.Gravity.CENTER
                textSize = 20f
                text = bm.title.trim().firstOrNull()?.uppercase() ?: "K"
            }
            dot.background = getDrawable(R.drawable.dot_bg)
            cell.addView(dot)
            cell.addView(TextView(this).apply {
                text = bm.title
                textSize = 11f
                maxLines = 1
                setPadding(0, (6 * density).toInt(), 0, 0)
            })
            val cp = GridLayout.LayoutParams().apply {
                width = 0
                columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
            }
            cell.layoutParams = cp
            grid.addView(cell)
        }
    }

    private fun sharePage() {
        val url = currentTab()?.url ?: return
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, url)
        }
        startActivity(Intent.createChooser(send, "Share page"))
    }

    private fun openFindBar() {
        if (currentTab() == null) return
        findBar.visibility = LinearLayout.VISIBLE
        etFind.requestFocus()
        etFind.setText("")
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showSoftInput(etFind, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun closeFindBar() {
        currentTab()?.clearMatches()
        findBar.visibility = LinearLayout.GONE
        hideKeyboard(etFind)
    }

    private fun toggleDesktopMode() {
        val tab = currentWebTab() ?: return
        applyDesktopMode(tab, !tab.desktopMode)
        tab.view.reload()
    }

    private fun applyDesktopMode(tab: WebTab, on: Boolean) {
        tab.desktopMode = on
        tab.view.settings.userAgentString = if (on) DESKTOP_UA else tab.defaultUa
        tab.view.settings.useWideViewPort = true
        tab.view.settings.loadWithOverviewMode = true
    }

    private fun copyLink(url: String, label: String = "Link copied") {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("link", url))
        Toast.makeText(this, label, Toast.LENGTH_SHORT).show()
    }

    private fun showLinkMenu(url: String?, isImage: Boolean) {
        if (url.isNullOrBlank()) return
        val saved = BookmarkStore(this).contains(url)
        val items = if (isImage) {
            arrayOf("Open image in new tab", "Download image", "Share link", "Copy link")
        } else if (saved) {
            arrayOf("Open in new tab", "Remove bookmark", "Share link", "Copy link")
        } else {
            arrayOf("Open in new tab", "Bookmark link", "Share link", "Copy link")
        }
        MaterialAlertDialogBuilder(this)
            .setItems(items) { _, which ->
                val action = items[which]
                when {
                    action.startsWith("Open") -> newTab(url)
                    action.startsWith("Bookmark") -> {
                        BookmarkStore(this@MainActivity).add(url, url)
                        Toast.makeText(this@MainActivity, "Bookmarked", Toast.LENGTH_SHORT).show()
                    }
                    action.startsWith("Remove bookmark") -> {
                        BookmarkStore(this@MainActivity).remove(url)
                        Toast.makeText(this@MainActivity, "Bookmark removed", Toast.LENGTH_SHORT).show()
                    }
                    action.startsWith("Download") -> startSessionDownload(url, null)
                    action.startsWith("Share") -> {
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, url)
                        }
                        startActivity(Intent.createChooser(send, "Share link"))
                    }
                    else -> copyLink(url)
                }
            }
            .show()
    }

    private fun refreshPremiumLine() {
        val st = app.license.status()
        homePremium.text = if (st.activated) {
            val exp = st.expiresAtMs?.let { java.text.DateFormat.getDateInstance().format(java.util.Date(it)) }
            if (st.grace) "Premium active — renewal due (grace until $exp)"
            else "Premium active" + (if (exp != null) " · until $exp" else "")
        } else {
            "Free core · Premium $7/mo · $2/day"
        }
    }

    // ----- session restore (F6, free): URLs only, pages reload fresh -----

    private fun saveSession() {
        // historyEnabled off = don't record anything, drop the old record.
        if (!app.prefs.historyEnabled) {
            app.prefs.sessionTabs = ""
            app.prefs.sessionActive = -1
            return
        }
        try {
            val arr = org.json.JSONArray()
            tabs.forEach {
                val u = it.view.url
                if (!u.isNullOrBlank()) {
                    arr.put(org.json.JSONObject().put("u", u).put("t", it.view.title ?: ""))
                }
            }
            app.prefs.sessionTabs = arr.toString()
            app.prefs.sessionActive = current
        } catch (e: Exception) { }
    }

    private fun restoreSession(): Boolean {
        if (!app.prefs.historyEnabled || !app.prefs.restoreTabs) return false
        return try {
            val raw = app.prefs.sessionTabs
            if (raw.isBlank()) return false
            val arr = org.json.JSONArray(raw)
            if (arr.length() == 0) return false
            for (i in 0 until arr.length()) {
                val u = arr.optJSONObject(i)?.optString("u") ?: ""
                if (u.isNotBlank()) newTab(u)
            }
            if (tabs.isEmpty()) return false
            val ai = app.prefs.sessionActive
            switchTo(if (ai in tabs.indices) ai else tabs.size - 1)
            true
        } catch (e: Exception) {
            false
        }
    }

    // ----- screenshot (F7, free): PixelCopy of the window -> Downloads -----

    private fun takeScreenshot() {
        if (currentTab() == null) {
            Toast.makeText(this, "Nothing to capture", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val root = window.decorView
            if (root.width <= 0 || root.height <= 0) {
                Toast.makeText(this, "Screenshot failed", Toast.LENGTH_SHORT).show()
                return
            }
            val bmp = android.graphics.Bitmap.createBitmap(root.width, root.height, android.graphics.Bitmap.Config.ARGB_8888)
            val rect = android.graphics.Rect(0, 0, root.width, root.height)
            android.view.PixelCopy.request(window, rect, bmp, { res ->
                if (res == android.view.PixelCopy.SUCCESS) saveScreenshot(bmp)
                else runOnUiThread { Toast.makeText(this, "Screenshot failed", Toast.LENGTH_SHORT).show() }
            }, android.os.Handler(mainLooper))
        } catch (e: Exception) {
            Toast.makeText(this, "Screenshot failed", Toast.LENGTH_SHORT).show()
        }
    }

    private fun saveScreenshot(bmp: android.graphics.Bitmap) {
        Thread {
            var name = ""
            try {
                name = "Kastrava-" + java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(java.util.Date()) + ".png"
                val tmp = java.io.File.createTempFile("shot", ".png", cacheDir)
                tmp.outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                val ok = if (android.os.Build.VERSION.SDK_INT >= 29) {
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, name)
                        put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
                        put(android.provider.MediaStore.Images.Media.IS_PENDING, 1)
                    }
                    val resolver = contentResolver
                    val uri = resolver.insert(
                        android.provider.MediaStore.Images.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY),
                        values,
                    )
                    if (uri == null) false else {
                        resolver.openOutputStream(uri)?.use { out ->
                            tmp.inputStream().use { it.copyTo(out) }
                        }
                        values.clear()
                        values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0)
                        resolver.update(uri, values, null, null)
                        true
                    }
                } else {
                    @Suppress("DEPRECATION")
                    val dest = java.io.File(
                        android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES),
                        name,
                    )
                    tmp.copyTo(dest, overwrite = true)
                    true
                }
                try { tmp.delete() } catch (ignored: Exception) { }
                runOnUiThread {
                    Toast.makeText(this, if (ok) "Saved to gallery: $name" else "Screenshot failed", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, "Screenshot failed", Toast.LENGTH_SHORT).show() }
            }
        }.start()
    }

    // ----- downloads -----


    private fun startSessionDownload(url: String, contentDisposition: String?) {
        val name = URLUtil.guessFileName(url, contentDisposition, null)
        val item = app.downloads.add(url, name)
        // WebViews must only be touched on the UI thread — snapshot the UA now.
        val ua = currentTab()?.settings?.userAgentString ?: System.getProperty("http.agent")
        Toast.makeText(this, "Downloading: $name", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                if (ua != null) conn.setRequestProperty("User-Agent", ua)
                conn.connect()
                item.total = conn.contentLengthLong
                conn.inputStream.use { input ->
                    item.file.outputStream().use { output ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            item.received += n
                        }
                    }
                }
                item.state = "done"
            } catch (e: Exception) {
                item.state = "failed"
                try { item.file.delete() } catch (ignored: Exception) { }
            }
            runOnUiThread {
                Toast.makeText(
                    this,
                    if (item.state == "done") "Saved to session: $name" else "Download failed: $name",
                    Toast.LENGTH_SHORT,
                ).show()
            }
        }.start()
        // Offer the Downloads screen right away; explicit Save copies it out.
        startActivity(Intent(this, DownloadsActivity::class.java))
    }

    private fun selectableBackground(): Int {
        val tv = TypedValue()
        theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        return tv.resourceId
    }

    private fun hideKeyboard(v: android.view.View) {
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(v.windowToken, 0)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Fullscreen video exits first, like every other browser.
            if (customView != null) {
                try { currentTab()?.webChromeClient?.onHideCustomView() } catch (e: Exception) { }
                return true
            }
            val wv = currentTab()
            if (wv != null && wv.canGoBack()) {
                wv.goBack()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        // Tear down WebViews first so their renderers release, then wipe.
        tabs.toList().forEach { tab ->
            try {
                container.removeView(tab.view)
                tab.view.clearCache(true)
                tab.view.destroy()
            } catch (e: Exception) { }
        }
        tabs.clear()
        try {
            app.wipeSession()
        } catch (e: Exception) { }
        super.onDestroy()
    }
}
