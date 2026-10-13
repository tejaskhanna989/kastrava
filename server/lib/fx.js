// INR -> buyer-currency conversion with a cached rate table.
// Live rates from open.er-api.com (no key), refreshed every 12h;
// static fallback keeps checkout alive offline.

let cache = { at: 0, rates: null }

const FALLBACK_PER_INR = {
  USD: 0.0111, EUR: 0.0102, GBP: 0.0083, CHF: 0.0098, SEK: 0.117,
  NOK: 0.124, DKK: 0.076, PLN: 0.044, CZK: 0.238, HUF: 3.95,
  RON: 0.0505, BGN: 0.020, CAD: 0.0153, AUD: 0.0169, NZD: 0.0187,
  SGD: 0.0143, HKD: 0.0866, JPY: 1.68, AED: 0.0408, SAR: 0.0416,
  QAR: 0.0404, ILS: 0.0368, ZAR: 0.196, BRL: 0.060, MXN: 0.207,
  PHP: 0.652, THB: 0.359, MYR: 0.0467, IDR: 184.5, KRW: 15.5,
  TWD: 0.344, TRY: 0.46, INR: 1
}

async function getRates() {
  if (cache.rates && Date.now() - cache.at < 12 * 3600 * 1000) return cache.rates
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/INR', { signal: AbortSignal.timeout(8000) })
    const j = await r.json().catch(() => null)
    if (j && j.result === 'ok' && j.rates) {
      cache = { at: Date.now(), rates: j.rates }
      return j.rates
    }
  } catch {}
  return cache.rates || FALLBACK_PER_INR
}

// INR paise -> { amount: "7.00", currency } formatted for PayPal (string).
async function fromInrPaise(paise, currency) {
  const rates = await getRates()
  const perInr = Number(rates[currency]) || FALLBACK_PER_INR[currency] || FALLBACK_PER_INR.USD
  const major = (paise / 100) * perInr
  if (currency === 'JPY' || currency === 'HUF' || currency === 'TWD') {
    return { amount: String(Math.max(1, Math.round(major))), currency }
  }
  return { amount: Math.max(0.5, major).toFixed(2), currency }
}

function convertPaise(paise, currency, rates) {
  const perInr = Number((rates || {})[currency]) || FALLBACK_PER_INR[currency] || FALLBACK_PER_INR.USD
  const major = (paise / 100) * perInr
  if (currency === 'JPY' || currency === 'HUF' || currency === 'TWD') {
    return { amount: String(Math.max(1, Math.round(major))), currency }
  }
  return { amount: Math.max(0.5, major).toFixed(2), currency }
}

async function getUsdRates() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) })
    const j = await r.json().catch(() => null)
    if (j && j.result === 'ok' && j.rates) return j.rates
  } catch {}
  const perUsd = FALLBACK_PER_INR.USD
  const out = {}
  for (const k in FALLBACK_PER_INR) out[k] = FALLBACK_PER_INR[k] / perUsd
  return out
}

// USD dollars -> { amount, currency } for PayPal.
async function fromUsd(usd, currency) {
  if (currency === 'INR') return { amount: String(usd), currency: 'INR' }
  const rates = await getUsdRates()
  const perUsd = Number(rates[currency]) || 1
  const major = usd * perUsd
  if (currency === 'JPY' || currency === 'HUF' || currency === 'TWD') {
    return { amount: String(Math.max(1, Math.round(major))), currency }
  }
  return { amount: Math.max(0.5, major).toFixed(2), currency }
}

module.exports = { fromInrPaise, getRates, convertPaise, fromUsd }
