#!/bin/bash

# === Variablen anpassen ===
PI_USER="server"                       # Benutzername auf dem Pi
PI_HOST="server.local"              # IP-Adresse des Pi
PI_PATH="/home/$PI_USER/server"        # Zielordner auf dem Pi
REPO_URL="https://github.com/dein/repo.git"   # Dein Repo

echo "🚀 Starte Installation auf $PI_HOST ..."

# === Schritt 1: Ordner anlegen & Repo klonen ===
ssh $PI_USER@$PI_HOST "rm -rf $PI_PATH && mkdir -p $PI_PATH && git clone $REPO_URL $PI_PATH"

# === Schritt 2: Node.js installieren (NodeSource) ===
ssh $PI_USER@$PI_HOST "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"

# === Schritt 3: npm install ===
ssh $PI_USER@$PI_HOST "cd $PI_PATH && npm install"

# === Schritt 4: IP vom Pi holen ===
CURRENT_IP=$(ssh $PI_USER@$PI_HOST "hostname -I | awk '{print \$1}'")
echo "📡 Pi-IP erkannt: $CURRENT_IP"

# === Schritt 5: SSL-Config schreiben ===
ssh $PI_USER@$PI_HOST "cat > $PI_PATH/ssl.cnf <<EOF
[ req ]
default_bits       = 2048
distinguished_name = req_distinguished_name
x509_extensions    = v3_req
prompt             = no

[ req_distinguished_name ]
C  = DE
ST = Thueringen
L  = Jena
O  = Innovora
CN = $CURRENT_IP

[ v3_req ]
subjectAltName = @alt_names
basicConstraints = CA:false

[ alt_names ]
IP.1 = $CURRENT_IP
DNS.1 = server.local
EOF"

# === Schritt 6: Zertifikate erzeugen ===
ssh $PI_USER@$PI_HOST "cd $PI_PATH && mkdir -p ssl && openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout ssl/private.key -out ssl/certificate.crt -config ssl.cnf"

# === Schritt 7: Zertifikat auf PC ziehen ===
scp $PI_USER@$PI_HOST:$PI_PATH/ssl/certificate.crt ./certificate.crt
echo "✅ Zertifikat auf lokalen Rechner kopiert -> ./certificate.crt"

# === Schritt 8: pm2 installieren & Autostart ===
ssh $PI_USER@$PI_HOST "sudo npm install -g pm2 && cd $PI_PATH && pm2 start server.js --name server && pm2 save && pm2 startup systemd -u $PI_USER --hp /home/$PI_USER"

echo "🎉 Installation abgeschlossen!"
