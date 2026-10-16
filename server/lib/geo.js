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
  TW: 'TWD', TR: 'TRY',
  RU: 'RUB', BY: 'BYN', KZ: 'KZT', AM: 'AMD', AZ: 'AZN', KG: 'KGS',
  MD: 'MDL', TJ: 'TJS', UZ: 'UZS'
}

// Zero-decimal currencies (no minor units on PayPal).
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD'])

// YooKassa is the only rail that works for Russian buyers: PayPal
// exited Russia, Razorpay is India-only. RU -> yookassa/RUB.
const YOOKASSA_COUNTRIES = new Set(['RU', 'BY', 'KZ', 'AM', 'AZ', 'KG', 'MD', 'TJ', 'UZ'])
function providerFor(country) {
  if (country === 'IN') return 'razorpay'
  if (YOOKASSA_COUNTRIES.has(country)) return 'yookassa'
  return 'paypal'
}

function currencyFor(country) {
  return COUNTRY_CURRENCY[country] || 'USD'
}

function isPrivateIp(ip) {
  if (!ip) return true
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true
  if (/^(fc|fd)/i.test(ip)) return true
  return false
}

// IP -> country cache (24h) so lookups never rate-limit checkout.
const ipCache = new Map()

async function lookupIp(ip) {
  const hit = ipCache.get(ip)
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.cc
  let cc = null
  try {
    const r = await fetch('http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=countryCode,status', {
      signal: AbortSignal.timeout(5000)
    })
    const j = await r.json().catch(() => null)
    if (j && j.status === 'success' && /^[A-Z]{2}$/.test(j.countryCode || '')) cc = j.countryCode
  } catch {}
  if (!cc) {
    try {
      const r2 = await fetch('https://ipwho.is/' + encodeURIComponent(ip) + '?fields=country_code', {
        signal: AbortSignal.timeout(5000)
      })
      const j2 = await r2.json().catch(() => null)
      if (j2 && j2.success !== false && /^[A-Z]{2}$/.test(j2.country_code || '')) cc = j2.country_code
    } catch {}
  }
  if (cc) {
    ipCache.set(ip, { cc, at: Date.now() })
    if (ipCache.size > 20000) ipCache.clear()
  }
  return cc
}

async function countryFromIp(ip) {
  if (isPrivateIp(ip)) return null
  return lookupIp(ip)
}

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
  if (fwd) return fwd
  return (req.socket && req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}

async function resolveGeo(req, bodyTz) {
  // IP location only: the country comes from our own lookup of the
  // visitor's IP (first entry of X-Forwarded-For). The Cloudflare
  // CF-IPCountry header is ignored by design.
  const ip = clientIp(req)
  let country = await countryFromIp(ip)
  let via = 'ip'
  if (!country) {
    // Lookup failed (private/local IP, provider down): device timezone
    // as a last resort, otherwise default to US/PayPal.
    const tz = String(bodyTz || '').trim()
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') {
      country = 'IN'
      via = 'tz'
    } else {
      country = 'US'
      via = 'default'
    }
  }
  const currency = currencyFor(country)
  return { country, currency, provider: providerFor(country), via, ip: ip || null }
}

async function clientIpForLog(req) {
  // Masked for privacy: first 2 octets / first IPv6 hextets only.
  const ip = clientIp(req)
  if (!ip) return null
  if (ip.includes('.')) return ip.split('.').slice(0, 2).join('.') + '.x.x'
  return ip.split(':').slice(0, 3).join(':') + '::x'
}

module.exports = { resolveGeo, currencyFor, providerFor, ZERO_DECIMAL, clientIpForLog, clientIp }

