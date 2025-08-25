const express = require("express");
const https = require("https");
const { WebSocketServer } = require("ws");
const Database = require("better-sqlite3");
const fs = require("fs");

const options = {
    key: fs.readFileSync("./ssl/private.key"),
    cert: fs.readFileSync("./ssl/certificate.crt"),
};
const app = express();
const server = https.createServer(options, app);
const wss = new WebSocketServer({ noServer: true });



const db = new Database("./chat.sqlite");
db.pragma("journal_mode = WAL");

db.prepare(`
  CREATE TABLE IF NOT EXISTS pending (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId     TEXT    NOT NULL,
    recipient  TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    createdAt  INTEGER NOT NULL
  )
`).run();

// ⛓️ Aktive Sockets + Raumspeicher
const sockets = new Map();         // userId → WebSocket
const subscriptions = new Map();   // userId → Set<roomIds>

// Alphabetische Room-ID
function makeRoomId(idA, idB) {
    return [idA, idB].sort().join("|");
}

// Upgrade-Handler: /ws/<userId>
server.on("upgrade", (req, socket, head) => {
    const match = /^\/ws\/(.+)$/.exec(req.url);
    if (!match) return socket.destroy();
    const userId = match[1];

    wss.handleUpgrade(req, socket, head, (ws) => {
        ws.userId = userId;
        wss.emit("connection", ws, userId);
    });
});

// Verbindung aufbauen
wss.on("connection", (ws, userId) => {
    console.log(`🔌 WebSocket verbunden für ${userId}`);
    sockets.set(userId, ws);
    subscriptions.set(userId, new Set());

    ws.on("close", () => {
        console.log(`❌ WebSocket getrennt: ${userId}`);
        sockets.delete(userId);
        subscriptions.delete(userId);
    });

    ws.on("message", (raw) => {
        let msg = {};
        try {
            msg = JSON.parse(raw);
        } catch {
            console.warn("⚠️ Ungültiges JSON von", userId);
            return;
        }

        const type = msg.cmd;
        const room = msg.room;

        if (!room) return;

        if (type === "join") {
            subscriptions.get(userId).add(room);
            console.log(`✅ ${userId} hat Raum ${room} betreten`);

            // Gepufferte Nachrichten senden
            const rows = db.prepare(`
                SELECT id, message FROM pending
                WHERE roomId = ? AND recipient = ?
                ORDER BY createdAt ASC
            `).all(room, userId);

            for (const row of rows) {
                ws.send(row.message);
                db.prepare(`DELETE FROM pending WHERE id = ?`).run(row.id);
            }
        }

        if (type === "leave") {
            subscriptions.get(userId).delete(room);
            console.log(`🚪 ${userId} hat Raum ${room} verlassen`);
        }
    });
});

// Helfer: Nachricht zustellen oder puffern
function deliverOrStore({ from, to, payload }) {
    const roomId = makeRoomId(from, to);
    const now = Date.now();
    const msg = JSON.stringify({ payload, timestamp: now, roomId });

    const recipientSocket = sockets.get(to);
    const activeRooms = subscriptions.get(to);

    if (recipientSocket && activeRooms?.has(roomId)) {
        recipientSocket.send(msg);
        console.log(`📤 Live an ${to} in ${roomId}`);
    } else {
        // puffern
        db.prepare(`
            INSERT INTO pending (roomId, recipient, message, createdAt)
            VALUES (?, ?, ?, ?)
        `).run(roomId, to, msg, now);
        console.log(`💾 Nachricht für ${to} gepuffert (${roomId})`);

        // optional: Hinweis an Empfänger senden
        if (recipientSocket) {
            recipientSocket.send(JSON.stringify({
                type: "unread_hint",
                roomId,
                peer: from
            }));
            console.log(`🔔 unread_hint an ${to}`);
        }
    }
}

// 🔽 HTTP-POST für verschlüsselte Nachricht
app.use(express.json({ limit: '10mb' }));
app.post("/sendEncrypted", (req, res) => {
    const { from, to, payload } = req.body;
    if (!from || !to || !payload) {
        return res.status(400).json({ error: "Fehlende Felder" });
    }

    deliverOrStore({ from, to, payload });
    res.json({ ok: true });
});

// 🔽 HTTP-GET: ausstehende Nachrichten
app.get("/pending", (req, res) => {
    const me = req.query.me;
    const roomId = req.query.roomId;       // neu
    if (!me) return res.status(400).json({ error: "Fehlende me-ID" });
    if (!roomId) return res.status(400).json({ error: "Fehlende roomId" });

    // Nur Zeilen für ME und diesen Raum
    const rows = db.prepare(`
        SELECT id, roomId, message, createdAt
        FROM pending
        WHERE recipient = ? AND roomId = ?
        ORDER BY createdAt ASC
    `).all(me, roomId);

    const ids = rows.map(r => r.id);
    if (ids.length) {
        const ph = ids.map(_ => "?").join(",");
        db.prepare(`DELETE FROM pending WHERE id IN (${ph})`).run(...ids);
    }

    const messages = rows.map(row => ({
        roomId: row.roomId,
        payload: JSON.parse(row.message).payload,
        timestamp: row.createdAt
    }));
    res.json(messages);
});


// 🔽 HTTP-GET: Zähler für Badge
app.get("/pending-counts", (req, res) => {
    const me = req.query.me;
    if (!me) return res.status(400).json({ error: "Fehlende me-ID" });

    const rows = db.prepare(`
        SELECT roomId, COUNT(*) as count
        FROM pending
        WHERE recipient = ?
        GROUP BY roomId
    `).all(me);

    const counts = {};
    for (const row of rows) {
        const [idA, idB] = row.roomId.split("|");
        const peerId = (idA === me) ? idB : idA;
        counts[peerId] = row.count;
    }

    res.json(counts);
});

// 🟢 Server starten
server.listen(3000, () => {
    console.log("🚀 Server läuft auf http://localhost:3000");
});
