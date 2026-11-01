with open("/etc/nginx/sites-enabled/kastrava.in", "r") as f:
    s = f.read()

old = """    location ^~ /dl/ {
        alias /home/ubuntu/kastrava/downloads/;
        autoindex off;
        add_header Cache-Control 'no-store' always;
        expires off;
    }
    location ~ /\.(?!well-known) { deny all; }"""

new = """    location ^~ /dl/ {
        alias /home/ubuntu/kastrava/downloads/;
        autoindex off;
        add_header Cache-Control 'no-store' always;
        expires off;
    }
    location /dist/ {
        alias /home/ubuntu/kastrava/dist/;
        try_files $uri $uri/ =404;
    }
    location ~ /\.(?!well-known) { deny all; }"""

if old in s:
    s = s.replace(old, new)
    with open("/etc/nginx/sites-enabled/kastrava.in", "w") as f:
        f.write(s)
    print("Done")
else:
    print("NOT FOUND")