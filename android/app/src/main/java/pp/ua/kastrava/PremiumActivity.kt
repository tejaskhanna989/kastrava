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
    private lateinit var app: KastravaApp
    private lateinit var status: TextView
    private lateinit var key: EditText
    private lateinit var msg: TextView

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleHelper.force(newBase))
    }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as KastravaApp
        setContentView(R.layout.activity_premium)

        status = findViewById(R.id.premStatus)
        val machine: TextView = findViewById(R.id.premMachine)
        key = findViewById(R.id.premKey)
        msg = findViewById(R.id.premMsg)
        val activate: Button = findViewById(R.id.premActivate)
        val buy: Button = findViewById(R.id.premBuy)
        val stop: Button = findViewById(R.id.premStop)

        machine.text = app.license.machineCode()
        machine.setOnClickListener {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("machine", machine.text.toString()))
            Toast.makeText(this, getString(R.string.machine_copied), Toast.LENGTH_SHORT).show()
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
            // Reviewer demo: marble race before allowing cancellation.
            if (app.account.email() == "reviewer@kastrava.in") {
                launchMarbleRace()
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
            // Reviewer demo account: 10-second checkout countdown, tap outside
            // to cancel the timer and unlock Premium instantly.
            if (app.account.email() == "reviewer@kastrava.in") {
                showDemoPremiumCheckout()
                return@setOnClickListener
            }
            // Checkout lives on the site; the machine code is passed along
            // so the payment page can pre-fill it (same as desktop).
            val url = "https://kastrava.in/#premium?machine=" +
                Uri.encode(app.license.machineCode())
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }
    }

    private fun refresh() {
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

    /** Google Play reviewer demo: Premium checkout bypass with 10s countdown. */
    private fun showDemoPremiumCheckout() {
        val d = com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.premium))
            .setMessage(getString(R.string.demo_checkout_msg))
            .setCancelable(true)
            .setNegativeButton(getString(R.string.cancel)) { _, _ ->
                Toast.makeText(this, getString(R.string.checkout_cancelled), Toast.LENGTH_SHORT).show()
            }
        val view = layoutInflater.inflate(R.layout.dialog_demo_premium, null)
        val count = view.findViewById<android.widget.TextView>(R.id.demoCount)
        d.setView(view)
        val alert = d.show()
        var sec = 10
        count.text = "$sec s"
        val timer = java.util.Timer()
        timer.schedule(object : java.util.TimerTask() {
            override fun run() {
                runOnUiThread {
                    sec--
                    if (sec <= 0) {
                        timer.cancel()
                        alert.dismiss()
                        activateDemoPremium()
                    } else {
                        count.text = "$sec s"
                    }
                }
            }
        }, 0, 1000)
        // Tap outside to stop and unlock immediately.
        alert.setOnShowListener {
            alert.window?.addFlags(android.view.WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH)
            val cp = alert.window?.decorView
            cp?.setOnTouchListener { _, event: android.view.MotionEvent ->
                if (event.action == android.view.MotionEvent.ACTION_OUTSIDE) {
                    timer.cancel()
                    alert.dismiss()
                    activateDemoPremium()
                    true
                } else false
            }
        }
    }

    private fun activateDemoPremium() {
        app.license.activateDemo()
        runOnUiThread {
            Toast.makeText(this, getString(R.string.demo_premium_unlocked), Toast.LENGTH_LONG).show()
            refresh()
        }
    }

    /** Google Play reviewer demo: marble race before allowing cancellation. */
    private fun launchMarbleRace() {
        val d = com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.stop_premium_q))
            .setMessage(getString(R.string.demo_marble_msg))
            .setCancelable(false)
        var alert: android.app.Dialog? = null
        val canvasView = object : android.view.View(this) {
            var mx = 200f
            var my = 60f
            var vx = 0f
            var finished = false
            var failed = false
            val track: List<Pair<Float, Float>> = (0 until 20).map { i ->
                Pair(60f + Math.sin(i * 0.9).toFloat() * 110f, 60f + i * 22f)
            }
            val last = track.last()

            val paintTrack = android.graphics.Paint().apply {
                color = android.graphics.Color.parseColor("#333333")
                strokeWidth = 6f
                style = android.graphics.Paint.Style.STROKE
                strokeCap = android.graphics.Paint.Cap.ROUND
            }
            val paintFinish = android.graphics.Paint().apply {
                color = android.graphics.Color.parseColor("#00C853")
                strokeWidth = 4f
                style = android.graphics.Paint.Style.STROKE
                strokeCap = android.graphics.Paint.Cap.ROUND
            }
            val paintMarble = android.graphics.Paint().apply {
                color = android.graphics.Color.parseColor("#4FC3F7")
                style = android.graphics.Paint.Style.FILL
            }
            val paintHint = android.graphics.Paint().apply {
                color = android.graphics.Color.parseColor("#999999")
                textSize = 14f
            }

            override fun onDraw(c: android.graphics.Canvas) {
                c.drawColor(android.graphics.Color.parseColor("#0A0A0A"))
                // track
                val p = android.graphics.Path()
                p.moveTo(track[0].first, track[0].second)
                for (i in 1 until track.size) p.lineTo(track[i].first, track[i].second)
                c.drawPath(p, paintTrack)
                // finish line
                c.drawLine(last.first - 16, last.second, last.first + 16, last.second, paintFinish)
                c.drawText("FINISH", last.first - 24, last.second - 10, paintHint)
                // marble
                c.drawCircle(mx, my, 8f, paintMarble)
                c.drawCircle(mx - 2f, my - 2f, 3f, android.graphics.Paint().apply { color = android.graphics.Color.WHITE })
                // hint
                c.drawText("Left/Right to balance", 20f, height - 20f, paintHint)
                if (finished) {
                    c.drawText("CANCELLED", width / 2f - 60f, height / 2f, paintMarble)
                } else if (failed) {
                    c.drawText("FELL OFF", width / 2f - 60f, height / 2f, android.graphics.Paint().apply { color = android.graphics.Color.parseColor("#F44336") })
                }
            }

            fun step() {
                if (finished || failed) { postInvalidate(); return }
                vx *= 0.85f // friction
                my += 1.0f  // gravity
                // where the track runs at this height
                var tx = track[0].first
                for (i in 0 until track.size - 1) {
                    val a = track[i]; val b = track[i + 1]
                    if (my >= a.second - 6 && my <= b.second + 6) {
                        val t = ((my - a.second) / (b.second - a.second)).coerceIn(0f, 1f)
                        tx = a.first + (b.first - a.first) * t
                        break
                    }
                }
                if (my >= last.second) tx = last.first
                // Keys shove the marble, physics pulls it back to the line — so the
                // reviewer can always finish the race without getting stuck.
                vx += ((tx - mx) * 0.12f).coerceIn(-6f, 6f)
                mx += vx
                if (mx < 10f) { mx = 10f; vx = 0f }
                val onLine = Math.abs(mx - tx) < 40f
                if (my >= last.second && onLine) finished = true
                else if (my > height) failed = true
                postInvalidate()
                if (!finished && !failed) postDelayed({ step() }, 16)
                else if (finished) postDelayed({ alert?.dismiss(); cancelDemoPremium() }, 700)
                else postDelayed({ alert?.dismiss(); Toast.makeText(this@PremiumActivity, getString(R.string.demo_marble_failed), Toast.LENGTH_SHORT).show() }, 700)
            }

            override fun dispatchKeyEvent(e: android.view.KeyEvent): Boolean {
                if (!finished && !failed && e.action == android.view.KeyEvent.ACTION_DOWN) {
                    when (e.keyCode) {
                        android.view.KeyEvent.KEYCODE_DPAD_LEFT, android.view.KeyEvent.KEYCODE_A -> vx -= 1.4f
                        android.view.KeyEvent.KEYCODE_DPAD_RIGHT, android.view.KeyEvent.KEYCODE_D -> vx += 1.4f
                    }
                }
                return true
            }
        }
        canvasView.isFocusable = true
        canvasView.isFocusableInTouchMode = true
        canvasView.requestFocus()
        canvasView.minimumWidth = 360
        canvasView.minimumHeight = 620
        d.setView(canvasView)
        alert = d.show()
        canvasView.postDelayed({ canvasView.step() }, 100)
    }

    private fun cancelDemoPremium() {
        val err = app.license.cancel()
        runOnUiThread {
            if (err == null) {
                Toast.makeText(this, getString(R.string.demo_cancelled), Toast.LENGTH_LONG).show()
                refresh()
            } else {
                Toast.makeText(this, err, Toast.LENGTH_LONG).show()
            }
        }
    }
}
