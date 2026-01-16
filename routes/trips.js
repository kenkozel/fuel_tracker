const express = require('express');
const { body, validationResult } = require('express-validator');
const { apiLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Validation error handler middleware
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

// Middleware to check authentication
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

// Helper function to convert values to numbers
function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

// Helper function to format dates
function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

// Helper function to send Excel workbook
async function sendWorkbook(res, sheetName, columns, rows, filename) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns;
  rows.forEach((row) => sheet.addRow(row));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

// GET /api/trips - List all trips
router.get('/', requireAuth, async (_req, res) => {
  try {
    const pool = _req.app.get('pool');
    const [rows] = await pool.query(
      'SELECT id, trip_date, odometer_km, fuel_quantity_l, price_total, price_per_liter, gst_paid, start_mileage, vehicle, created_at FROM trips ORDER BY trip_date DESC, id DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching trips', err);
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

// POST /api/trips - Create a new trip
router.post('/',
  apiLimiter,
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
  requireAuth,
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

      const pool = req.app.get('pool');
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
  }
);

// DELETE /api/trips/:id - Delete a trip
router.delete('/:id', apiLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const tripId = toNumber(id);
    
    if (Number.isNaN(tripId)) {
      return res.status(400).json({ error: 'Invalid trip ID' });
    }

    const pool = req.app.get('pool');
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

// GET /api/trips/export.xlsx - Export trips to Excel
router.get('/export.xlsx', requireAuth, async (_req, res) => {
  try {
    const pool = _req.app.get('pool');
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

module.exports = router;
