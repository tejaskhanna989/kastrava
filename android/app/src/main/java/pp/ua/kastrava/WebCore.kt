package pp.ua.kastrava

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

/**
 * Per-tab WebView: tracker blocking at the network layer, external schemes
 * delegated to other apps, http(s) kept inside the browser.
 */
class KastraWebClient(
    private val filters: FilterLists,
    private val blockEnabled: () -> Boolean,
    private val onPageEvent: () -> Unit = {},
    private val onBlocked: () -> Unit = {},
    private val onPageStart: () -> Unit = {},
    private val onCrashed: (WebView) -> Unit = {},
) : WebViewClient() {

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? {
        // file:// never reaches the page (desktop cancels it too).
        try {
            if (request.url.scheme?.lowercase() == "file") {
                return WebResourceResponse(
                    "text/plain", "utf-8", 404, "Blocked",
                    mapOf(), ByteArrayInputStream(ByteArray(0)),
                )
            }
        } catch (e: Exception) { }
        if (!request.isForMainFrame && blockEnabled()) {
            try {
                val host = request.url.host
                if (filters.shouldBlock(host)) {
                    try { onBlocked() } catch (e: Exception) { }
                    return WebResourceResponse(
                        "text/plain", "utf-8", 404, "Blocked",
                        mapOf(), ByteArrayInputStream(ByteArray(0)),
                    )
                }
            } catch (e: Exception) { }
        }
        return super.shouldInterceptRequest(view, request)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme == "http" || scheme == "https") return false
        // mailto:, tel:, intent: and friends belong to other apps —
        // never hand them to the page, just delegate.
        return try {
            view.context.startActivity(Intent(Intent.ACTION_VIEW, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            true
        } catch (e: Exception) {
            true
        }
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        super.onPageStarted(view, url, favicon)
        try { onPageStart() } catch (e: Exception) { }
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        CookieReject.inject(view)
        onPageEvent()
    }

    override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
        // Crashed renderer: let the activity rebuild the tab instead of dying.
        try { onCrashed(view) } catch (e: Exception) { }
        return true
    }
}

@SuppressLint("SetJavaScriptEnabled")
fun buildWebView(context: Context, prefs: Prefs): WebView {
    return WebView(context).apply {
        settings.javaScriptEnabled = prefs.javaScript
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        // Ported desktop content switches.
        settings.textZoom = prefs.textZoom
        try { settings.defaultFontSize = prefs.fontSize } catch (e: Exception) { }
        try { settings.loadsImagesAutomatically = prefs.loadImages } catch (e: Exception) { }
        try { settings.blockNetworkImage = !prefs.loadImages } catch (e: Exception) { }
        try {
            settings.mixedContentMode =
                if (prefs.blockMixed) android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                else android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        } catch (e: Exception) { }
        try { settings.safeBrowsingEnabled = prefs.safeBrowsing } catch (e: Exception) { }
        try { settings.geolocationEnabled = prefs.geoEnabled } catch (e: Exception) { }
        // Local file access stays off unless the user opts in.
        try { settings.allowFileAccess = prefs.fileAccess } catch (e: Exception) { }
        try { settings.allowContentAccess = true } catch (e: Exception) { }
        try { settings.allowFileAccessFromFileURLs = false } catch (e: Exception) { }
        try { settings.allowUniversalAccessFromFileURLs = false } catch (e: Exception) { }
        try {
            setLayerType(
                if (prefs.hwAccel) android.view.View.LAYER_TYPE_HARDWARE
                else android.view.View.LAYER_TYPE_SOFTWARE, null,
            )
        } catch (e: Exception) { }
    }
}

/** Legacy two-arg form kept for callers not yet migrated. */
@SuppressLint("SetJavaScriptEnabled")
fun buildWebView(context: Context, javaScript: Boolean): WebView {
    return WebView(context).apply {
        settings.javaScriptEnabled = javaScript
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
    }
}

fun resolveInput(input: String, engineUrl: (String) -> String): String {
    val t = input.trim()
    if (t.isEmpty()) return engineUrl("")
    if (t.contains(" ") || !t.contains(".")) {
        return engineUrl(Uri.encode(t))
    }
    var url = t
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://$url"
    return url
}
