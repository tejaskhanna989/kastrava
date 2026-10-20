package pp.ua.kastrava

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.ListView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder

class BookmarksActivity : AppCompatActivity() {
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleHelper.force(newBase))
    }


    private lateinit var adapter: ArrayAdapter<String>
    private var items: List<Bookmark> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_bookmarks)

        val list: ListView = findViewById(R.id.bmList)
        adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, mutableListOf())
        list.adapter = adapter
        list.setOnItemClickListener { _, _, pos, _ ->
            val bm = items.getOrNull(pos) ?: return@setOnItemClickListener
            MaterialAlertDialogBuilder(this)
                .setTitle(bm.title)
                .setItems(arrayOf(getString(R.string.open2), getString(R.string.m_share), getString(R.string.delete2))) { _, which ->
                    when (which) {
                        0 -> startActivity(
                            Intent(this@BookmarksActivity, MainActivity::class.java)
                                .setAction(Intent.ACTION_VIEW)
                                .setData(Uri.parse(bm.url)),
                        )
                        1 -> startActivity(
                            Intent.createChooser(
                                Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, bm.url)
                                },
                                getString(R.string.share_bm),
                            ),
                        )
                        else -> {
                            BookmarkStore(this).remove(bm.url)
                            refresh()
                        }
                    }
                }
                .show()
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        items = BookmarkStore(this).load()
        adapter.clear()
        if (items.isEmpty()) adapter.add("No bookmarks yet — star pages from the menu.")
        else items.forEach { adapter.add(it.title) }
    }
}
