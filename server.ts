import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('data.db');
db.prisma = false; // dummy

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    pin TEXT,
    role TEXT
  );

  CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    name TEXT,
    currentPilotId TEXT
  );

  CREATE TABLE IF NOT EXISTS lines (
    id TEXT PRIMARY KEY,
    machineId TEXT,
    name TEXT,
    status TEXT,
    currentProgrammeId TEXT,
    currentOperatorId TEXT,
    activeDowntimeId TEXT
  );

  CREATE TABLE IF NOT EXISTS programmes (
    id TEXT PRIMARY KEY,
    name TEXT,
    machineId TEXT,
    lineId TEXT,
    targetPallets INTEGER,
    producedPallets INTEGER,
    status TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS downtime_types (
    id TEXT PRIMARY KEY,
    name TEXT,
    icon TEXT
  );

  CREATE TABLE IF NOT EXISTS production_logs (
    id TEXT PRIMARY KEY,
    programmeId TEXT,
    operatorId TEXT,
    machineId TEXT,
    lineId TEXT,
    count INTEGER,
    timestamp TEXT
  );

  CREATE TABLE IF NOT EXISTS downtime_logs (
    id TEXT PRIMARY KEY,
    machineId TEXT,
    lineId TEXT,
    typeId TEXT,
    operatorId TEXT,
    startTime TEXT,
    endTime TEXT,
    duration INTEGER,
    description TEXT
  );
`);

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Endpoints
  // Generic collection operations to mimic Firestore-ish interaction
  
  app.get('/api/db/:collection', (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM ${req.params.collection}`).all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/db/:collection/:id', (req, res) => {
    try {
      const row = db.prepare(`SELECT * FROM ${req.params.collection} WHERE id = ?`).get(req.params.id);
      res.json(row);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/db/:collection', (req, res) => {
    try {
      const data = req.body;
      if (!data.id) data.id = Math.random().toString(36).substring(2, 11);
      
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map(() => '?').join(',');
      
      const stmt = db.prepare(`INSERT INTO ${req.params.collection} (${keys.join(',')}) VALUES (${placeholders})`);
      stmt.run(...values);
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.put('/api/db/:collection/:id', (req, res) => {
    try {
      const data = req.body;
      const keys = Object.keys(data);
      const values = Object.values(data);
      const sets = keys.map(k => `${k} = ?`).join(',');
      
      const stmt = db.prepare(`UPDATE ${req.params.collection} SET ${sets} WHERE id = ?`);
      stmt.run(...values, req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/db/:collection/:id', (req, res) => {
    try {
      db.prepare(`DELETE FROM ${req.params.collection} WHERE id = ?`).run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Specialized Login Route
  app.post('/api/login', (req, res) => {
    const { name, pin } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE name = ? AND pin = ?').get(name, pin);
    if (user) {
      res.json(user);
    } else {
      res.status(401).json({ error: 'Identifiants invalides' });
    }
  });

  // Vite setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
