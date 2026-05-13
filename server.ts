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
    
    db = new Database('data.db', { 
      verbose: (message) => {
        // Obfuscate PIN values in logs for security
        let safeMsg = message.replace(/(pin\s*=\s*)'[^']+'/gi, "$1'****'");
        console.log(safeMsg);
      }
    });

    // Automatic Daily Backup Function
    const performBackup = () => {
      try {
        const backupPath = 'data_backup.db';
        fs.copyFileSync('data.db', backupPath);
        console.log(`[AgroSync] Sauvegarde automatique effectuée : ${backupPath} (${new Date().toLocaleString()})`);
      } catch (err) {
        console.error('[AgroSync] Échec de la sauvegarde:', err);
      }
    };

    // Run backup every 24 hours (86400000 ms)
    setInterval(performBackup, 24 * 60 * 60 * 1000);
    // Also run once at startup
    performBackup();
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
        tracksProduction INTEGER DEFAULT 1,
        isActive INTEGER DEFAULT 1
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
        if (table === 'lines' && !columns.includes('isActive')) {
          console.log(`Migration: Adding isActive column to lines...`);
          db.exec(`ALTER TABLE lines ADD COLUMN isActive INTEGER DEFAULT 1;`);
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

  // Helper to strictly sanitize values for SQLite
  const sanitizeSqlValue = (val: any) => {
    if (val === null || val === undefined) return null;
    const type = typeof val;
    if (type === 'string' || type === 'number') return val;
    if (type === 'boolean') return val ? 1 : 0;
    if (type === 'object') {
       try {
         return JSON.stringify(val);
       } catch {
         return null;
       }
    }
    return String(val);
  };

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
  const getServerShiftId = () => {
    try {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const shifts = db.prepare('SELECT * FROM shifts').all() as any[];
      
      for (const shift of shifts) {
        const [startH, startM] = shift.startTime.split(':').map(Number);
        const [endH, endM] = shift.endTime.split(':').map(Number);
        const startMin = startH * 60 + startM;
        const endMin = endH * 60 + endM;

        if (endMin < startMin) {
          if (currentMinutes >= startMin || currentMinutes < endMin) return shift.id;
        } else {
          if (currentMinutes >= startMin && currentMinutes < endMin) return shift.id;
        }
      }
    } catch (e) {
      console.error('Error getting server shift ID:', e);
    }
    return null;
  };

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
      
      // Auto-populate shiftId for logs if missing
      const logCollections = ['production_logs', 'downtime_logs', 'programmes'];
      if (logCollections.includes(req.params.collection) && !data.shiftId) {
        data.shiftId = getServerShiftId();
      }
      
      // Get valid columns for safety
      const pragma = db.prepare(`PRAGMA table_info(${req.params.collection})`).all() as any[];
      const validColumns = pragma.map(p => p.name);
      
      const filteredData: any = {};
      const values: any[] = [];
      const keys: string[] = [];

      for (const col of validColumns) {
        if (data[col] !== undefined) {
          keys.push(col);
          const val = sanitizeSqlValue(data[col]);
          values.push(val);
          filteredData[col] = data[col];
        }
      }

      if (keys.length === 0) {
        return res.status(400).json({ error: 'No valid fields provided' });
      }

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

      // Auto-populate shiftId for logs if missing/null during update
      const logCollections = ['production_logs', 'downtime_logs', 'programmes'];
      if (logCollections.includes(req.params.collection) && !data.shiftId) {
        // Only fetch if it's not already in the DB? 
        // Actually if we are validating (categorizing) a stop, we might want to ensure it has a shiftId.
        const current = db.prepare(`SELECT shiftId FROM ${req.params.collection} WHERE id = ?`).get(req.params.id) as any;
        if (!current || !current.shiftId) {
          data.shiftId = getServerShiftId();
        }
      }
      
      // Get valid columns for safety
      const pragma = db.prepare(`PRAGMA table_info(${req.params.collection})`).all() as any[];
      const validColumns = pragma.map(p => p.name).filter(c => c !== 'id');
      
      const values: any[] = [];
      const keys: string[] = [];

      for (const col of validColumns) {
        if (data[col] !== undefined) {
          keys.push(col);
          const val = sanitizeSqlValue(data[col]);
          values.push(val);
        }
      }

      if (keys.length === 0) {
        return res.json({ success: true, message: 'No fields to update' });
      }

      const sets = keys.map(k => `${k} = ?`).join(',');
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
      
      if (!pin) {
        return res.status(400).json({ error: 'PIN manquant' });
      }

      const pinStr = String(pin);
      const nameStr = name ? String(name) : null;
      
      let user;
      if (nameStr) {
        user = db.prepare('SELECT * FROM users WHERE name = ? AND pin = ?').get(nameStr, pinStr);
      } else {
        user = db.prepare('SELECT * FROM users WHERE pin = ?').get(pinStr);
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
