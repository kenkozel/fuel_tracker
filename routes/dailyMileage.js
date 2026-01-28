const express = require('express');
const { body, validationResult } = require('express-validator');
const { apiLimiter } = require('../middleware/rateLimiters');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// Validation error handler middleware
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
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

// GET /api/daily-mileage - List all daily mileage records
router.get('/', requireAuth, async (_req, res) => {
  try {
    const pool = _req.app.get('pool');
    const [rows] = await pool.query(
      'SELECT id, mileage_date, start_mileage, end_mileage, total_km, vehicle, created_at FROM daily_mileage ORDER BY mileage_date DESC, id DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching daily mileage', err);
    res.status(500).json({ error: 'Failed to fetch daily mileage' });
  }
});

// POST /api/daily-mileage - Create a new daily mileage record
router.post('/',
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

      const pool = req.app.get('pool');
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
  }
);

// PUT /api/daily-mileage/:id - Update end mileage
router.put('/:id', apiLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { endMileage } = req.body || {};
    const mileageId = toNumber(id);
    const end = toNumber(endMileage);

    if (Number.isNaN(mileageId) || Number.isNaN(end)) {
      return res.status(400).json({ error: 'Valid ID and endMileage are required' });
    }

    const pool = req.app.get('pool');

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

// DELETE /api/daily-mileage/:id - Delete a daily mileage record
router.delete('/:id', apiLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const mileageId = toNumber(id);
    
    if (Number.isNaN(mileageId)) {
      return res.status(400).json({ error: 'Invalid mileage ID' });
    }

    const pool = req.app.get('pool');
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

// GET /api/daily-mileage/export.xlsx - Export daily mileage to Excel
router.get('/export.xlsx', requireAuth, async (_req, res) => {
  try {
    const pool = _req.app.get('pool');
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

module.exports = router;
