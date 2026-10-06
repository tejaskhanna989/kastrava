package pp.ua.kastrava

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class PremiumActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as KastravaApp
        setContentView(R.layout.activity_premium)

        val status: TextView = findViewById(R.id.premStatus)
        val machine: TextView = findViewById(R.id.premMachine)
        val key: EditText = findViewById(R.id.premKey)
        val msg: TextView = findViewById(R.id.premMsg)
        val activate: Button = findViewById(R.id.premActivate)
        val buy: Button = findViewById(R.id.premBuy)
        val stop: Button = findViewById(R.id.premStop)

        machine.text = app.license.machineCode()
        machine.setOnClickListener {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("machine", machine.text.toString()))
            Toast.makeText(this, "Machine code copied", Toast.LENGTH_SHORT).show()
        }

        fun refresh() {
            val st = app.license.status()
            val dev = app.license.lastDevices
            val devTxt = if (st.activated && dev != null && dev.first >= 0) " · ${dev.first}/${dev.second} devices" else ""
            status.text = if (st.activated) {
                val exp = st.expiresAtMs?.let {
                    java.text.DateFormat.getDateInstance().format(java.util.Date(it))
                }
                if (st.grace) "Premium active — renewal due (grace until $exp)$devTxt"
                else "Premium active" + (if (exp != null) " · until $exp" else "") + devTxt
            } else {
                "Free core" + (if (st.reason != null && st.reason != "no_license") " (${st.reason})" else "")
            }
            if (st.key != null && key.text.isBlank()) key.setText(st.key)
        }
        refresh()
        // Logged in? The account key auto-activates this device on open.
        if (app.account.loggedIn()) {
            msg.text = "Checking account key…"
            Thread {
                val err = app.license.activateAccount(app.account.token() ?: "")
                runOnUiThread {
                    if (err == null) {
                        msg.text = "Premium activated on this device."
                        refresh()
                    } else {
                        msg.text = err
                        refresh()
                    }
                }
            }.start()
        }

        activate.setOnClickListener {
            val k = key.text.toString().trim()
            if (k.isEmpty()) {
                msg.text = "Enter the license key from your purchase."
                return@setOnClickListener
            }
            msg.text = "Activating…"
            activate.isEnabled = false
            Thread {
                val err = app.license.activate(k)
                runOnUiThread {
                    activate.isEnabled = true
                    if (err == null) {
                        msg.text = "Activated on this device."
                        refresh()
                    } else {
                        msg.text = err
                    }
                }
            }.start()
        }

        stop.setOnClickListener {
            val st0 = app.license.status()
            if (!st0.activated) {
                msg.text = "No active Premium on this device."
                return@setOnClickListener
            }
            com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle("Stop Premium?")
                .setMessage("This ends Premium on this device immediately. No refund is issued.")
                .setPositiveButton("Stop") { _, _ ->
                    msg.text = "Stopping Premium…"
                    stop.isEnabled = false
                    Thread {
                        val err = app.license.cancel()
                        runOnUiThread {
                            stop.isEnabled = true
                            if (err == null) {
                                msg.text = "Premium stopped. No refund was issued."
                                key.text.clear()
                                refresh()
                            } else {
                                msg.text = err
                            }
                        }
                    }.start()
                }
                .setNegativeButton("Keep", null)
                .show()
        }

        buy.setOnClickListener {
            // Checkout lives on the site; the machine code is passed along
            // so the payment page can pre-fill it (same as desktop).
            val url = "https://kastrava.pp.ua/#premium?machine=" +
                Uri.encode(app.license.machineCode())
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }
    }
}
