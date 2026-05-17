import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcrypt';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';

const SALT_ROUNDS = 10;
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'downtime-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // Increase to 20MB
  fileFilter: (req, file, cb) => {
    console.log(`Receiving file: ${file.originalname} (${file.mimetype})`);
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Uniquement des images sont autorisées.'));
    }
  }
});

const ALLOWED_COLLECTIONS = [
  'users', 'machines', 'lines', 'programmes', 
  'downtime_types', 'production_logs', 'downtime_logs', 'shifts'
];

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
        // Obfuscate sensitive values in logs
        console.log(message);
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
        description TEXT,
        images TEXT,
        image_path TEXT
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
        
        if (table === 'downtime_logs' && !columns.includes('operatorId')) {
          console.log(`Migration: Adding operatorId column to downtime_logs...`);
          db.exec(`ALTER TABLE downtime_logs ADD COLUMN operatorId TEXT;`);
        }

        if (table === 'downtime_logs' && !columns.includes('image_path')) {
          console.log(`Migration: Adding image_path column to downtime_logs...`);
          db.exec(`ALTER TABLE downtime_logs ADD COLUMN image_path TEXT;`);
        }

        if (table === 'downtime_logs' && !columns.includes('images')) {
          console.log(`Migration: Adding images column to downtime_logs...`);
          db.exec(`ALTER TABLE downtime_logs ADD COLUMN images TEXT;`);
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
      
      // Default Admin (Hashed PIN)
      const hashedAdminPin = await bcrypt.hash('1234', SALT_ROUNDS);
      db.prepare('INSERT INTO users (id, name, pin, role) VALUES (?, ?, ?, ?)').run(
        'admin-1', 'Admin', hashedAdminPin, 'ADMIN'
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

  // Trust proxy is required when running behind a reverse proxy (like Nginx in our container)
  // to correctly handle X-Forwarded-For headers for rate limiting and IP detection.
  app.set('trust proxy', 1);

  // 1. PURE LOGGING (No body parsing yet)
  app.use((req, res, next) => {
    console.log(`[SERVER] incoming: ${req.method} ${req.url}`);
    next();
  });

  // 2. CORS & BASIC SECURITY
  app.use(cors());
  app.use(helmet({
    contentSecurityPolicy: false, // Vite handles CSP in dev
  }));

  // 3. UPLOAD ROUTE - BEFORE ANY BODY PARSERS that might interfere with multer
  app.post(['/api/upload', '/api/upload/'], (req, res) => {
    console.log('[UPLOAD-API] START matching route');
    upload.single('photo')(req, res, (err) => {
      if (err) {
        console.error('[UPLOAD-API] MULTER ERROR:', err);
        return res.status(400).json({ error: err.message || 'Erreur Multer' });
      }
      
      if (!req.file) {
        console.error('[UPLOAD-API] NO FILE. Content-Type:', req.headers['content-type']);
        return res.status(400).json({ error: 'Fichier manquant. Assurez-vous d\'envoyer un champ "photo" de type fichier.' });
      }

      console.log('[UPLOAD-API] SUCCESS:', req.file.filename);
      res.status(200).json({ 
        success: true,
        url: `/uploads/${req.file.filename}`, 
        path: req.file.filename 
      });
    });
  });

  // 4. GENERAL BODY PARSERS (for other API routes)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Dynamic static files for uploads
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE"]
    }
  });

  // Login Rate Limiting
  const loginLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 5, // 5 attempts per minute
    message: { error: 'Trop de tentatives de connexion. Réessayez dans une minute.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });

  // Sanitization helper
  const sanitizeValue = (val: any) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      // Basic protection against XSS and control characters
      return val.replace(/[\x00-\x1F\x7F]/g, "").trim();
    }
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val);
      } catch {
        return null;
      }
    }
    return String(val);
  };


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
      const { collection } = req.params;
      
      if (!ALLOWED_COLLECTIONS.includes(collection)) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      // Prepared statement for safety
      const rows = db.prepare(`SELECT * FROM ${collection}`).all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/db/:collection/:id', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection, id } = req.params;

      if (!ALLOWED_COLLECTIONS.includes(collection)) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      // Prepared statement with parameter binding
      const row = db.prepare(`SELECT * FROM ${collection} WHERE id = ?`).get(id);
      res.json(row);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/db/:collection', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection } = req.params;
      
      if (!ALLOWED_COLLECTIONS.includes(collection)) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      const data = { ...req.body };
      if (!data.id) data.id = Math.random().toString(36).substring(2, 11);
      
      // Hash PIN if creating a user
      if (collection === 'users' && data.pin) {
        data.pin = await bcrypt.hash(String(data.pin), SALT_ROUNDS);
      }

      // Auto-populate shiftId for logs if missing
      const logCollections = ['production_logs', 'downtime_logs', 'programmes'];
      if (logCollections.includes(collection) && !data.shiftId) {
        data.shiftId = getServerShiftId();
      }
      
      // Get valid columns for safety
      const pragma = db.prepare(`PRAGMA table_info(${collection})`).all() as any[];
      const validColumns = pragma.map(p => p.name);
      
      const values: any[] = [];
      const keys: string[] = [];

      for (const col of validColumns) {
        if (data[col] !== undefined) {
          keys.push(col);
          values.push(sanitizeValue(data[col]));
        }
      }

      if (keys.length === 0) {
        return res.status(400).json({ error: 'Aucun champ valide fourni' });
      }

      const placeholders = keys.map(() => '?').join(',');
      const stmt = db.prepare(`INSERT INTO ${collection} (${keys.join(',')}) VALUES (${placeholders})`);
      stmt.run(...values);
      
      notifyChange(collection);
      res.json({ id: data.id });
    } catch (e) {
      console.error('POST Error:', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.put('/api/db/:collection/:id', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection, id } = req.params;

      if (!ALLOWED_COLLECTIONS.includes(collection)) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      const data = { ...req.body };

      // Hash PIN if updating a user
      if (collection === 'users' && data.pin) {
        data.pin = await bcrypt.hash(String(data.pin), SALT_ROUNDS);
      }

      // Auto-populate shiftId for logs if missing/null during update
      const logCollections = ['production_logs', 'downtime_logs', 'programmes'];
      if (logCollections.includes(collection) && !data.shiftId) {
        const current = db.prepare(`SELECT shiftId FROM ${collection} WHERE id = ?`).get(id) as any;
        if (!current || !current.shiftId) {
          data.shiftId = getServerShiftId();
        }
      }
      
      const pragma = db.prepare(`PRAGMA table_info(${collection})`).all() as any[];
      const validColumns = pragma.map(p => p.name).filter(c => c !== 'id');
      
      const values: any[] = [];
      const keys: string[] = [];

      for (const col of validColumns) {
        if (data[col] !== undefined) {
          keys.push(col);
          values.push(sanitizeValue(data[col]));
        }
      }

      if (keys.length === 0) {
        return res.json({ success: true, message: 'Aucun champ à mettre à jour' });
      }

      const sets = keys.map(k => `${k} = ?`).join(',');
      const stmt = db.prepare(`UPDATE ${collection} SET ${sets} WHERE id = ?`);
      stmt.run(...values, id);
      
      notifyChange(collection);
      res.json({ success: true });
    } catch (e) {
      console.error('PUT Error:', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/db/:collection/:id', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection, id } = req.params;

      if (!ALLOWED_COLLECTIONS.includes(collection)) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      db.prepare(`DELETE FROM ${collection} WHERE id = ?`).run(id);
      notifyChange(collection);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Specialized Login Route with Hashed PIN check and Rate Limiting
  app.post('/api/login', loginLimiter, async (req, res) => {
    try {
      if (!db) throw new Error('Base de données non initialisée');
      const { name, pin } = req.body;
      
      if (!pin) {
        return res.status(400).json({ error: 'PIN manquant' });
      }

      const pinStr = String(pin);
      const nameStr = name ? sanitizeValue(name) : null;
      
      let user;
      if (nameStr) {
        // First find user by name exactly using prepared statement
        user = db.prepare('SELECT * FROM users WHERE name = ?').get(nameStr) as any;
      } else {
        // Optimization: Find candidate users (since we can't search by hash directly)
        // In a real system we'd always require a name/username
        const allUsers = db.prepare('SELECT * FROM users').all() as any[];
        for (const u of allUsers) {
          if (await bcrypt.compare(pinStr, u.pin)) {
            user = u;
            break;
          }
        }
      }
      
      if (user && nameStr) {
        // Verify PIN hash
        const isValid = await bcrypt.compare(pinStr, user.pin);
        if (isValid) {
          res.json(user);
        } else {
          res.status(401).json({ error: 'Identifiants invalides' });
        }
      } else if (user) {
        res.json(user);
      } else {
        res.status(401).json({ error: 'Identifiants invalides' });
      }
    } catch (e) {
      console.error('Login error:', e);
      res.status(500).json({ error: 'Erreur interne du serveur' });
    }
  });

  // 5. API Catch-all for debugging 404s (Placed AFTER all defined routes)
  app.all('/api/*', (req, res, next) => {
    console.warn(`[API 404] No route matched: ${req.method} ${req.url}`);
    if (req.accepts('json') || req.path.startsWith('/api/')) {
      return res.status(404).json({ 
        error: `Route API inconnue: ${req.method} ${req.url}`,
        tip: 'Vérifiez l\'URL de l\'API ou si la route est définie sur le serveur.' 
      });
    }
    next();
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
