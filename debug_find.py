import os
os.chdir("/home/tejas/Projects/antersurf")

with open("src/browser.html", "rb") as f:
    content = f.read()

idx = content.find(b"What's in Premium</div><div class=\"desc\">\\u2022 Custom themes")
print("Found at:", idx)
if idx >= 0:
    print(repr(content[idx:idx+500]))