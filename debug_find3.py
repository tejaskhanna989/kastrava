import os
os.chdir("/home/tejas/Projects/antersurf")

with open("src/browser.html", "rb") as f:
    content = f.read()

idx = content.find(b"What's in Premium")
print("Found at:", idx)
if idx >= 0:
    end_idx = content.find(b'if(isPremium()){', idx)
    if end_idx >= 0:
        print("End at:", end_idx)
        print(repr(content[idx:end_idx+50]))