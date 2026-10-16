// Manual-crypto auto-verify (TRON/USDT-TRC20) via TronGrid.
// No processor, no KYC, no entity: the buyer pays OUR address on-chain,
// pastes the TX hash, and we confirm (to-address, USDT contract, amount,
// unused) before issuing the key. Needs TRONGRID_API_KEY (free signup).
const OUR_ADDR = 'TPmPvoW7LBDvzWttS8tu7q9MCPzr354xjQ'
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const USDT_DECIMALS = 6

// Expected USDT per plan (whole units).
const PLAN_USDT = { monthly: 49, daily: 4.99 }

function apiKey() {
  return process.env.TRONGRID_API_KEY || ''
}

async function tg(path) {
  const res = await fetch('https://api.trongrid.io' + path, {
    headers: { 'TRON-PRO-API-KEY': apiKey(), Accept: 'application/json' }
  })
  if (!res.ok) throw new Error('trongrid_http_' + res.status)
  return res.json()
}

// Find our inbound USDT transfer with this txid. Returns micro-USDT or 0.
async function inboundMicroUsdt(txid) {
  const j = await tg('/v1/accounts/' + OUR_ADDR + '/transactions/trc20'
    + '?only_to=true&limit=200&contract_address=' + USDT_CONTRACT)
  const list = (j && j.data) || []
  for (const t of list) {
    if (String(t.transaction_id || '').toLowerCase() !== String(txid).toLowerCase()) continue
    if (String(t.to || '') !== OUR_ADDR) continue
    if (String((t.token_info || {}).address || '') !== USDT_CONTRACT) continue
    return Math.floor(Number(t.value || 0))
  }
  return 0
}

async function verifyTx(txid, planName) {
  const clean = String(txid || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) return { ok: false, error: 'bad_txid' }
  if (!apiKey()) return { ok: false, error: 'no_api_key' }
  const want = PLAN_USDT[planName] || PLAN_USDT.monthly
  let got = 0
  try {
    got = await inboundMicroUsdt(clean)
  } catch (e) {
    return { ok: false, error: 'chain_unreachable' }
  }
  if (!got) return { ok: false, error: 'tx_not_found' }
  if (got < Math.round(want * 1e6) - 1000) return { ok: false, error: 'underpaid', got, want }
  return { ok: true, microUsdt: got }
}

module.exports = { OUR_ADDR, USDT_CONTRACT, PLAN_USDT, verifyTx }
