// server.js (dein Node-File)

import express from "express";
import Database from "better-sqlite3";
import cors from "cors";
import fs from "fs";
import https from "https";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("admin"));

const db = new Database("./license.sqlite");
db.exec(fs.readFileSync("./db/schema.sql", "utf8"));

const now = () => Date.now();
const DAYS = (n) => n * 24 * 60 * 60 * 1000;

const getDevice = db.prepare(`SELECT * FROM devices WHERE id = ?`);
const listDevices = db.prepare(`SELECT * FROM devices ORDER BY activatedAt DESC`);
const addDeviceStmt = db.prepare(`INSERT INTO devices (id, name, groupName, allowedUntil, blocked, activatedAt, lastCheckIn) VALUES (?, ?, ?, ?, ?, ?, ?)`);

const upsertGroup = db.prepare(`INSERT INTO groups (name, locked) VALUES (?, 1) ON CONFLICT(name) DO NOTHING`);
const listGroups = db.prepare(`
  SELECT g.name,
         g.locked,
         COUNT(d.id) AS deviceCount
  FROM groups g
  LEFT JOIN devices d ON d.groupName = g.name
  GROUP BY g.name, g.locked
  ORDER BY g.name COLLATE NOCASE
`);
const lockGroupStmt = db.prepare(`UPDATE groups SET locked = 1 WHERE name = ?`);
const unlockGroupStmt = db.prepare(`UPDATE groups SET locked = 0 WHERE name = ?`);

// ===== ADMIN: DEVICES =====
app.get("/admin/devices", (req, res) => {
    res.json(listDevices.all());
});

// Geräte neu anlegen (war im Frontend benutzt, fehlte im Backend)
app.post("/admin/devices/new", (req, res) => {
    const { name, groupName } = req.body || {};
    const id = crypto.randomUUID();
    const t = now();
    addDeviceStmt.run(id, name || null, groupName || null, t, 1, t, t); // neu = erst mal BLOCKED
    if (groupName) upsertGroup.run(groupName);
    res.json({ ok: true, id });
});

app.post("/admin/devices/:id/block", (req, res) => {
    db.prepare(`UPDATE devices SET blocked = 1 WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
});

app.post("/admin/devices/:id/unblock", (req, res) => {
    db.prepare(`UPDATE devices SET blocked = 0 WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
});

app.patch("/admin/devices/:id/group", (req, res) => {
    const id = req.params.id;
    const groupName = req.body.groupName || null;

    const update = db.prepare(`UPDATE devices SET groupName = ? WHERE id = ?`);
    update.run(groupName, id);

    // Wenn Gruppe gesetzt → Freigabe übernehmen
    if (groupName) {
        const group = db.prepare(`SELECT allowedUntil FROM groups WHERE name = ?`).get(groupName);

        if (group && group.allowedUntil && group.allowedUntil > Date.now()) {
            // Gerät freigeben
            db.prepare(`UPDATE devices SET blocked = 0, allowedUntil = ? WHERE id = ?`)
                .run(group.allowedUntil, id);
        }
    }

    res.json({ ok: true });
});


app.delete("/admin/devices/:id", (req, res) => {
    db.prepare(`DELETE FROM devices WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
});

// ===== ADMIN: GROUPS =====
app.get("/admin/groups", (req, res) => {
    const stmt = db.prepare(`
    SELECT g.name, g.locked, g.allowedUntil,
      (SELECT COUNT(*) FROM devices d WHERE d.groupName = g.name) as deviceCount
    FROM groups g
  `);
    res.json(stmt.all());
});

app.post("/admin/groups", (req, res) => {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "missing_name" });
    upsertGroup.run(name.trim());
    res.json({ ok: true });
});

app.post("/admin/groups/:name/lock", (req, res) => {
    const name = req.params.name;
    lockGroupStmt.run(name);
    db.prepare(`UPDATE devices SET blocked = 1 WHERE groupName = ?`).run(name);
    res.json({ ok: true });
});

app.post("/admin/groups/:name/unlock", (req, res) => {
    const name = req.params.name;
    const duration = req.body.duration;

    let ms = 0;
    if (duration === "forever") {
        ms = Number.MAX_SAFE_INTEGER;
    } else {
        ms = parseInt(duration) * 24 * 60 * 60 * 1000; // Tage → ms
    }

    const until = Date.now() + ms;

    db.prepare(`UPDATE groups SET locked = 0, allowedUntil = ? WHERE name = ?`)
        .run(until, name);

    res.json({ ok: true });
});


app.delete("/admin/groups/:name", (req, res) => {
    const name = req.params.name;
    db.prepare(`DELETE FROM groups WHERE name = ?`).run(name);
    // Geräte behalten ihren groupName (optional könntest du sie auf NULL setzen)
    res.json({ ok: true });
});

// ===== RUNTIME API =====
app.post("/api/check-now", (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "missing_deviceId" });

    let dev = getDevice.get(deviceId);

    if (!dev) {
        // Erstkontakt -> anlegen & blockieren
        const t = now();
        addDeviceStmt.run(deviceId, null, null, t, 1, t, t);
        console.log(`➕ Neues Gerät eingetragen (blockiert): ${deviceId}`);
        return res.status(403).json({ error: "device_created_blocked" });
    }

    // Gruppen-Lock erzwingen
    if (dev.groupName) {
        const g = db.prepare(`SELECT locked FROM groups WHERE name = ?`).get(dev.groupName);
        if (g?.locked) return res.status(403).json({ error: "group_locked" });
    }

    if (dev.blocked) return res.status(403).json({ error: "blocked" });
    if (dev.allowedUntil < now()) return res.status(403).json({ error: "expired" });

    db.prepare(`UPDATE devices SET lastCheckIn = ? WHERE id = ?`).run(now(), deviceId);
    res.json({ ok: true });
});

app.post("/admin/devices/:id/unlock", (req, res) => {
    const { duration } = req.body || {}; // "30" | "90" | "180" | "360" | "forever"
    const DAYS = (n) => n * 24 * 60 * 60 * 1000;
    const until =
        duration === "forever"
            ? Number.MAX_SAFE_INTEGER
            : Date.now() + DAYS(Number(duration || 30));

    db.prepare(`UPDATE devices SET blocked = 0, allowedUntil = ? WHERE id = ?`)
        .run(until, req.params.id);

    res.json({ ok: true, allowedUntil: until });
});

app.patch("/admin/devices/:id/rename", (req, res) => {
    const { name } = req.body || {};
    if (typeof name !== "string") return res.status(400).json({ error: "invalid_name" });

    db.prepare(`UPDATE devices SET name = ? WHERE id = ?`).run(name.trim(), req.params.id);
    res.json({ ok: true });
});


// ===== HTTPS START =====
const opts = {
    key: fs.readFileSync("./ssl/private.key"),
    cert: fs.readFileSync("./ssl/certificate.crt")
};
https.createServer(opts, app).listen(4000, () =>
    console.log("🚀 Admin läuft unter https://localhost:4000")
);
