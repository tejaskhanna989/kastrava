package pp.ua.kastrava

import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder

class VaultActivity : AppCompatActivity() {

    private lateinit var store: VaultStore
    private lateinit var lockBox: LinearLayout
    private lateinit var mainBox: LinearLayout
    private lateinit var pass: EditText
    private lateinit var msg: TextView
    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = VaultStore(this)
        setContentView(R.layout.activity_vault)

        lockBox = findViewById(R.id.vaultLock)
        mainBox = findViewById(R.id.vaultMain)
        pass = findViewById(R.id.vaultPass)
        msg = findViewById(R.id.vaultMsg)
        list = findViewById(R.id.vaultList)
        val unlock: Button = findViewById(R.id.vaultUnlock)
        val setup: Button = findViewById(R.id.vaultSetup)
        val add: Button = findViewById(R.id.vaultAdd)
        val lock: Button = findViewById(R.id.vaultLockBtn)

        setup.visibility = if (store.hasVault()) Button.GONE else Button.VISIBLE
        unlock.text = if (store.hasVault()) "Unlock" else "Unlock"

        unlock.setOnClickListener {
            val pw = pass.text.toString()
            if (pw.isEmpty()) {
                msg.text = "Enter your vault password."
                return@setOnClickListener
            }
            Thread {
                val ok = store.unlock(pw)
                runOnUiThread {
                    if (ok) {
                        pass.text.clear()
                        showMain()
                    } else {
                        msg.text = "Wrong password."
                    }
                }
            }.start()
        }
        setup.setOnClickListener {
            val pw = pass.text.toString()
            if (pw.length < 4) {
                msg.text = "Password needs at least 4 characters."
                return@setOnClickListener
            }
            Thread {
                val ok = store.setup(pw)
                runOnUiThread {
                    if (ok) {
                        pass.text.clear()
                        setup.visibility = Button.GONE
                        showMain()
                    } else {
                        msg.text = "Could not create vault."
                    }
                }
            }.start()
        }
        add.setOnClickListener { editNote(0L, "", "") }
        lock.setOnClickListener {
            store.lock()
            showLock()
            Toast.makeText(this, "Vault locked", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onPause() {
        super.onPause()
        // Never leave decrypted notes in memory while backgrounded.
        if (store.unlocked) {
            store.lock()
            showLock()
        }
    }

    private fun showLock() {
        lockBox.visibility = LinearLayout.VISIBLE
        mainBox.visibility = LinearLayout.GONE
        msg.text = if (store.hasVault()) "" else "No vault yet — set a password to create one."
        setup.visibility = if (store.hasVault()) Button.GONE else Button.VISIBLE
    }

    private fun showMain() {
        lockBox.visibility = LinearLayout.GONE
        mainBox.visibility = LinearLayout.VISIBLE
        render()
    }

    private fun render() {
        list.removeAllViews()
        val notes = store.list()
        if (notes.isEmpty()) {
            list.addView(TextView(this).apply {
                text = "No notes yet."
                textSize = 13f
            })
            return
        }
        val density = resources.displayMetrics.density
        notes.forEach { n ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val pad = (12 * density).toInt()
                setPadding(pad, pad, pad, pad)
                isClickable = true
                isFocusable = true
                setOnClickListener { editNote(n.id, n.title, n.body) }
            }
            row.addView(TextView(this).apply {
                text = n.title.ifBlank { "(untitled)" }
                textSize = 15f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            row.addView(TextView(this).apply {
                text = n.body.lines().firstOrNull()?.take(80) ?: ""
                textSize = 12f
                maxLines = 1
            })
            list.addView(row)
        }
    }

    private fun editNote(id: Long, title: String, body: String) {
        val density = resources.displayMetrics.density
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * density).toInt()
            setPadding(pad, pad / 2, pad, 0)
        }
        val tTitle = EditText(this).apply {
            hint = "Title"
            setText(title)
            inputType = InputType.TYPE_CLASS_TEXT
        }
        val tBody = EditText(this).apply {
            hint = "Note"
            setText(body)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            minLines = 4
            gravity = Gravity.TOP
        }
        wrap.addView(tTitle)
        wrap.addView(tBody)
        val dlg = MaterialAlertDialogBuilder(this)
            .setTitle(if (id == 0L) "New note" else "Edit note")
            .setView(wrap)
            .setPositiveButton("Save", null)
            .setNegativeButton("Cancel", null)
        if (id != 0L) dlg.setNeutralButton("Delete", null)
        val d = dlg.create()
        d.setOnShowListener {
            d.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val ok = store.save(tTitle.text.toString().trim(), tBody.text.toString(), id)
                if (ok) {
                    d.dismiss()
                    render()
                } else {
                    Toast.makeText(this, "Could not save", Toast.LENGTH_SHORT).show()
                }
            }
            if (id != 0L) {
                d.getButton(androidx.appcompat.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                    store.delete(id)
                    d.dismiss()
                    render()
                }
            }
        }
        d.show()
    }
}
