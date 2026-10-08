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
            val key = rb.tag as String
            app.prefs.engine = key
            try {
                findViewById<EditText>(R.id.etCustomEngine).visibility =
                    if (key == "custom") EditText.VISIBLE else EditText.GONE
            } catch (e: Exception) { }
        }

        val etCustom: EditText = findViewById(R.id.etCustomEngine)
        etCustom.setText(app.prefs.customEngine)
        etCustom.visibility = if (app.prefs.engine == "custom") EditText.VISIBLE else EditText.GONE
        etCustom.setOnFocusChangeListener { v, focused ->
            if (!focused) app.prefs.customEngine = (v as EditText).text.toString().trim()
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
                // A finished APK may already sit on disk (e.g. downloaded
                // earlier, or installed after allowing unknown sources).
                // Install it instead of downloading again when it matches.
                val have = Updater.downloadedFile(this)
                val haveCode = if (have != null) Updater.apkCode(this, have) else -1L
                runOnUiThread {
                    btnUpd.isEnabled = true
                    if (u != null && (have == null || haveCode < u.code)) {
                        showUpdate(u)
                        val id = Updater.download(this, u)
                        if (id >= 0) tvUpdate.text = "Downloading Kastrava ${u.name}..."
                    } else if (u != null && have != null) {
                        showUpdate(u)
                        tvUpdate.text = "Update ready to install."
                        Updater.promptInstall(this, have)
                    } else if (have != null && haveCode > 0) {
                        showUpdate(null)
                        tvUpdate.text = "Update ready to install."
                        Updater.promptInstall(this, have)
                    } else {
                        showUpdate(u)
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
        val tvSync: TextView = findViewById(R.id.tvSyncStatus)
        val btnSync: Button = findViewById(R.id.btnSyncNow)
        fun paintSync() {
            if (!app.account.loggedIn()) {
                tvSync.text = "Log in above to sync."
                return
            }
            val at = app.prefs.syncAt()
            tvSync.text = if (at > 0) {
                "Last sync: " + java.text.DateFormat.getDateTimeInstance().format(java.util.Date(at))
            } else {
                "Never synced on this device."
            }
        }
        paintSync()
        btnSync.setOnClickListener {
            tvSync.text = "Syncing..."
            btnSync.isEnabled = false
            Thread {
                val r = Sync.syncNow(app)
                runOnUiThread {
                    btnSync.isEnabled = true
                    tvSync.text = if (r.ok) "Synced." else r.msg
                    paintSync()
                    paintAccount()
                }
            }.start()
        }
        paintAccount()
        val etTotp = findViewById<EditText>(R.id.etAccountTotp)
        val etCode = findViewById<EditText>(R.id.etEmailCode)
        var lastPw = ""
        fun afterLogin() {
            etPass.text.clear()
            paintAccount()
            // Auto-activate the account key on this device.
            Thread {
                app.license.activateAccount(app.account.token() ?: "")
                runOnUiThread { paintAccount() }
            }.start()
            // Unlock sync: derive the key once, keep it in the OS keystore.
            val pwCopy = lastPw
            lastPw = ""
            Thread {
                try {
                    val salt = app.account.syncSalt()
                    if (salt != null) {
                        app.account.saveSyncKey(Sync.derive(pwCopy, salt))
                    }
                } catch (e: Exception) { }
                runOnUiThread { paintSync() }
            }.start()
        }
        btnIn.setOnClickListener {
            val em = etEmail.text.toString()
            val pw = etPass.text.toString()
            lastPw = pw
            val emailCode = etCode.text.toString().trim()
            val totp = etTotp.text.toString().trim()
            if (emailCode.isNotEmpty() || etCode.visibility == EditText.VISIBLE) {
                tvAccount.text = "Verifying..."
                btnIn.isEnabled = false
                Thread {
                    val err = app.account.loginStep2(em, emailCode, totp)
                    if (err == AccountManager.NEED_TOTP) {
                        runOnUiThread {
                            btnIn.isEnabled = true
                            etTotp.visibility = EditText.VISIBLE
                            etTotp.requestFocus()
                            tvAccount.text = "Also enter your authenticator code."
                        }
                        return@Thread
                    }
                    runOnUiThread {
                        btnIn.isEnabled = true
                        if (err == null) {
                            etPass.text.clear()
                            etCode.text.clear()
                            etCode.visibility = EditText.GONE
                            etTotp.text.clear()
                            etTotp.visibility = EditText.GONE
                            afterLogin()
                        } else {
                            tvAccount.text = err
                        }
                    }
                }.start()
                return@setOnClickListener
            }
            tvAccount.text = "Logging in..."
            btnIn.isEnabled = false
            Thread {
                when (val r = app.account.loginStep1(em, pw)) {
                    is AccountManager.StepResult.CodeSent -> runOnUiThread {
                        btnIn.isEnabled = true
                        etCode.visibility = EditText.VISIBLE
                        etCode.requestFocus()
                        if (r.totpRequired) etTotp.visibility = EditText.VISIBLE
                        tvAccount.text = "Code sent to your email — enter it above."
                    }
                    is AccountManager.StepResult.Failed -> runOnUiThread {
                        btnIn.isEnabled = true
                        tvAccount.text = r.msg
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

        // Previously on-screen but inert: wire them to the store.
        // MainActivity applies them live on resume + to every new tab.
        val cbImages: CheckBox = findViewById(R.id.cbImages)
        cbImages.isChecked = app.prefs.loadImages
        cbImages.setOnCheckedChangeListener { _, v ->
            app.prefs.loadImages = v
            Toast.makeText(this, "Applies to tabs", Toast.LENGTH_SHORT).show()
        }

        val cbDesktop: CheckBox = findViewById(R.id.cbDesktop)
        cbDesktop.isChecked = app.prefs.desktopDefault
        cbDesktop.setOnCheckedChangeListener { _, v ->
            app.prefs.desktopDefault = v
            Toast.makeText(this, if (v) "New tabs request desktop sites" else "New tabs request mobile sites", Toast.LENGTH_SHORT).show()
        }

        val cbRestore: CheckBox = findViewById(R.id.cbRestore)
        cbRestore.isChecked = app.prefs.restoreTabs
        cbRestore.setOnCheckedChangeListener { _, v -> app.prefs.restoreTabs = v }

        val cbQuick: CheckBox = findViewById(R.id.cbQuick)
        cbQuick.isChecked = app.prefs.showQuick
        cbQuick.setOnCheckedChangeListener { _, v -> app.prefs.showQuick = v }

        val cbBookmarks: CheckBox = findViewById(R.id.cbBookmarks)
        cbBookmarks.isChecked = app.prefs.bookmarksEnabled
        cbBookmarks.setOnCheckedChangeListener { _, v -> app.prefs.bookmarksEnabled = v }

        val cbHistory: CheckBox = findViewById(R.id.cbHistory)
        cbHistory.isChecked = app.prefs.historyEnabled
        cbHistory.setOnCheckedChangeListener { _, v ->
            app.prefs.historyEnabled = v
            Toast.makeText(this, if (v) "Tabs will be remembered" else "Tabs are forgotten on exit", Toast.LENGTH_SHORT).show()
        }

        val cbConfirm: CheckBox = findViewById(R.id.cbConfirmClose)
        cbConfirm.isChecked = app.prefs.confirmClose
        cbConfirm.setOnCheckedChangeListener { _, v -> app.prefs.confirmClose = v }

        val cbFullUrls: CheckBox = findViewById(R.id.cbFullUrls)
        cbFullUrls.isChecked = app.prefs.showFullUrls
        cbFullUrls.setOnCheckedChangeListener { _, v -> app.prefs.showFullUrls = v }

        val cbSafe: CheckBox = findViewById(R.id.cbSafe)
        cbSafe.isChecked = app.prefs.safeBrowsing
        cbSafe.setOnCheckedChangeListener { _, v -> app.prefs.safeBrowsing = v }

        val cbMixed: CheckBox = findViewById(R.id.cbMixed)
        cbMixed.isChecked = app.prefs.blockMixed
        cbMixed.setOnCheckedChangeListener { _, v -> app.prefs.blockMixed = v }

        val cbGeo: CheckBox = findViewById(R.id.cbGeo)
        cbGeo.isChecked = app.prefs.geoEnabled
        cbGeo.setOnCheckedChangeListener { _, v ->
            app.prefs.geoEnabled = v
            Toast.makeText(this, if (v) "Sites may request location" else "Location requests are denied", Toast.LENGTH_SHORT).show()
        }

        val cbFile: CheckBox = findViewById(R.id.cbFile)
        cbFile.isChecked = app.prefs.fileAccess
        cbFile.setOnCheckedChangeListener { _, v -> app.prefs.fileAccess = v }

        val cbHw: CheckBox = findViewById(R.id.cbHw)
        cbHw.isChecked = app.prefs.hwAccel
        cbHw.setOnCheckedChangeListener { _, v ->
            app.prefs.hwAccel = v
            Toast.makeText(this, "Applies to tabs", Toast.LENGTH_SHORT).show()
        }

        val cookieGroup: RadioGroup = findViewById(R.id.rgCookies)
        when (app.prefs.cookieMode) {
            "third" -> cookieGroup.check(R.id.cookieThird)
            "allow" -> cookieGroup.check(R.id.cookieAllow)
            else -> cookieGroup.check(R.id.cookieBlock)
        }
        cookieGroup.setOnCheckedChangeListener { _, checkedId ->
            app.prefs.cookieMode = when (checkedId) {
                R.id.cookieThird -> "third"
                R.id.cookieAllow -> "allow"
                else -> "block"
            }
            Toast.makeText(this, "Applies immediately", Toast.LENGTH_SHORT).show()
        }

        val tilesGroup: RadioGroup = findViewById(R.id.rgTiles)
        when (app.prefs.ntpTiles) {
            4 -> tilesGroup.check(R.id.tiles4)
            12 -> tilesGroup.check(R.id.tiles12)
            else -> tilesGroup.check(R.id.tiles8)
        }
        tilesGroup.setOnCheckedChangeListener { _, checkedId ->
            app.prefs.ntpTiles = when (checkedId) {
                R.id.tiles4 -> 4
                R.id.tiles12 -> 12
                else -> 8
            }
        }

        val maxGroup: RadioGroup = findViewById(R.id.rgMaxTabs)
        when (app.prefs.maxTabs) {
            20 -> maxGroup.check(R.id.max20)
            50 -> maxGroup.check(R.id.max50)
            100 -> maxGroup.check(R.id.max100)
            else -> maxGroup.check(R.id.maxNone)
        }
        maxGroup.setOnCheckedChangeListener { _, checkedId ->
            app.prefs.maxTabs = when (checkedId) {
                R.id.max20 -> 20
                R.id.max50 -> 50
                R.id.max100 -> 100
                else -> 0
            }
        }

        val sbFont: SeekBar = findViewById(R.id.sbFontSize)
        val tvFont: TextView = findViewById(R.id.tvFontSize)
        sbFont.progress = app.prefs.fontSize
        tvFont.text = "${app.prefs.fontSize}"
        sbFont.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, v: Int, fromUser: Boolean) {
                if (!fromUser) return
                app.prefs.fontSize = v
                tvFont.text = "${app.prefs.fontSize}"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {
                Toast.makeText(this@SettingsActivity, "Applies to tabs", Toast.LENGTH_SHORT).show()
            }
        })

        findViewById<Button>(R.id.btnClearData).setOnClickListener {
            try { android.webkit.CookieManager.getInstance().removeAllCookies(null) } catch (e: Exception) { }
            try { android.webkit.CookieManager.getInstance().flush() } catch (e: Exception) { }
            try { android.webkit.WebStorage.getInstance().deleteAllData() } catch (e: Exception) { }
            try { android.webkit.WebView(this).clearCache(true) } catch (e: Exception) { }
            Toast.makeText(this, "Browsing data deleted", Toast.LENGTH_SHORT).show()
        }

        findViewById<Button>(R.id.btnResetSettings).setOnClickListener {
            try {
                androidx.preference.PreferenceManager.getDefaultSharedPreferences(this)
                    .edit().clear().apply()
                app.applyTheme()
            } catch (e: Exception) { }
            Toast.makeText(this, "Settings reset", Toast.LENGTH_SHORT).show()
            recreate()
        }

        try {
            findViewById<TextView>(R.id.tvAboutVersion).text =
                "Kastrava " + BuildConfig.VERSION_NAME + " · private by default, zero telemetry."
        } catch (e: Exception) { }
    }
}
