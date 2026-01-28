const express = require('express');
const http = require('http');
const mysql = require('mysql2/promise');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

// Import routers
const authRouter = require('./routes/auth');
const tripsRouter = require('./routes/trips');
const dailyMileageRouter = require('./routes/dailyMileage');

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

// Make pool available to routes via app.set
app.set('pool', pool);

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

// Database table creation
async function ensureTable() {
  const createSql = `
    CREATE TABLE IF NOT EXISTS trips (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      trip_date DATE NOT NULL,
      odometer_km DECIMAL(10,1) NOT NULL,
      fuel_quantity_l DECIMAL(10,3) NOT NULL,
      price_total DECIMAL(10,2) NOT NULL,
      price_per_liter DECIMAL(10,3) NOT NULL,
      tax_paid DECIMAL(10,2) DEFAULT 0,
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

// Mount routers
app.use('/api', authRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/daily-mileage', dailyMileageRouter);

// 404 handler
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
