import os
os.chdir("/home/tejas/Projects/antersurf")

with open("src/browser.html", "rb") as f:
    content = f.read()

old = b'What\'s in Premium</div><div class=\\"desc\\">\\u2022 Custom themes (20+ dark/light + custom)<br>\\u2022 Custom cursor arrow + Cursor FX (splash, blob, glass, particles, trails, ribbons)<br>\\u2022 Banking security guard (auto-hardens banking sites)<br>\\u2022 Workspaces (tab groups)<br>\\u2022 PiP+audio (audio-only Picture-in-Picture)<br>\\u2022 Tab groups & Split presets<br>\\u2022 Anti-fingerprint protection<br>\\u2022 Local translate<br>\\u2022 Screenshot annotator<br>\\u2022 Local AI \xe2\x80\x94 bring your own API key or connect Ollama</div></div>";\n$\n    if(isPremium()){\n      h+="<h4 style=\\"margin:16px 0 8px\\">Local AI (Premium)</h4>";'

new = b'What\'s in Premium</div><div class=\\"desc\\">\\u2022 Custom themes (20+ dark/light + custom)<br>\\u2022 Custom cursor arrow + Cursor FX (splash, blob, glass, particles, trails, ribbons)<br>\\u2022 Banking security guard (auto-hardens banking sites)<br>\\u2022 Workspaces (tab groups)<br>\\u2022 PiP+audio (audio-only Picture-in-Picture)<br>\\u2022 Tab groups & Split presets<br>\\u2022 Anti-fingerprint protection<br>\\u2022 Local translate<br>\\u2022 Screenshot annotator<br>\\u2022 Local AI \xe2\x80\x94 bring your own API key or connect Ollama</div></div>";\n$\n    // Referral Program section\n    if(isPremium()){\n      h+="<div class=\\"sg\\" style=\\"margin-top:16px\\"><div class=\\"lbl\\">Referral Program</div><div class=\\"desc\\">Share your link. When someone signs up and makes their first purchase, they get <b>30 days Premium free</b> and you earn <b>20% cashback</b>.</div><div id=\\"referral-out\\" style=\\"margin-top:10px\\"><button class=\\"btn-sm btn-accent\\" id=\\"s-referral-load\\">Load referral info</button></div></div>";\n    if(isPremium()){\n      h+="<h4 style=\\"margin:16px 0 8px\\">Local AI (Premium)</h4>";'

if old in content:
    content = content.replace(old, new)
    with open("src/browser.html", "wb") as f:
        f.write(content)
    print("Done!")
else:
    print("NOT FOUND")