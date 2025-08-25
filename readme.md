# Chat-Server auf dem Raspberry Pi (Pi 5) – README

Einrichtung des Servers für die IOS App: https://github.com/IByton1/AppleChatApp

Diese Anleitung zeigt zwei Wege:

1. **Automatischer Installer** (empfohlen): führt alle Schritte per SSH aus.
2. **Manuelle Installation**: Schritt-für-Schritt, getrennt für **lokales LAN** und **öffentliches Internet**.

Am Ende findest du eine **PM2‑Befehlsübersicht** und **Troubleshooting**.

---

## Voraussetzungen

* Raspberry Pi OS Lite (64‑bit) auf dem Pi 5
* Benutzer (z. B. `server`) mit SSH-Zugang
* PC/Laptop mit `ssh` und `scp` (unter Windows: WSL oder Git Bash)
* Repository: `https://github.com/IByton1/chat-server.git`

> **Hinweis zu Hostname:** Wenn `server.local` unter Windows nicht auflösbar ist, nutze die **IP** des Pi (z. B. `192.168.178.115`).

---

## 1) Schnellstart mit Installer‑Skript

### 1.1 Skript speichern

Erstelle auf deinem Laptop die Datei `install_pi.sh` (Inhalt: deine aktuelle, letzte Skriptversion).

### 1.2 Ausführbar machen

```bash
chmod +x install_pi.sh
```

### 1.3 Ausführen

```bash
./install_pi.sh
```

Der Installer:

* installiert benötigte Pakete (git, curl, build‑essential, python3)
* installiert Node.js (NodeSource 22.x)
* klont das Repo nach `~/server`
* führt `npm install` aus
* erzeugt **SSL** (self‑signed) mit **öffentlicher IP**
* öffnet per **ufw** die Ports **3000** und **4000**
* (optional) startet `server.js` mit **pm2** und aktiviert Autostart

### 1.4 Authentifizierung – 2 Optionen

* **SSH ControlMaster (empfohlen):** Skript fragt **einmal** nach Passwort, nutzt die Session für alle Befehle.
* **sshpass (vollautomatisch, unsicherer):** Passwort als Variable im Skript. Nur verwenden, wenn du das Risiko kennst.

> **Beste Praxis:** Richte **SSH‑Keys** ein (`ssh-keygen` + `ssh-copy-id`), dann braucht der Installer kein Passwort mehr.

---

## 2) Manuelle Installation

### 2.1 Gemeinsam: Basis & Code

Auf dem Pi einloggen und ausführen:

```bash
sudo apt update && sudo apt install -y git curl build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Projektordner neu anlegen und Repo klonen\ nrm -rf ~/server && git clone https://github.com/IByton1/chat-server.git ~/server
cd ~/server
npm install
```

### 2.2 SSL – self‑signed Zertifikat

Erzeuge `ssl.cnf` und Zertifikate.

**Variante A – Lokal (LAN)**

* Nutze die **interne IP** des Pi (z. B. `192.168.178.115`).

```bash
cat > ~/server/ssl.cnf <<'EOF'
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
CN = 192.168.178.115

[ v3_req ]
subjectAltName = @alt_names
basicConstraints = CA:false

[ alt_names ]
IP.1 = 192.168.178.115
DNS.1 = server.local
EOF

mkdir -p ~/server/ssl
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout ~/server/ssl/private.key \
  -out   ~/server/ssl/certificate.crt \
  -config ~/server/ssl.cnf
```

**Variante B – Öffentlich (WAN)**

* Nutze die **öffentliche IP** deines Anschlusses:

```bash
PUBIP=$(curl -s https://api.ipify.org)
cat > ~/server/ssl.cnf <<EOF
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
CN = $PUBIP

[ v3_req ]
subjectAltName = @alt_names
basicConstraints = CA:false

[ alt_names ]
IP.1 = $PUBIP
EOF

mkdir -p ~/server/ssl
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout ~/server/ssl/private.key \
  -out   ~/server/ssl/certificate.crt \
  -config ~/server/ssl.cnf
```

> **Browser‑Warnung ist normal** (self‑signed). Für echte Domains nutze später **Let’s Encrypt** (certbot/nginx‑Proxy).

### 2.3 Firewall & Router

**Pi‑Firewall (ufw):**

```bash
sudo apt install -y ufw
sudo ufw allow 3000/tcp
sudo ufw allow 4000/tcp
sudo ufw enable
sudo ufw status
```

**Router (Portweiterleitung):**

* Leite **TCP 3000** und **TCP 4000** auf die **interne Pi‑IP** weiter (z. B. 192.168.178.115).
* Ohne Portforwarding ist dein Dienst **nur im LAN** erreichbar.

### 2.4 Starten (ohne pm2)

```bash
cd ~/server
node server.js
```

Aufruf:

* **Lokal:** [https://192.168.178.115:3000](https://192.168.178.115:3000)
* **Öffentlich:** [https://DEINE-OEFFENTLICHE-IP:3000](https://DEINE-OEFFENTLICHE-IP:3000) (nur mit Portforwarding)

---

## 3) Dauerbetrieb mit PM2

Installieren & starten:

```bash
sudo npm install -g pm2
cd ~/server
pm2 start server.js --name server
pm2 save
pm2 startup systemd -u $USER --hp /home/$USER
```

### Wichtige PM2‑Befehle (Cheat‑Sheet)

```bash
pm2 status                 # Übersicht aller Prozesse
pm2 start server.js --name server
pm2 restart server         # Neustart
pm2 stop server            # Stoppen
pm2 delete server          # Entfernen aus PM2
pm2 logs server            # Live‑Logs
pm2 logs                   # Alle Logs
pm2 save                   # aktuelle Liste persistieren
pm2 resurrect              # gespeicherte Liste laden
pm2 reload all             # Zero‑downtime Reload (Cluster/HTTP)
pm2 list                   # Alias für status
```

---

## Troubleshooting

* **`ssh: Could not resolve hostname server.local`**

  * Unter Windows fehlt oft mDNS. Nutze die **interne IP** des Pi oder installiere Bonjour.
* **`bash: git: command not found`**

  * `sudo apt update && sudo apt install -y git`
* **Port 3000 schon belegt (`EADDRINUSE`)**

  * `sudo lsof -i :3000` → PID ermitteln, dann `sudo kill -9 PID`
* **SSL‑Pfadfehler (`ENOENT: ./ssl/private.key`)**

  * Sicherstellen, dass `~/server/ssl/private.key` und `certificate.crt` vorhanden sind und Pfade im Code stimmen.
* **`server.local` erreichbar, aber öffentlich nicht**

  * Router‑Portforwarding prüfen; ggf. CGNAT beim Provider (dann keine öffentliche Erreichbarkeit ohne VPN/Tunnel).

---

## Sicherheitshinweise

* Self‑signed Zertifikate sind nur für Tests. Für öffentliche Nutzung eine **Domain + Let’s Encrypt** verwenden.
* SSH‑Zugang mit **SSH‑Keys** absichern; Passwort‑Login ggf. deaktivieren.
* Regelmäßige Updates: `sudo apt update && sudo apt upgrade -y`.

Viel Erfolg! 💪
