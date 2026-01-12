const express = require('express');
const http = require('http');
const fs = require('fs');
const mysql = require('mysql2/promise');
const ExcelJS = require('exceljs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'fuel_tracker',
  waitForConnections: true,
  connectionLimit: 10
});

// Trust proxy since app is behind Apache reverse proxy
app.set('trust proxy', 1);

// Session middleware with memory store
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Set to true if using HTTPS
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to check authentication
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

// Validation error handler middleware
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

// Rate limiting middleware
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per windowMs
  message: 'Too many login attempts, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts. Please try again after 15 minutes.' });
  }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registration attempts per hour
  message: 'Too many accounts created from this IP, please try again after an hour',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many registration attempts. Please try again after 1 hour.' });
  }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for GET requests (read-only)
    return req.method === 'GET';
  }
});

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

async function sendWorkbook(res, sheetName, columns, rows, filename) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns;
  rows.forEach((row) => sheet.addRow(row));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function ensureTable() {
  const createSql = `
    CREATE TABLE IF NOT EXISTS trips (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      trip_date DATE NOT NULL,
      odometer_km DECIMAL(10,1) NOT NULL,
      fuel_quantity_l DECIMAL(10,3) NOT NULL,
      price_total DECIMAL(10,2) NOT NULL,
      price_per_liter DECIMAL(10,3) NOT NULL,
      gst_paid DECIMAL(10,2) DEFAULT 0,
      start_mileage DECIMAL(10,1) DEFAULT NULL,
      vehicle VARCHAR(50) DEFAULT 'Nissan Xtrail',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  const createDailyMileageSql = `
    CREATE TABLE IF NOT EXISTS daily_mileage (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      mileage_date DATE NOT NULL,
      start_mileage DECIMAL(10,1) NOT NULL,
      end_mileage DECIMAL(10,1) NOT NULL,
      total_km DECIMAL(10,1) GENERATED ALWAYS AS (end_mileage - start_mileage) STORED,
      vehicle VARCHAR(50) DEFAULT 'Nissan Xtrail',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  const conn = await pool.getConnection();
  try {
    await conn.query(createSql);
    await conn.query(createDailyMileageSql);
  } finally {
    conn.release();
  }
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

// Authentication Routes
app.post('/api/register',
  registerLimiter,
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and hyphens'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long'),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Check if user exists
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hashedPassword]);
    res.json({ success: true, message: 'User registered' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login',
  loginLimiter,
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }

    // Find user
    const [users] = await pool.query('SELECT id, password_hash FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.username = username;
    res.json({ success: true, username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/auth/status', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// Protected API Routes
app.get('/api/trips', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, trip_date, odometer_km, fuel_quantity_l, price_total, price_per_liter, gst_paid, start_mileage, vehicle, created_at FROM trips ORDER BY trip_date DESC, id DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching trips', err);
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

app.post('/api/trips', 
  apiLimiter,
  requireAuth,
  body('date')
    .isISO8601()
    .withMessage('Invalid date format'),
  body('odometerKm')
    .isFloat({ min: 0 })
    .withMessage('Odometer must be a positive number'),
  body('fuelQuantity')
    .isFloat({ min: 0.1 })
    .withMessage('Fuel quantity must be greater than 0'),
  body('priceTotal')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('pricePerLiter')
    .isFloat({ min: 0 })
    .withMessage('Price per liter must be a positive number'),
  body('gstPaid')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('GST must be a positive number'),
  body('startMileage')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Start mileage must be a positive number'),
  body('vehicle')
    .trim()
    .isLength({ max: 50 })
    .withMessage('Vehicle name must not exceed 50 characters'),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { date, odometerKm, fuelQuantity, priceTotal, pricePerLiter, gstPaid, startMileage, vehicle } = req.body || {};
      const odometer = toNumber(odometerKm);
      const quantity = toNumber(fuelQuantity);
      const total = toNumber(priceTotal);
      let ppl = toNumber(pricePerLiter);
      const gst = toNumber(gstPaid) || 0;
      const startMile = startMileage ? toNumber(startMileage) : null;

      if (!date || Number.isNaN(odometer) || Number.isNaN(quantity) || Number.isNaN(total)) {
        return res.status(400).json({ error: 'date, odometerKm, fuelQuantity, and priceTotal are required and must be valid numbers' });
      }

    if (Number.isNaN(ppl) && quantity > 0) {
      ppl = Number((total / quantity).toFixed(3));
    }

    if (Number.isNaN(ppl)) {
      return res.status(400).json({ error: 'pricePerLiter is required when fuelQuantity is zero' });
    }

    const sql = `
      INSERT INTO trips (trip_date, odometer_km, fuel_quantity_l, price_total, price_per_liter, gst_paid, start_mileage, vehicle)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [date, odometer, quantity, total, ppl, gst, startMile, vehicle || 'Nissan Xtrail'];

    const [result] = await pool.execute(sql, values);

    res.status(201).json({ id: result.insertId, trip_date: date, odometer_km: odometer, fuel_quantity_l: quantity, price_total: total, price_per_liter: ppl, gst_paid: gst, start_mileage: startMile, vehicle: vehicle || 'Nissan Xtrail' });
  } catch (err) {
    console.error('Error creating trip', err);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

app.delete('/api/trips/:id', apiLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const tripId = toNumber(id);
    
    if (Number.isNaN(tripId)) {
      return res.status(400).json({ error: 'Invalid trip ID' });
    }

    const sql = 'DELETE FROM trips WHERE id = ?';
    const [result] = await pool.execute(sql, [tripId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.json({ message: 'Trip deleted successfully' });
  } catch (err) {
    console.error('Error deleting trip', err);
    res.status(500).json({ error: 'Failed to delete trip' });
  }
});

app.get('/api/daily-mileage', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, mileage_date, start_mileage, end_mileage, total_km, vehicle, created_at FROM daily_mileage ORDER BY mileage_date DESC, id DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching daily mileage', err);
    res.status(500).json({ error: 'Failed to fetch daily mileage' });
  }
});

app.post('/api/daily-mileage',
  apiLimiter,
  requireAuth,
  body('date')
    .isISO8601()
    .withMessage('Invalid date format'),
  body('startMileage')
    .isFloat({ min: 0 })
    .withMessage('Start mileage must be a positive number'),
  body('endMileage')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('End mileage must be a positive number'),
  body('vehicle')
    .trim()
    .isLength({ max: 50 })
    .withMessage('Vehicle name must not exceed 50 characters'),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { date, startMileage, endMileage, vehicle } = req.body || {};
      const start = toNumber(startMileage);
      const end = toNumber(endMileage);

      if (!date || Number.isNaN(start)) {
        return res.status(400).json({ error: 'date and startMileage are required and must be valid numbers' });
      }

      // If only start mileage, end is optional (will be null initially)
    const finalEnd = !Number.isNaN(end) ? end : null;

    if (finalEnd !== null && finalEnd < start) {
      return res.status(400).json({ error: 'End mileage cannot be less than start mileage' });
    }

    const sql = `
      INSERT INTO daily_mileage (mileage_date, start_mileage, end_mileage, vehicle)
      VALUES (?, ?, ?, ?)
    `;
    const values = [date, start, finalEnd, vehicle || 'Nissan Xtrail'];

    const [result] = await pool.execute(sql, values);
    const totalKm = finalEnd !== null ? finalEnd - start : null;

    res.status(201).json({ id: result.insertId, mileage_date: date, start_mileage: start, end_mileage: finalEnd, total_km: totalKm, vehicle: vehicle || 'Nissan Xtrail' });
  } catch (err) {
    console.error('Error creating daily mileage', err);
    res.status(500).json({ error: 'Failed to create daily mileage' });
  }
});

app.put('/api/daily-mileage/:id', apiLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { endMileage } = req.body || {};
    const mileageId = toNumber(id);
    const end = toNumber(endMileage);

    if (Number.isNaN(mileageId) || Number.isNaN(end)) {
      return res.status(400).json({ error: 'Valid ID and endMileage are required' });
    }

    // Fetch the existing record to check start mileage
    const [existing] = await pool.query('SELECT start_mileage FROM daily_mileage WHERE id = ?', [mileageId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Mileage record not found' });
    }

    const start = parseFloat(existing[0].start_mileage);
    if (end < start) {
      return res.status(400).json({ error: 'End mileage cannot be less than start mileage' });
    }

    const sql = 'UPDATE daily_mileage SET end_mileage = ? WHERE id = ?';
    await pool.execute(sql, [end, mileageId]);

    res.json({ message: 'Mileage record updated successfully', total_km: end - start });
  } catch (err) {
    console.error('Error updating daily mileage', err);
    res.status(500).json({ error: 'Failed to update daily mileage' });
  }
});

app.delete('/api/daily-mileage/:id', apiLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const mileageId = toNumber(id);
    
    if (Number.isNaN(mileageId)) {
      return res.status(400).json({ error: 'Invalid mileage ID' });
    }

    const sql = 'DELETE FROM daily_mileage WHERE id = ?';
    const [result] = await pool.execute(sql, [mileageId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Mileage record not found' });
    }

    res.json({ message: 'Mileage record deleted successfully' });
  } catch (err) {
    console.error('Error deleting daily mileage', err);
    res.status(500).json({ error: 'Failed to delete daily mileage' });
  }
});

app.get('/api/trips/export.xlsx', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT trip_date, vehicle, odometer_km, fuel_quantity_l, price_total, price_per_liter, gst_paid, start_mileage FROM trips ORDER BY trip_date DESC, id DESC'
    );

    const data = rows.map((row) => ({
      trip_date: formatDate(row.trip_date),
      vehicle: row.vehicle || 'Nissan Xtrail',
      odometer_km: row.odometer_km,
      fuel_quantity_l: row.fuel_quantity_l,
      price_total: row.price_total,
      price_per_liter: row.price_per_liter,
      gst_paid: row.gst_paid,
      start_mileage: row.start_mileage
    }));

    await sendWorkbook(
      res,
      'Fuel Purchases',
      [
        { header: 'Date', key: 'trip_date', width: 12 },
        { header: 'Vehicle', key: 'vehicle', width: 18 },
        { header: 'Odometer (km)', key: 'odometer_km', width: 14 },
        { header: 'Quantity (L)', key: 'fuel_quantity_l', width: 14 },
        { header: 'Total', key: 'price_total', width: 12 },
        { header: 'Price/L', key: 'price_per_liter', width: 12 },
        { header: 'GST Paid', key: 'gst_paid', width: 12 },
        { header: 'Start Mileage', key: 'start_mileage', width: 14 }
      ],
      data,
      'fuel-purchases.xlsx'
    );
  } catch (err) {
    console.error('Error exporting trips', err);
    res.status(500).json({ error: 'Failed to export trips' });
  }
});

app.get('/api/daily-mileage/export.xlsx', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT mileage_date, vehicle, start_mileage, end_mileage, total_km FROM daily_mileage ORDER BY mileage_date DESC, id DESC'
    );

    const data = rows.map((row) => ({
      mileage_date: formatDate(row.mileage_date),
      vehicle: row.vehicle || 'Nissan Xtrail',
      start_mileage: row.start_mileage,
      end_mileage: row.end_mileage,
      total_km: row.total_km
    }));

    await sendWorkbook(
      res,
      'Daily Records',
      [
        { header: 'Date', key: 'mileage_date', width: 12 },
        { header: 'Vehicle', key: 'vehicle', width: 18 },
        { header: 'Start (km)', key: 'start_mileage', width: 14 },
        { header: 'End (km)', key: 'end_mileage', width: 14 },
        { header: 'Total (km)', key: 'total_km', width: 12 }
      ],
      data,
      'daily-records.xlsx'
    );
  } catch (err) {
    console.error('Error exporting daily mileage', err);
    res.status(500).json({ error: 'Failed to export daily mileage' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

ensureTable()
  .then(() => {
    http.createServer(app).listen(port, () => {
      console.log(`Fuel tracker running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
