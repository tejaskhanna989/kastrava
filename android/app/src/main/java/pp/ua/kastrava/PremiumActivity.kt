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
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleHelper.force(newBase))
    }


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
            Toast.makeText(this, getString(R.string.machine_copied), Toast.LENGTH_SHORT).show()
        }

        fun refresh() {
            val st = app.license.status()
            val dev = app.license.lastDevices
            val devTxt = if (st.activated && dev != null && dev.first >= 0) " · ${dev.first}/${dev.second} devices" else ""
            status.text = if (st.activated) {
                val exp = st.expiresAtMs?.let {
                    java.text.DateFormat.getDateInstance().format(java.util.Date(it))
                }
                if (st.grace) getString(R.string.premium_active_grace, exp, devTxt)
                else if (exp != null) getString(R.string.premium_active_until, exp, devTxt) else getString(R.string.premium_active) + devTxt
            } else {
                getString(R.string.free_core) + (if (st.reason != null && st.reason != "no_license") " (${st.reason})" else "")
            }
            if (st.key != null && key.text.isBlank()) key.setText(st.key)
        }
        refresh()
        // Logged in? The account key auto-activates this device on open.
        if (app.account.loggedIn()) {
            msg.text = getString(R.string.checking_key)
            Thread {
                val err = app.license.activateAccount(app.account.token() ?: "")
                runOnUiThread {
                    if (err == null) {
                        msg.text = getString(R.string.premium_activated)
                        refresh()
                    } else {
                        msg.text = err
                        refresh()
                    }
                }
            }.start()
        }

        activate.setOnClickListener {
            if (!app.account.loggedIn()) {
                msg.text = getString(R.string.login_first_premium)
                return@setOnClickListener
            }
            val k = key.text.toString().trim()
            if (k.isEmpty()) {
                msg.text = getString(R.string.enter_key)
                return@setOnClickListener
            }
            msg.text = getString(R.string.activating)
            activate.isEnabled = false
            Thread {
                val err = app.license.activate(k)
                runOnUiThread {
                    activate.isEnabled = true
                    if (err == null) {
                        msg.text = getString(R.string.activated_here)
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
                msg.text = getString(R.string.no_premium_here)
                return@setOnClickListener
            }
            com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.stop_premium_q))
                .setMessage(getString(R.string.stop_premium_msg))
                .setPositiveButton(getString(R.string.stop)) { _, _ ->
                    msg.text = getString(R.string.stopping)
                    stop.isEnabled = false
                    Thread {
                        val err = app.license.cancel()
                        runOnUiThread {
                            stop.isEnabled = true
                            if (err == null) {
                                msg.text = getString(R.string.stopped_no_refund)
                                key.text.clear()
                                refresh()
                            } else {
                                msg.text = err
                            }
                        }
                    }.start()
                }
                .setNegativeButton(getString(R.string.keep), null)
                .show()
        }

        buy.setOnClickListener {
            // Checkout lives on the site; the machine code is passed along
            // so the payment page can pre-fill it (same as desktop).
            val url = "https://kastrava.in/#premium?machine=" +
                Uri.encode(app.license.machineCode())
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }
    }
}
