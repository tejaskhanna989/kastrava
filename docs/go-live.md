# Kastrava — Going LIVE with Razorpay

Everything is verified on **test** keys right now. Switching to live takes one
`.env` change plus dashboard confirmation. This runbook has no secrets in it —
the real keys live only in `~/kastrava/server/.env` on the VPS, never in the
repo.

Target state after this runbook:

- `RAZORPAY_KEY_ID=rzp_live_…` / `RAZORPAY_KEY_SECRET=…` in `server/.env`
- Existing webhook delivers `payment.captured` (account-wide; see §2)
- `curl https://nexufog.pp.ua/api/health` → `{"dev":false,"price":248,"period_days":34,"grace_days":3,…}`
- A real purchase (₹670/30d monthly or ₹190/1d daily) mints a license, activation binds it to the first
  machine, a second ₹248 payment with the same machine code **extends the same
  key**.

---

## 0. Pre-flight

```bash
curl -s https://nexufog.pp.ua/api/health
# expect 200, "dev":false, price 248, period_days 34, grace_days 3
```

`dev:false` only means "keys are loaded" — it does **not** prove live. Confirm
the prefix:

```bash
ssh ubuntu@161.118.187.121 'grep "^RAZORPAY_KEY_ID" ~/kastrava/server/.env'
# rzp_test_…  -> not live yet
# rzp_live_…  -> already live
```

Back up the current env:

```bash
ssh ubuntu@161.118.187.121 'cp ~/kastrava/server/.env ~/kastrava/server/.env.bak-$(date +%F)-test'
```

## 1. Generate live keys

dashboard.razorpay.com → **Settings → API Keys → Generate live key**.

You get two values:

- **Key ID**: `rzp_live_…`
- **Key Secret**: shown once; copy it somewhere safe now.

## 2. Webhook — confirm, don't re-create

Razorpay webhooks are **account-wide**: the existing webhook
(`TeYttVf3oxa35W`, URL `https://nexufog.pp.ua/api/webhook`, event
`payment.captured`) already fires for **both** test and live payments, using
the same secret. So live needs **no new webhook**.

What to check in the dashboard (Settings → Webhooks → the configured webhook):

- Webhook URL = `https://nexufog.pp.ua/api/webhook`
- Event **`payment.captured`** is enabled (the server ignores every other
  event, so nothing else is needed)
- Status is **Active** (not paused)

Auto-renew is discontinued: untick every `subscription.*` event if still
enabled — only `payment.captured` is processed.

If the webhook secret is ever regenerated in the dashboard, it must be copied
into `RAZORPAY_WEBHOOK_SECRET` in `server/.env` and the service restarted.

## 3. Swap the keys (the entire change)

```bash
ssh ubuntu@161.118.187.121
cd ~/kastrava/server
nano .env
```

Edit exactly three lines (paste, don't rely on history-reading commands):

```ini
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXX
RAZORPAY_WEBHOOK_SECRET=<unchanged unless you regenerated it>
```

Then:

```bash
sudo systemctl restart kastrava-license
sudo systemctl status kastrava-license      # active (running)
```

`KAS_HOST=https://nexufog.pp.ua` is already correct — leave it alone.

## 4. Verify

1. **Health**
   ```bash
   curl -s https://nexufog.pp.ua/api/health
   # 200, dev:false, price:248, period_days:34, grace_days:3
   ```

2. **Live key in play** — smoke order (do NOT pay it):
   ```bash
   curl -s -X POST https://nexufog.pp.ua/api/order \
     -H 'content-type: application/json' \
     -d '{"machine_id":"KAS2-SMOKE-LIVE-0001"}'
   # 200 with "order_id":"order_…" and "key_id":"rzp_live_…"  <- live confirmed
   ```
   Unpaid orders are harmless; never complete a smoke order.

3. **Logs while paying** (run before the real purchase):
   ```bash
   ssh ubuntu@161.118.187.121
   sudo journalctl -u kastrava-license -f
   ```
   You should see `[webhook] payment.captured <order_id> new key …` for a
   first purchase and `… renewal …` for a renewal.

4. **Real purchase — the decisive test** (do it when you're happy to take real
   ₹248):
   - https://kastrava.pp.ua → **Premium** → pay ₹248 (card/UPI/netbanking).
   - Checkout callback settles → key shown (plan days + 3 grace).
   - **Renewal**: open Premium again from the app (brings your machine code,
     locked read-only) → pay again → **same key**, expiry extends; the app
     picks it up on next startup/re-activate.
   - **Machine lock**: the key must refuse to activate on a second machine
     (`machine_mismatch`).
     `kastrava_101.4.2_amd64.deb`.

5. **Optional store cleanup** — if you want zero test artifacts mixed with
   real orders, wipe the store *before* real sales (this also deletes the
   `KAS-7967-…` test key used in earlier E2E runs):
   ```bash
   ssh ubuntu@161.118.187.121
   rm -f ~/kastrava/server/data/db.json
   sudo systemctl restart kastrava-license
   ```

## 5. Rollback

```bash
ssh ubuntu@161.118.187.121
cp ~/kastrava/server/.env.bak-YYYY-MM-DD-test ~/kastrava/server/.env
sudo systemctl restart kastrava-license
```

The test-mode webhook behaviour is unchanged (server ignores foreign events),
so reverting is safe at any time.

## 6. Not required, noted for later

- **Optional hardening backlog** (offered, not requested): record
  `payment.failed` orders + an order-status recovery endpoint, so an edge-case
  payment that Razorpay marks failed after capture can be reconciled.
  GET.
- electron-builder advisory: `desktopName` not set in package.json (cosmetic
  WM_CLASS/window association) — optional one-liner in the next build.