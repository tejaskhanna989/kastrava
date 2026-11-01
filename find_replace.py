import os
os.chdir("/home/tejas/Projects/antersurf")

with open("src/browser.html", "rb") as f:
    content = f.read()

# Find the exact location
search_bytes = b"What's in Premium</div><div class=\"desc\">\\u2022 Custom themes"
idx = content.find(search_bytes)
print("Found at:", idx)
if idx >= 0:
    # Print 500 bytes from there
    print(content[idx:idx+600])