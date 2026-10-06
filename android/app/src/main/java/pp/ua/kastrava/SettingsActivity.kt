package pp.ua.kastrava

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import android.widget.SeekBar
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as KastravaApp
        setContentView(R.layout.activity_settings)

        val engineGroup: RadioGroup = findViewById(R.id.engineGroup)
        val premium = app.license.status().activated
        Prefs.ENGINES.forEach { (key, meta) ->
            val (name, _) = meta
            val locked = !premium && key !in Prefs.FREE_ENGINES
            val rb = RadioButton(this).apply {
                text = if (locked) "$name (Premium)" else name
                tag = key
                isChecked = app.prefs.engine == key
                isEnabled = !locked
            }
            engineGroup.addView(rb)
        }
        engineGroup.setOnCheckedChangeListener { group, checkedId ->
            val rb = group.findViewById<RadioButton>(checkedId) ?: return@setOnCheckedChangeListener
            app.prefs.engine = rb.tag as String
        }

        val themeGroup: RadioGroup = findViewById(R.id.themeGroup)
        when (app.prefs.theme) {
            "light" -> themeGroup.check(R.id.themeLight)
            "dark" -> themeGroup.check(R.id.themeDark)
            else -> themeGroup.check(R.id.themeSystem)
        }
        themeGroup.setOnCheckedChangeListener { _, checkedId ->
            app.prefs.theme = when (checkedId) {
                R.id.themeLight -> "light"
                R.id.themeDark -> "dark"
                else -> "system"
            }
            app.applyTheme()
        }

        val cbBlockers: CheckBox = findViewById(R.id.cbBlockers)
        cbBlockers.isChecked = app.prefs.blockers
        cbBlockers.setOnCheckedChangeListener { _, v -> app.prefs.blockers = v }

        val sbZoom: SeekBar = findViewById(R.id.sbTextZoom)
        val tvZoom: TextView = findViewById(R.id.tvTextZoom)
        sbZoom.progress = app.prefs.textZoom
        tvZoom.text = "${app.prefs.textZoom}%"
        sbZoom.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, v: Int, fromUser: Boolean) {
                if (!fromUser) return
                app.prefs.textZoom = v
                tvZoom.text = "${app.prefs.textZoom}%"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {
                Toast.makeText(this@SettingsActivity, "Applies to tabs", Toast.LENGTH_SHORT).show()
            }
        })

        val tvUpdate: TextView = findViewById(R.id.tvUpdateStatus)
        val btnUpd: Button = findViewById(R.id.btnCheckUpdates)
        fun showUpdate(u: UpdateInfo?) {
            tvUpdate.text = if (u == null) "Up to date."
            else "Kastrava ${u.name} available." + (if (u.notes.isNotBlank()) " " + u.notes.take(120) else "")
        }
        btnUpd.setOnClickListener {
            tvUpdate.text = "Checking..."
            btnUpd.isEnabled = false
            Thread {
                val u = Updater.check(this, force = true)
                runOnUiThread {
                    btnUpd.isEnabled = true
                    showUpdate(u)
                    if (u != null) {
                        Updater.download(this, u)
                        tvUpdate.text = "Downloading Kastrava ${u.name}..."
                    }
                }
            }.start()
        }

        val cbJs: CheckBox = findViewById(R.id.cbJs)
        cbJs.isChecked = app.prefs.javaScript
        cbJs.setOnCheckedChangeListener { _, v ->
            app.prefs.javaScript = v
            Toast.makeText(this, "Applies to new and current tabs", Toast.LENGTH_SHORT).show()
        }

        val tvAccount: TextView = findViewById(R.id.tvAccountStatus)
        val etEmail = findViewById<EditText>(R.id.etAccountEmail)
        val etPass = findViewById<EditText>(R.id.etAccountPass)
        val btnIn: Button = findViewById(R.id.btnAccountGo)
        val btnOut: Button = findViewById(R.id.btnAccountOut)
        fun paintAccount() {
            val em = app.account.email()
            tvAccount.text = if (app.account.loggedIn()) "Signed in as $em. Same key auto-activates on up to 10 devices."
            else "Not logged in. One login syncs and activates Premium."
            if (!em.isNullOrBlank() && etEmail.text.isBlank()) etEmail.setText(em)
        }
        paintAccount()
        btnIn.setOnClickListener {
            val em = etEmail.text.toString()
            val pw = etPass.text.toString()
            tvAccount.text = "Logging in..."
            btnIn.isEnabled = false
            Thread {
                val err = app.account.login(em, pw)
                runOnUiThread {
                    btnIn.isEnabled = true
                    if (err == null) {
                        etPass.text.clear()
                        paintAccount()
                        // Auto-activate the account key on this device.
                        Thread {
                            app.license.activateAccount(app.account.token() ?: "")
                            runOnUiThread { paintAccount() }
                        }.start()
                    } else {
                        tvAccount.text = err
                    }
                }
            }.start()
        }
        btnOut.setOnClickListener {
            app.account.logout()
            etPass.text.clear()
            paintAccount()
            Toast.makeText(this, "Logged out", Toast.LENGTH_SHORT).show()
        }
        findViewById<Button>(R.id.btnAdvanced).setOnClickListener {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://account.kastrava.pp.ua")))
            } catch (e: Exception) {
                Toast.makeText(this, "Could not open browser", Toast.LENGTH_SHORT).show()
            }
        }

        val cbBattery: CheckBox = findViewById(R.id.cbBattery)
        cbBattery.isChecked = app.prefs.batterySaver
        cbBattery.setOnCheckedChangeListener { _, v ->
            app.prefs.batterySaver = v
            Toast.makeText(this, if (v) "Background tabs will pause" else "Background tabs stay live", Toast.LENGTH_SHORT).show()
        }
    }
}
