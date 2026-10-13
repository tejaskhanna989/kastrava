// Geo + currency resolution for dual-rail payments.
// India -> Razorpay/INR, everywhere else -> PayPal/local currency.
// Country comes from Cloudflare's CF-IPCountry header; direct-IP fallback
// uses a cached ip-api.com lookup (last resort, never blocks checkout).

// PayPal-supported currencies per billing country. Default USD.
const COUNTRY_CURRENCY = {
  IN: 'INR',
  US: 'USD', GB: 'GBP',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR',
  BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR',
  LV: 'EUR', LT: 'EUR', LU: 'EUR', MT: 'EUR', CY: 'EUR', HR: 'EUR',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK',
  HU: 'HUF', RO: 'RON', BG: 'BGN',
  CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', JP: 'JPY',
  AE: 'AED', SA: 'SAR', QA: 'QAR', IL: 'ILS', ZA: 'ZAR', BR: 'BRL',
  MX: 'MXN', PH: 'PHP', TH: 'THB', MY: 'MYR', ID: 'IDR', KR: 'KRW',
  TW: 'TWD', TR: 'TRY'
}

// Zero-decimal currencies (no minor units on PayPal).
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD'])

function providerFor(country) {
  return country === 'IN' ? 'razorpay' : 'paypal'
}

function currencyFor(country) {
  return COUNTRY_CURRENCY[country] || 'USD'
}

async function countryFromIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null
  }
  try {
    const r = await fetch('http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=countryCode,status', {
      signal: AbortSignal.timeout(6000)
    })
    const j = await r.json().catch(() => null)
    if (j && j.status === 'success' && /^[A-Z]{2}$/.test(j.countryCode || '')) return j.countryCode
  } catch {}
  return null
}

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
  if (fwd) return fwd
  return (req.socket && req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}

async function resolveGeo(req, bodyTz) {
  let via = 'cf'
  let country = ((req.headers['cf-ipcountry'] || '').toString().toUpperCase() || null)
  if (country === 'XX' || country === 'T1') country = null
  if (!country || !/^[A-Z]{2}$/.test(country)) {
    via = 'ip'
    country = (await countryFromIp(clientIp(req))) || 'US'
  }
  // VPN safety net: a device set to IST is treated as India even when the
  // IP egresses elsewhere (PayPal can't take domestic Indian payments, so
  // Razorpay is the only rail that works for these buyers).
  const tz = String(bodyTz || '').trim()
  if ((tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') && country !== 'IN') {
    country = 'IN'
    via = 'tz'
  }
  const currency = currencyFor(country)
  return { country, currency, provider: providerFor(country), via }
}

module.exports = { resolveGeo, currencyFor, providerFor, ZERO_DECIMAL }
