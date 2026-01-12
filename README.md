# Fuel Tracker

A small Node.js + Express app to log fuel purchases and daily mileage into MySQL, with session-based authentication, input validation, rate limiting, and XLSX export.

## Features
- Fuel purchases: log date, vehicle, odometer, quantity, totals, GST.
- Daily mileage: log start and end mileage per day and vehicle.
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

If served under a subpath (e.g., `/fuel_tracker/`), the HTML uses `<base href="/fuel_tracker/">` so all asset and API requests are relative.

## API
Authentication (JSON):
- `POST /api/login` — body: `{ username, password }`
- `POST /api/logout`
- `GET /api/auth/status` — `{ authenticated: boolean, username?: string }`
- `POST /api/register` — body: `{ username, password }` (UI not exposed; use once to create an account)

Trips:
- `GET /api/trips` — list trips
- `POST /api/trips` — create
  ```json
  {
    "date": "2024-01-01",
    "odometerKm": 12345.6,
    "fuelQuantity": 40.123,
    "priceTotal": 210.50,
    "pricePerLiter": 5.245,
    "gstPaid": 10.25,
    "startMileage": 100000.0,
    "vehicle": "Nissan Xtrail"
  }
  ```
- `DELETE /api/trips/:id`
- `GET /api/trips/export.xlsx` — XLSX export

Daily Mileage:
- `GET /api/daily-mileage` — list records
- `POST /api/daily-mileage` — create start (and optional end)
  ```json
  {
    "date": "2024-01-01",
    "startMileage": 100000.0,
    "endMileage": 100125.3,
    "vehicle": "Nissan Xtrail"
  }
  ```
- `PUT /api/daily-mileage/:id` — set end mileage
  ```json
  { "endMileage": 100125.3 }
  ```
- `DELETE /api/daily-mileage/:id`
- `GET /api/daily-mileage/export.xlsx` — XLSX export

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
- Trips: `fuel-purchases.xlsx` with date, vehicle, odometer, quantity, totals, GST, start mileage.
- Daily Mileage: `daily-records.xlsx` with date, vehicle, start, end, total.
