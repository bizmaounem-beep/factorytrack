import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database;

async function startServer() {
  // Ensure the database file is writable before opening
  try {
    if (fs.existsSync('data.db')) {
      try {
        fs.chmodSync('data.db', 0o666);
      } catch (e) {
        console.warn('Could not chmod data.db:', e);
      }
    }
    
    db = new Database('data.db', { verbose: console.log });
    db.pragma('journal_mode = WAL'); // Use WAL mode for better concurrency and write stability
    
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
        parameters TEXT,
        shiftId TEXT,
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
        shiftId TEXT,
        count INTEGER,
        timestamp TEXT
      );

      CREATE TABLE IF NOT EXISTS downtime_logs (
        id TEXT PRIMARY KEY,
        machineId TEXT,
        lineId TEXT,
        typeId TEXT,
        operatorId TEXT,
        shiftId TEXT,
        startTime TEXT,
        endTime TEXT,
        duration INTEGER,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS shifts (
        id TEXT PRIMARY KEY,
        name TEXT,
        startTime TEXT,
        endTime TEXT
      );
    `);

    // Migrations for existing databases
    console.log('Running database migrations...');
    const logTables = ['production_logs', 'downtime_logs', 'programmes', 'lines'];
    for (const table of logTables) {
      try {
        const pragma = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
        const columns = pragma.map(p => p.name);
        if (!columns.includes('shiftId')) {
          console.log(`Migration: Adding shiftId column to ${table}...`);
          db.exec(`ALTER TABLE ${table} ADD COLUMN shiftId TEXT;`);
        }
      } catch (err) {
        console.error(`Migration failed for ${table}:`, err);
      }
    }
    console.log('Database migrations completed.');

    // Seed default data if empty
    const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (countRow.count === 0) {
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

      // Default Shifts
      const defaultShifts = [
        { id: 'shift-1', name: 'Matin (M)', startTime: '06:00', endTime: '14:00' },
        { id: 'shift-2', name: 'Après-midi (A)', startTime: '14:00', endTime: '22:00' },
        { id: 'shift-3', name: 'Nuit (N)', startTime: '22:00', endTime: '06:00' }
      ];
      const insertShift = db.prepare('INSERT INTO shifts (id, name, startTime, endTime) VALUES (?, ?, ?, ?)');
      for (const s of defaultShifts) {
        insertShift.run(s.id, s.name, s.startTime, s.endTime);
      }
    }
  } catch (e) {
    console.error('Database initialization failed:', e);
    // Continue anyway, routes will handle the error
  }

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE"]
    }
  });

  app.use(cors());
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
      if (!db) throw new Error('Database not initialized');
      const rows = db.prepare(`SELECT * FROM ${req.params.collection}`).all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/db/:collection/:id', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const row = db.prepare(`SELECT * FROM ${req.params.collection} WHERE id = ?`).get(req.params.id);
      res.json(row);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/db/:collection', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const data = { ...req.body };
      if (!data.id) data.id = Math.random().toString(36).substring(2, 11);
      
      // Get valid columns for safety
      const pragma = db.prepare(`PRAGMA table_info(${req.params.collection})`).all() as any[];
      const validColumns = pragma.map(p => p.name);
      
      const filteredData: any = {};
      for (const col of validColumns) {
        if (data[col] !== undefined) {
          filteredData[col] = data[col];
        }
      }

      const keys = Object.keys(filteredData);
      const values = Object.values(filteredData);
      const placeholders = keys.map(() => '?').join(',');
      
      const stmt = db.prepare(`INSERT INTO ${req.params.collection} (${keys.join(',')}) VALUES (${placeholders})`);
      stmt.run(...values);
      
      notifyChange(req.params.collection);
      res.json(filteredData);
    } catch (e) {
      console.error('POST Error:', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.put('/api/db/:collection/:id', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const data = { ...req.body };
      
      // Get valid columns for safety
      const pragma = db.prepare(`PRAGMA table_info(${req.params.collection})`).all() as any[];
      const validColumns = pragma.map(p => p.name).filter(c => c !== 'id');
      
      const filteredData: any = {};
      for (const col of validColumns) {
        if (data[col] !== undefined) {
          filteredData[col] = data[col];
        }
      }

      const keys = Object.keys(filteredData);
      const values = Object.values(filteredData);
      const sets = keys.map(k => `${k} = ?`).join(',');
      
      if (keys.length === 0) {
        return res.json({ success: true, message: 'No fields to update' });
      }

      const stmt = db.prepare(`UPDATE ${req.params.collection} SET ${sets} WHERE id = ?`);
      stmt.run(...values, req.params.id);
      
      notifyChange(req.params.collection);
      res.json({ success: true });
    } catch (e) {
      console.error('PUT Error:', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/db/:collection/:id', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      db.prepare(`DELETE FROM ${req.params.collection} WHERE id = ?`).run(req.params.id);
      notifyChange(req.params.collection);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Specialized Login Route
  app.post('/api/login', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
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
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
