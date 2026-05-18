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
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { networkInterfaces } from 'os';

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
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
let io: Server;

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
        password TEXT,
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

    // Seed default data if empty (only if users table is empty)
    const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (countRow.count === 0) {
      console.log('Seeding initial database data...');
      
      // Default Admin (Hashed Password)
      const hashedAdminPass = await bcrypt.hash('admin123', SALT_ROUNDS);
      db.prepare('INSERT INTO users (id, name, password, role) VALUES (?, ?, ?, ?)').run(
        'admin-1', 'Bizmaoune Mohamed', hashedAdminPass, 'ADMIN'
      );

      // Default Operators
      const hashedOpPass = await bcrypt.hash('operator123', SALT_ROUNDS);
      db.prepare('INSERT INTO users (id, name, password, role) VALUES (?, ?, ?, ?)').run(
        'op-1', 'Nabil', hashedOpPass, 'OPERATOR'
      );
      db.prepare('INSERT INTO users (id, name, password, role) VALUES (?, ?, ?, ?)').run(
        'op-2', 'Abdelhakim', hashedOpPass, 'OPERATOR'
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

      // Default production lines and machines matching existing data
      db.prepare('INSERT INTO machines (id, name) VALUES (?, ?)').run('m1', 'Mafroda');
      
      db.prepare('INSERT INTO lines (id, machineId, name, status, tracksProduction) VALUES (?, ?, ?, ?, ?)').run('l1', 'm1', 'Ligne 1', 'IDLE', 1);
      db.prepare('INSERT INTO lines (id, machineId, name, status, tracksProduction) VALUES (?, ?, ?, ?, ?)').run('l2lxzytwv', 'm1', 'Elifab', 'IDLE', 1);

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
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Capacitor)
      if (!origin) return callback(null, true);
      
      // Allow localhost
      if (origin.includes('localhost')) return callback(null, true);
      
      // Allow local network IPs: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
      const isLAN = /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin);
      if (isLAN) return callback(null, true);

      // Allow AI Studio / Cloud Run domains
      if (origin.endsWith('.run.app')) return callback(null, true);
      
      // Allow explicit overrides from env
      if (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN) 
        return callback(null, true);
      if (process.env.APP_URL && origin === process.env.APP_URL)
        return callback(null, true);

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
  app.use(helmet({
    contentSecurityPolicy: false, // Vite handles CSP in dev
  }));

  // 2.5 DIRECT UPLOAD ROUTE (FOR HIGHEST PRIORITY)
  app.post(['/api/upload', '/api/upload/'], (req, res) => {
    console.log(`[SERVER-UPLOAD] Incoming request at ${req.url}`);
    upload.single('photo')(req, res, (err) => {
      if (err) {
        console.error('[SERVER-UPLOAD] Multer Error:', err);
        return res.status(400).json({ error: err.message || 'Erreur multer' });
      }
      if (!req.file) {
        console.error('[SERVER-UPLOAD] No file found in "photo" field');
        return res.status(400).json({ error: 'Fichier absent du champ "photo"' });
      }
      console.log('[SERVER-UPLOAD] Saved:', req.file.filename);
      res.status(200).json({ 
        success: true,
        url: `/uploads/${req.file.filename}`, 
        path: req.file.filename 
      });
    });
  });

  // 3. API ROUTES ROUTER
  const apiRouter = express.Router();

  // Log all API requests
  apiRouter.use((req, res, next) => {
    console.log(`[API] ${req.method} ${req.url}`);
    next();
  });

  // Health check (Public)
  apiRouter.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), server: 'Express/Vite' });
  });

  // Test route (Public)
  apiRouter.get('/test-json', (req, res) => {
    res.json({ success: true, message: 'JSON API reaches here' });
  });

  // Body parsers for API routes
  apiRouter.use(express.json({ limit: '5mb' }));
  apiRouter.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // JWT Auth Middleware
  function requireAuth(req: any, res: any, next: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
      req.user = payload;
      next();
    } catch (e) {
      res.status(401).json({ error: 'Token invalide ou expiré' });
    }
  }

  // Login Rate Limiting
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5,
    message: { error: 'Trop de tentatives. Veuillez attendre 15 minutes avant de réessayer.' },
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false } as any,
  });

  // Login Public Route
  apiRouter.post('/login', loginLimiter, async (req, res) => {
    try {
      const { name, pin, password } = req.body;
      const passToTry = String(password || pin);
      
      if (!name || !passToTry) return res.status(400).json({ error: 'Utilisateur et mot de passe requis' });
      
      const user = db.prepare('SELECT * FROM users WHERE name = ?').get(sanitizeValue(name)) as any;
      if (user) {
        // Support both hashed password stored in 'password' or 'pin' columns for backward compatibility if migration isn't full
        const storedHash = user.password || user.pin;
        if (!storedHash) return res.status(401).json({ error: 'Compte invalide' });
        
        const isValid = await bcrypt.compare(passToTry, storedHash);
        if (isValid) {
          const { password: _p, pin: _h, ...safeUser } = user;
          const token = jwt.sign({ id: safeUser.id, role: safeUser.role }, JWT_SECRET, { expiresIn: '12h' });
          return res.json({ ...safeUser, token });
        }
      }
      res.status(401).json({ error: 'Identifiants invalides' });
    } catch (e) { 
      console.error('Login error:', e);
      res.status(500).json({ error: 'Erreur interne au serveur' }); 
    }
  });

  // Apply Auth Middleware to all subsequent routes
  apiRouter.use(requireAuth);

  // --- SCADA GLOBAL ENDPOINTS ---
  apiRouter.post('/machine/:id/global-stop', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { id: machineId } = req.params;
      const { typeId, operatorId, description, images } = req.body;
      const shiftId = getServerShiftId();
      const startTime = new Date().toISOString();
      const logId = Math.random().toString(36).substring(2, 11);

      // 1. Create a single log entry for the global stop
      db.prepare(`
        INSERT INTO downtime_logs (id, machineId, lineId, typeId, operatorId, shiftId, startTime, description, images)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(logId, machineId, 'MACHINE_LEVEL', typeId, operatorId, shiftId, startTime, description || '', sanitizeValue(images));

      // 2. Update all active lines for this machine
      db.prepare(`
        UPDATE lines 
        SET activeDowntimeId = ?, status = 'STOPPED' 
        WHERE machineId = ? AND isActive != 0
      `).run(logId, machineId);

      io.emit('db_change', { collection: 'downtime_logs' });
      io.emit('db_change', { collection: 'lines' });
      
      res.json({ success: true, logId });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  apiRouter.post('/machine/:id/global-resume', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { id: machineId } = req.params;
      const endTime = new Date().toISOString();

      // 1. Find all active downtime logs for this machine (including MACHINE_LEVEL)
      const machineLines = db.prepare('SELECT id, activeDowntimeId FROM lines WHERE machineId = ?').all(machineId) as any[];
      const downtimeIds = [...new Set(machineLines.map(l => l.activeDowntimeId).filter(Boolean))];

      for (const logId of downtimeIds) {
        const log = db.prepare('SELECT startTime FROM downtime_logs WHERE id = ?').get(logId) as any;
        if (log) {
          const duration = Math.floor((new Date(endTime).getTime() - new Date(log.startTime).getTime()) / 1000);
          db.prepare('UPDATE downtime_logs SET endTime = ?, duration = ? WHERE id = ?').run(endTime, duration, logId);
        }
      }

      // 2. Reset all lines for this machine
      db.prepare(`
        UPDATE lines 
        SET activeDowntimeId = NULL, status = 'IDLE' 
        WHERE machineId = ?
      `).run(machineId);

      io.emit('db_change', { collection: 'downtime_logs' });
      io.emit('db_change', { collection: 'lines' });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Sanitize helper (available in scope)
  const sanitizeValue = (val: any) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') return val.replace(/[\x00-\x1F\x7F]/g, "").trim();
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'object') {
      try { return JSON.stringify(val); } catch { return null; }
    }
    return String(val);
  };

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
    } catch (e) { console.error('Error shift ID:', e); }
    return null;
  };

  // DB Collection Routes
  apiRouter.get('/db/:collection', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection } = req.params;
      if (!ALLOWED_COLLECTIONS.includes(collection)) return res.status(403).json({ error: 'Accès non autorisé' });
      const rows = db.prepare(`SELECT * FROM ${collection}`).all();
      if (collection === 'users') {
        return res.json(rows.map(({ password, pin, ...u }: any) => u));
      }
      res.json(rows);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  apiRouter.get('/db/:collection/:id', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection, id } = req.params;
      if (!ALLOWED_COLLECTIONS.includes(collection)) return res.status(403).json({ error: 'Accès non autorisé' });
      const row = db.prepare(`SELECT * FROM ${collection} WHERE id = ?`).get(id);
      if (collection === 'users' && row) {
        const { password, pin, ...safeRow } = row as any;
        return res.json(safeRow);
      }
      res.json(row);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  apiRouter.post('/db/:collection', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection } = req.params;
      if (!ALLOWED_COLLECTIONS.includes(collection)) return res.status(403).json({ error: 'Accès non autorisé' });
      const data = { ...req.body };
      if (!data.id) data.id = Math.random().toString(36).substring(2, 11);
      
      if (collection === 'users') {
        const newPassword = data.password || data.pin;
        if (newPassword) {
          data.password = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
          delete data.pin;
        }
      }
      const logCollections = ['production_logs', 'downtime_logs', 'programmes'];
      if (logCollections.includes(collection) && !data.shiftId) data.shiftId = getServerShiftId();
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
      if (keys.length === 0) return res.status(400).json({ error: 'Aucun champ valide fourni' });
      const placeholders = keys.map(() => '?').join(',');
      db.prepare(`INSERT INTO ${collection} (${keys.join(',')}) VALUES (${placeholders})`).run(...values);
      io.emit('db_change', { collection });
      res.json({ id: data.id });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  apiRouter.put('/db/:collection/:id', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection, id } = req.params;
      if (!ALLOWED_COLLECTIONS.includes(collection)) return res.status(403).json({ error: 'Accès non autorisé' });
      const data = { ...req.body };
      
      if (collection === 'users') {
        const newPassword = data.password || data.pin;
        if (newPassword) {
          data.password = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
          delete data.pin;
        }
      }
      const pragma = db.prepare(`PRAGMA table_info(${collection})`).all() as any[];
      const validColumns = pragma.map(p => p.name).filter(c => c !== 'id');
      const values: any[] = [];
      const sets: string[] = [];
      for (const col of validColumns) {
        if (data[col] !== undefined) {
          const val = data[col];
          // Support atomic increments: { field: { _inc: Number } }
          if (val && typeof val === 'object' && val._inc !== undefined) {
            sets.push(`${col} = ${col} + ?`);
            values.push(Number(val._inc));
          } else {
            sets.push(`${col} = ?`);
            values.push(sanitizeValue(val));
          }
        }
      }
      if (sets.length === 0) return res.json({ success: true });
      db.prepare(`UPDATE ${collection} SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      io.emit('db_change', { collection });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  apiRouter.delete('/db/:collection/:id', (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const { collection, id } = req.params;
      if (!ALLOWED_COLLECTIONS.includes(collection)) return res.status(403).json({ error: 'Accès non autorisé' });
      db.prepare(`DELETE FROM ${collection} WHERE id = ?`).run(id);
      io.emit('db_change', { collection });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // Catch-all for API Router (JSON)
  apiRouter.all('*', (req, res) => {
    console.warn(`[API-404] No match for ${req.method} ${req.originalUrl || req.url}`);
    res.status(404).json({ error: `Route API inconnue: ${req.method} ${req.originalUrl || req.url}`, type: 'api_fallback' });
  });

  // MOUNT API ROUTER on the app (priority)
  app.use('/api', apiRouter);

  // Serve uploads
  app.use('/uploads', express.static(UPLOADS_DIR));

  const httpServer = createServer(app);
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE"]
    }
  });

  // Socket logic
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.on('disconnect', () => {
      console.log('User disconnected');
    });
  });

  // Vite setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: {
          server: httpServer,
        }
      },
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
    console.log('\n' + '='.repeat(50));
    console.log(`[SERVER] RUNNING ON PORT ${PORT}`);
    console.log(`[SERVER] ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[SERVER] HEALTH CHECK: http://localhost:${PORT}/api/health`);
    console.log(`[SERVER] TEST JSON: http://localhost:${PORT}/api/test-json`);
    console.log(`[SERVER] UPLOAD URL: http://localhost:${PORT}/api/upload`);
    
    // Log registered routes for debug
    console.log('[SERVER] REGISTERED API ROUTES:');
    apiRouter.stack.forEach((r: any) => {
      if (r.route && r.route.path) {
        const methods = Object.keys(r.route.methods).join(',').toUpperCase();
        console.log(`  - [${methods}] /api${r.route.path}`);
      }
    });
    console.log('='.repeat(50) + '\n');

    const nets = networkInterfaces();
    for (const iface of Object.values(nets).flat()) {
      if (iface?.family === 'IPv4' && !iface.internal) {
        console.log(`[SERVER] LOCAL NETWORK: http://${iface.address}:${PORT}`);
      }
    }
  });
}

startServer().catch(err => {
  console.error('CRITICAL: Server failed to start:', err);
});
