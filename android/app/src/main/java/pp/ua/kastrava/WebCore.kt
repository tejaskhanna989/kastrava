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
) : WebViewClient() {

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? {
        if (!request.isForMainFrame && blockEnabled()) {
            try {
                val host = request.url.host
                if (filters.shouldBlock(host)) {
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

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        CookieReject.inject(view)
        onPageEvent()
    }
}

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
