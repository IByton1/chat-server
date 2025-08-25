#!/bin/bash
set -e

# === Konfiguration ===
PI_USER="server"                             # Benutzername auf dem Pi
PI_HOST="server.local"                       # Hostname oder IP (für SSH-Verbindung, intern im LAN!)
PI_PATH="~/server"                          # Zielordner auf dem Pi
REPO_URL="https://github.com/IByton1/chat-server.git"

echo "🚀 Starte Installation für $PI_USER@$PI_HOST ..."

# === SSH ControlMaster starten (fragt 1× nach Passwort) ===
ssh -M -S /tmp/ssh_socket -fnNT $PI_USER@$PI_HOST

# === Schritt 1: Abhängigkeiten installieren ===
echo "📦 Installiere Grundpakete (git, curl, build-essential, python3)..."
ssh -S /tmp/ssh_socket $PI_USER@$PI_HOST "sudo apt update && sudo apt install -y git curl build-essential python3 ufw"

# === Schritt 2: Repo klonen ===
echo "📂 Klone Repository nach $PI_PATH ..."
ssh -S /tmp/ssh_socket $PI_USER@$PI_HOST "rm -rf $PI_PATH && git clone $REPO_URL $PI_PATH"

# === Schritt 3: Node.js installieren ===
echo "⬇️  Installiere Node.js + npm ..."
ssh -S /tmp/ssh_socket $PI_USER@$PI_HOST "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"

# === Schritt 4: npm install im Projekt ===
echo "⚙️  Installiere npm-Abhängigkeiten ..."
ssh -S /tmp/ssh_socket $PI_USER@$PI_HOST "cd $PI_PATH && npm install"

# === Schritt 5: Öffentliche IP vom Pi holen ===
CURRENT_IP=$(curl -s https://api.ipify.org)
echo "🌍 Öffentliche IP erkannt: $CURRENT_IP"

# === Schritt 6: SSL-Config schreiben ===
echo "🔑 Erzeuge ssl.cnf ..."
ssh -S /tmp/ssh_socket $PI_USER@$PI_HOST "cat > $PI_PATH/ssl.cnf <<EOF
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
EOF"

# === Schritt 7: Zertifikate erzeugen ===
echo "📜 Erzeuge SSL-Zertifikate ..."
ssh -S /tmp/ssh_socket $PI_USER@$PI_HOST "cd $PI_PATH && mkdir -p ssl && openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout ssl/private.key -out ssl/certificate.crt -config ssl.cnf"

# === Schritt 8: Zertifikat auf PC kopieren ===
scp -o ControlPath=/tmp/ssh_socket $PI_USER@$PI_HOST:$PI_PATH/ssl/certificate.crt ./certificate.crt
echo "✅ Zertifikat auf lokalen Rechner kopiert -> ./certificate.crt"

# === Schritt 9: Firewall konfigurieren ===
echo "🔓 Öffne Ports 3000 und 4000 ..."
ssh -S /tmp/ssh_socket $PI_USER@$PI_HOST "sudo ufw allow 3000/tcp && sudo ufw allow 4000/tcp && sudo ufw reload"

# === Schritt 10: pm2 installieren & Autostart einrichten ===
echo "🌀 Installiere pm2 und richte Autostart ein ..."
ssh -S /tmp/ssh_socket $PI_USER@$PI_HOST "sudo npm install -g pm2 && cd $PI_PATH && pm2 start server.js --name server && pm2 save && pm2 startup systemd -u $PI_USER --hp /home/$PI_USER"

# === SSH-Verbindung schließen ===
ssh -S /tmp/ssh_socket -O exit $PI_USER@$PI_HOST

echo "🎉 Installation abgeschlossen!"
echo "➡️  Dein Server läuft nun auf: https://$CURRENT_IP:3000"
