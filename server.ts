import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createServer } from 'http';
import { Server } from 'socket.io';

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
    activeDowntimeId TEXT,
    tracksProduction INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS programmes (
    id TEXT PRIMARY KEY,
    name TEXT,
    machineId TEXT,
    lineId TEXT,
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

// Seed default data if empty
const count = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (count.count === 0) {
  console.log('Seeding initial database data...');
  
  // Default Admin
  db.prepare('INSERT INTO users (id, name, pin, role) VALUES (?, ?, ?, ?)').run(
    'admin-1', 'Admin', '1234', 'ADMIN'
  );

  // Default Downtime Types
  const dtTypes = [
    { id: 'dt-1', name: 'Panne Machine', icon: '⚙️' },
    { id: 'dt-2', name: 'Changement Format', icon: '🔧' },
    { id: 'dt-3', name: 'Manque Matière', icon: '📦' },
    { id: 'dt-4', name: 'Pause / Nettoyage', icon: '🧹' },
    { id: 'dt-5', name: 'Réglage Qualité', icon: '⚖️' },
    { id: 'dt-6', name: 'Autre', icon: '❓' }
  ];
  
  const insertDT = db.prepare('INSERT INTO downtime_types (id, name, icon) VALUES (?, ?, ?)');
  for (const dt of dtTypes) {
    insertDT.run(dt.id, dt.name, dt.icon);
  }

  // Sample machine and line
  db.prepare('INSERT INTO machines (id, name) VALUES (?, ?)').run('m1', 'Machine Principale');
  db.prepare('INSERT INTO lines (id, machineId, name, status) VALUES (?, ?, ?, ?)').run('l1', 'm1', 'Ligne de Production A', 'IDLE');
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  app.use(express.json());

  // Socket logic
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.on('disconnect', () => {
      console.log('User disconnected');
    });
  });

  // Broadcast helper
  const notifyChange = (collection: string) => {
    io.emit('db_change', { collection });
  };

  // API Endpoints
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
      
      notifyChange(req.params.collection);
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
      
      notifyChange(req.params.collection);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/db/:collection/:id', (req, res) => {
    try {
      db.prepare(`DELETE FROM ${req.params.collection} WHERE id = ?`).run(req.params.id);
      notifyChange(req.params.collection);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Specialized Login Route
  app.post('/api/login', (req, res) => {
    const { name, pin } = req.body;
    let user;
    if (name) {
      user = db.prepare('SELECT * FROM users WHERE name = ? AND pin = ?').get(name, pin);
    } else {
      user = db.prepare('SELECT * FROM users WHERE pin = ?').get(pin);
    }
    
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
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
