import re

with open('server/server.js', 'r') as f:
    code = f.read()

old = """const PLANS = {
  legacy: { usd: 2.8, inr: 248, days: 34, label: 'Legacy 34-day' },
  monthly: { usd: 10, inr: 799, rub: 4490, days: 30, label: 'Monthly', interval: 'monthly' },
  daily: { usd: 4.99, inr: 49, rub: 449, days: 1, label: 'Daily', interval: 'daily' }
}"""

new = """const PLANS = {
  legacy: { usd: 2.8, inr: 248, days: 34, label: 'Legacy 34-day' },
  monthly: { usd: 10, usdt: 10, inr: 799, rub: 4490, days: 30, label: 'Monthly', interval: 'monthly' },
  daily: { usd: 4.99, usdt: 4.99, inr: 49, rub: 449, days: 1, label: 'Daily', interval: 'daily' }
}"""

if target in code:
    code = code.replace(target, new)
    with open('server/server.js', 'w') as f:
        f.write(code)
    print("Successfully updated pricing")
else:
    print("Target not found")
