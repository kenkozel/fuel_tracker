# Fuel Tracker

A small Node.js + Express app to log fuel purchases and daily mileage into MySQL, with session-based authentication, input validation, rate limiting, and XLSX export.

## Features
- Fuel purchases: log date, vehicle, odometer, quantity, totals, Tax.
- Daily mileage: log start and end mileage per day and vehicle.
- Reports: monthly summary by vehicle with totals, averages, and mobile-friendly cards.
- Authentication: session-based login; UI exposes login only.
- Validation: robust request validation on all write endpoints.
- Rate limiting: login and write endpoints throttled; reads unrestricted.
- Export: download trips and mileage as Excel workbooks.

## Requirements
- Node.js 18+
- MySQL 8+ (or compatible)

## Quick Start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   # edit .env
   ```
3. Create database:
   ```sql
   CREATE DATABASE IF NOT EXISTS fuel_tracker CHARACTER SET utf8mb4;
   ```
4. Create `users` table (required for auth):
   ```sql
   CREATE TABLE IF NOT EXISTS users (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     username VARCHAR(50) NOT NULL UNIQUE,
     password_hash VARCHAR(255) NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```
5. Start the app:
   ```bash
   npm start
   ```
   Runs on http://localhost:3001.

## Environment
Configure via `.env`:
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- `PORT` (default `3001`)
- `SESSION_SECRET` (use a strong, unique value)

## Database
The app ensures these tables on startup:
- `trips` — fuel purchases
- `daily_mileage` — daily start/end mileage records

The `users` table is not auto-created; create it using the SQL above.

## Frontend
- Login: [fuel_tracker/public/login.html](fuel_tracker/public/login.html)
- App: [fuel_tracker/public/index.html](fuel_tracker/public/index.html)
- Reports tab: filter by month/year and vehicle, view totals/stats; on mobile the summary shows stacked cards for readability.

If served under a subpath (e.g., `/fuel_tracker/`), the HTML uses `<base href="/fuel_tracker/">` so all asset and API requests are relative.

## API Endpoints

All API endpoints require session-based authentication (except `/api/register` and `/api/login`). Authentication is validated via session cookies set after login.

### Authentication

#### `POST /api/register`
Create a new user account (not exposed in UI; use for initial setup).

**Request Body:**
```json
{
  "username": "string (max 50 chars)",
  "password": "string (min 6 chars)"
}
```

**Response (201):**
```json
{
  "message": "User registered successfully",
  "userId": 1
}
```

**Rate Limit:** 5 requests per 15 minutes

---

#### `POST /api/login`
Authenticate user and create session.

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response (200):**
```json
{
  "message": "Login successful",
  "username": "string"
}
```

**Rate Limit:** 5 requests per 15 minutes

---

#### `POST /api/logout`
Destroy current session.

**Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

---

#### `GET /api/auth/status`
Check authentication status.

**Response (200):**
```json
{
  "authenticated": true,
  "username": "string"
}
```

---

### Fuel Trips

#### `GET /api/trips`
List all fuel purchase records.

**Response (200):**
```json
[
  {
    "id": 1,
    "trip_date": "2024-01-01",
    "odometer_km": 12345.6,
    "fuel_quantity_l": 40.123,
    "price_total": 210.50,
    "price_per_liter": 5.245,
    "tax_paid": 10.25,
    "start_mileage": 100000.0,
    "vehicle": "Nissan Xtrail",
    "created_at": "2024-01-01T12:00:00.000Z"
  }
]
```

---

#### `POST /api/trips`
Create a new fuel purchase record.

**Request Body:**
```json
{
  "date": "2024-01-01",
  "odometerKm": 12345.6,
  "fuelQuantity": 40.123,
  "priceTotal": 210.50,
  "pricePerLiter": 5.245,
  "taxPaid": 10.25,
  "startMileage": 100000.0,
  "vehicle": "Nissan Xtrail"
}
```

**Field Details:**
- `date` (required): ISO 8601 date format
- `odometerKm` (required): Positive number
- `fuelQuantity` (required): Min 0.1
- `priceTotal` (required): Positive number
- `pricePerLiter` (optional): Auto-calculated if omitted
- `taxPaid` (optional): Defaults to 0
- `startMileage` (optional): Positive number
- `vehicle` (optional): Max 50 chars, defaults to "Nissan Xtrail"

**Response (201):**
```json
{
  "id": 1,
  "trip_date": "2024-01-01",
  "odometer_km": 12345.6,
  "fuel_quantity_l": 40.123,
  "price_total": 210.50,
  "price_per_liter": 5.245,
  "tax_paid": 10.25,
  "start_mileage": 100000.0,
  "vehicle": "Nissan Xtrail"
}
```

**Rate Limit:** 20 requests per minute

---

#### `DELETE /api/trips/:id`
Delete a fuel purchase record.

**URL Parameters:**
- `id`: Trip ID

**Response (200):**
```json
{
  "message": "Trip deleted successfully"
}
```

**Rate Limit:** 20 requests per minute

---

#### `GET /api/trips/summary`
Get aggregated fuel purchase summary by vehicle for a date range.

**Query Parameters:**
- `startDate` (required): YYYY-MM-DD
- `endDate` (required): YYYY-MM-DD
- `vehicle` (optional): Filter by specific vehicle

**Response (200):**
```json
{
  "summary": [
    {
      "vehicle": "Nissan Xtrail",
      "total_quantity": 150.456,
      "total_cost": 789.50,
      "total_tax": 38.95,
      "total_km": 1250.5,
      "transaction_count": 5,
      "avg_price_per_liter": 5.245
    }
  ]
}
```

**Notes:**
- `total_km` is computed from `daily_mileage` table (sum of daily driven distance)
- Returns one row per vehicle that has trips in the date range

---

#### `GET /api/trips/export.xlsx`
Download all fuel purchases as Excel workbook.

**Response:** Binary XLSX file (`fuel-purchases.xlsx`)

**Columns:** Date, Vehicle, Odometer (km), Quantity (L), Total, Price/L, Tax Paid, Start Mileage

---

### Daily Mileage

#### `GET /api/daily-mileage`
List all daily mileage records.

**Response (200):**
```json
[
  {
    "id": 1,
    "mileage_date": "2024-01-01",
    "start_mileage": 100000.0,
    "end_mileage": 100125.3,
    "total_km": 125.3,
    "vehicle": "Nissan Xtrail",
    "created_at": "2024-01-01T12:00:00.000Z"
  }
]
```

**Notes:**
- `total_km` is a generated column (end - start)

---

#### `POST /api/daily-mileage`
Create a new daily mileage record.

**Request Body:**
```json
{
  "date": "2024-01-01",
  "startMileage": 100000.0,
  "endMileage": 100125.3,
  "vehicle": "Nissan Xtrail"
}
```

**Field Details:**
- `date` (required): ISO 8601 date format
- `startMileage` (required): Positive number
- `endMileage` (optional): If provided, must be >= startMileage
- `vehicle` (optional): Max 50 chars, defaults to "Nissan Xtrail"

**Response (201):**
```json
{
  "id": 1,
  "mileage_date": "2024-01-01",
  "start_mileage": 100000.0,
  "end_mileage": 100125.3,
  "total_km": 125.3,
  "vehicle": "Nissan Xtrail"
}
```

**Rate Limit:** 20 requests per minute

---

#### `PUT /api/daily-mileage/:id`
Update end mileage for an existing record.

**URL Parameters:**
- `id`: Mileage record ID

**Request Body:**
```json
{
  "endMileage": 100125.3
}
```

**Field Details:**
- `endMileage` (required): Must be >= start_mileage

**Response (200):**
```json
{
  "message": "Mileage record updated successfully",
  "total_km": 125.3
}
```

**Rate Limit:** 20 requests per minute

---

#### `DELETE /api/daily-mileage/:id`
Delete a daily mileage record.

**URL Parameters:**
- `id`: Mileage record ID

**Response (200):**
```json
{
  "message": "Mileage record deleted successfully"
}
```

**Rate Limit:** 20 requests per minute

---

#### `GET /api/daily-mileage/export.xlsx`
Download all daily mileage records as Excel workbook.

**Response:** Binary XLSX file (`daily-records.xlsx`)

**Columns:** Date, Vehicle, Start (km), End (km), Total (km)

## Deployment
- Reverse proxy: app sets `trust proxy` for compatibility.
- Subpath hosting: HTML `<base href>` set to `/fuel_tracker/`.
- HTTPS cookies: set `cookie.secure=true` when behind TLS.
- Process manager: use PM2 for uptime.

## Security Notes
- Use a strong `SESSION_SECRET`.
- Prefer a persistent session store for multi-process (e.g., Redis).
- Registration is not exposed in UI; keep single-user or restrict as needed.
- Validation and rate limiting protect write endpoints.

## Export Details
Downloads are generated via ExcelJS:
- Trips: `fuel-purchases.xlsx` with date, vehicle, odometer, quantity, totals, Tax, start mileage.
- Daily Mileage: `daily-records.xlsx` with date, vehicle, start, end, total.

## API Endpoint Quick Reference

1. `POST /api/register`
2. `POST /api/login`
3. `POST /api/logout`
4. `GET /api/auth/status`
5. `GET /api/trips`
6. `POST /api/trips`
7. `DELETE /api/trips/:id`
8. `GET /api/trips/summary`
9. `GET /api/trips/export.xlsx`
10. `GET /api/daily-mileage`
11. `POST /api/daily-mileage`
12. `PUT /api/daily-mileage/:id`
13. `DELETE /api/daily-mileage/:id`
14. `GET /api/daily-mileage/export.xlsx`
