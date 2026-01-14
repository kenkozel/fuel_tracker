// Check authentication on page load
async function checkAuth() {
  try {
    const res = await fetch('api/auth/status');
    const data = await res.json();
    
    if (!data.authenticated) {
      window.location.href = 'login.html';
      return false;
    }

    // Display username
    document.getElementById('username-display').textContent = 'Welcome, ' + data.username;
    
    // Setup logout button
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('api/logout', { method: 'POST' });
      window.location.href = 'login.html';
    });

    return true;
  } catch (err) {
    window.location.href = 'login.html';
    return false;
  }
}

// Initialize auth before loading data
checkAuth().then(authed => {
  if (authed) {
    initialize();
  }
});

function initialize() {
const form = document.getElementById('trip-form');
const statusEl = document.getElementById('status');
const tableBody = document.querySelector('#trips-table tbody');
const refreshBtn = document.getElementById('refresh');
const tripsExportBtn = document.getElementById('trips-export');
const tripsPrevBtn = document.getElementById('trips-prev');
const tripsNextBtn = document.getElementById('trips-next');
const tripsPageInfo = document.getElementById('trips-page-info');
const tabTracker = document.getElementById('tab-tracker');
const tabUber = document.getElementById('tab-uber');
const trackerView = document.getElementById('tracker-view');
const uberView = document.getElementById('uber-view');

// Uber Mileage elements
const mileageForm = document.getElementById('mileage-form');
const mileageStatusEl = document.getElementById('mileage-status');
const mileageTableBody = document.querySelector('#mileage-table tbody');
const refreshMileageBtn = document.getElementById('refresh-mileage');
const mileagePrevBtn = document.getElementById('mileage-prev');
const mileageNextBtn = document.getElementById('mileage-next');
const mileagePageInfo = document.getElementById('mileage-page-info');
const mileageExportBtn = document.getElementById('mileage-export');

const TRIPS_PAGE_SIZE = 8;
let tripsRecords = [];
let tripsPage = 1;

const MILEAGE_PAGE_SIZE = 8;
let mileageRecords = [];
let mileagePage = 1;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#fca5a5' : '#a7f3d0';
}

function setMileageStatus(message, isError = false) {
  mileageStatusEl.textContent = message;
  mileageStatusEl.style.color = isError ? '#fca5a5' : '#a7f3d0';
}

async function downloadXlsx(url, filename, setStatusFn) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    setStatusFn('Export complete');
  } catch (err) {
    setStatusFn(err.message || 'Export failed', true);
  }
}

async function fetchTrips() {
  try {
    const res = await fetch('api/trips');
    if (!res.ok) throw new Error('Failed to fetch trips');
    const trips = await res.json();
    
    // Sort by date descending (latest first)
    trips.sort((a, b) => new Date(b.trip_date) - new Date(a.trip_date));

    // Compute totals
    let totalQuantity = 0;
    let totalPrice = 0;
    let totalGst = 0;
    trips.forEach((trip) => {
      totalQuantity += parseFloat(trip.fuel_quantity_l) || 0;
      totalPrice += parseFloat(trip.price_total) || 0;
      totalGst += parseFloat(trip.gst_paid) || 0;
    });

    document.getElementById('total-quantity').textContent = totalQuantity.toFixed(3);
    document.getElementById('total-price').textContent = `$${totalPrice.toFixed(2)}`;
    document.getElementById('total-gst').textContent = `$${totalGst.toFixed(2)}`;

    // Store and render paginated table
    tripsRecords = trips;
    tripsPage = 1;
    renderTripsPage();
  } catch (err) {
    setStatus(err.message || 'Failed to load trips', true);
  }
}

async function fetchMileage() {
  try {
    const res = await fetch('api/daily-mileage');
    if (!res.ok) throw new Error('Failed to fetch mileage');
    const records = await res.json();
    
    // Sort by date descending (latest first)
    records.sort((a, b) => new Date(b.mileage_date) - new Date(a.mileage_date));

    // Populate the record select dropdown with incomplete records
    const recordSelect = document.getElementById('record-id');
    recordSelect.innerHTML = '<option value="">-- Select --</option>';
    
    const totalsByVehicle = {
      'Nissan Xtrail': 0,
      'Nissan Sentra': 0,
      'Subaru Legacy': 0
    };

    records.forEach((record) => {
      // Only add incomplete records (where end_mileage is null)
      if (record.end_mileage === null) {
        const option = document.createElement('option');
        option.value = record.id;
        option.textContent = `${record.mileage_date.split('T')[0]} - Start: ${record.start_mileage} km`;
        recordSelect.appendChild(option);
      }

      const totalKmVal = parseFloat(record.total_km);
      const vehicleName = record.vehicle || 'Nissan Xtrail';
      if (Number.isFinite(totalKmVal) && vehicleName in totalsByVehicle) {
        totalsByVehicle[vehicleName] += totalKmVal;
      }
    });
    // Update totals by vehicle
    const totalEls = {
      'Nissan Xtrail': document.getElementById('total-nissan-xtrail'),
      'Nissan Sentra': document.getElementById('total-nissan-sentra'),
      'Subaru Legacy': document.getElementById('total-subaru-legacy')
    };
    Object.entries(totalEls).forEach(([name, el]) => {
      if (el) {
        const total = totalsByVehicle[name] || 0;
        el.textContent = total.toFixed(1);
      }
    });

    // Store and render paginated table
    mileageRecords = records;
    mileagePage = 1;
    renderMileagePage();
  } catch (err) {
    setMileageStatus(err.message || 'Failed to load mileage', true);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('Saving...');

  const payload = {
    date: document.getElementById('date').value,
    odometerKm: document.getElementById('odometer').value,
    fuelQuantity: document.getElementById('quantity').value,
    priceTotal: document.getElementById('total').value,
    pricePerLiter: document.getElementById('ppl').value,
    gstPaid: document.getElementById('gst').value,
    vehicle: document.getElementById('vehicle').value
  };

  try {
    const res = await fetch('api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to save trip');
    }

    form.reset();
    setStatus('Saved successfully');
    await fetchTrips();
  } catch (err) {
    setStatus(err.message || 'Failed to save trip', true);
  }
});

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchTrips);
}
if (refreshMileageBtn) {
  refreshMileageBtn.addEventListener('click', fetchMileage);
}

if (tripsExportBtn) {
  tripsExportBtn.addEventListener('click', () => downloadXlsx('api/trips/export.xlsx', 'fuel-purchases.xlsx', setStatus));
}

if (mileageExportBtn) {
  mileageExportBtn.addEventListener('click', () => downloadXlsx('api/daily-mileage/export.xlsx', 'daily-records.xlsx', setMileageStatus));
}

function renderTripsPage() {
  if (!Array.isArray(tripsRecords)) return;
  const totalPages = Math.max(1, Math.ceil(tripsRecords.length / TRIPS_PAGE_SIZE));
  tripsPage = Math.min(Math.max(1, tripsPage), totalPages);

  const start = (tripsPage - 1) * TRIPS_PAGE_SIZE;
  const pageItems = tripsRecords.slice(start, start + TRIPS_PAGE_SIZE);

  tableBody.innerHTML = '';

  pageItems.forEach((trip) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td data-label="Date">${trip.trip_date.split('T')[0]}</td>
      <td data-label="Vehicle">${trip.vehicle || 'Nissan Xtrail'}</td>
      <td data-label="Odometer (km)">${trip.odometer_km}</td>
      <td data-label="Quantity (L)">${trip.fuel_quantity_l}</td>
      <td data-label="Total">$${trip.price_total}</td>
      <td data-label="Price/L">$${trip.price_per_liter}</td>
      <td data-label="GST Paid">$${trip.gst_paid || 0}</td>
      <td data-label="Action">
        <button class="delete-btn" data-type="trip" data-id="${trip.id}" aria-label="Delete trip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m0 0v14a2 2 0 01-2 2H10a2 2 0 01-2-2V6m3 0v10m4-10v10"/>
          </svg>
        </button>
      </td>
    `;
    tableBody.appendChild(row);
  });

  // Attach delete handlers for current page
  document.querySelectorAll('.delete-btn[data-type="trip"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tripId = btn.getAttribute('data-id');
      if (confirm('Are you sure you want to delete this trip?')) {
        try {
          const res = await fetch(`api/trips/${tripId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete trip');
          setStatus('Trip deleted');
          await fetchTrips();
        } catch (err) {
          setStatus(err.message || 'Failed to delete trip', true);
        }
      }
    });
  });

  // Update pagination UI
  if (tripsPageInfo) {
    tripsPageInfo.textContent = `Page ${tripsRecords.length ? tripsPage : 0} of ${totalPages}`;
  }
  if (tripsPrevBtn) tripsPrevBtn.disabled = tripsPage <= 1;
  if (tripsNextBtn) tripsNextBtn.disabled = tripsPage >= totalPages;
}

if (tripsPrevBtn) {
  tripsPrevBtn.addEventListener('click', () => {
    if (tripsPage > 1) {
      tripsPage -= 1;
      renderTripsPage();
    }
  });
}

if (tripsNextBtn) {
  tripsNextBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(tripsRecords.length / TRIPS_PAGE_SIZE));
    if (tripsPage < totalPages) {
      tripsPage += 1;
      renderTripsPage();
    }
  });
}

function renderMileagePage() {
  if (!Array.isArray(mileageRecords)) return;
  const totalPages = Math.max(1, Math.ceil(mileageRecords.length / MILEAGE_PAGE_SIZE));
  mileagePage = Math.min(Math.max(1, mileagePage), totalPages);

  const start = (mileagePage - 1) * MILEAGE_PAGE_SIZE;
  const pageItems = mileageRecords.slice(start, start + MILEAGE_PAGE_SIZE);

  mileageTableBody.innerHTML = '';

  pageItems.forEach((record) => {
    const status = record.end_mileage === null ? 'In Progress' : 'Complete';
    const statusColor = record.end_mileage === null ? '#fbbf24' : '#86efac';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td data-label="Date">${record.mileage_date.split('T')[0]}</td>
      <td data-label="Vehicle">${record.vehicle || 'Nissan Xtrail'}</td>
      <td data-label="Start (km)">${record.start_mileage}</td>
      <td data-label="End (km)">${record.end_mileage !== null ? record.end_mileage : '--'}</td>
      <td data-label="Total (km)">${record.total_km !== null ? record.total_km : '--'}</td>
      <td data-label="Status" style="color: ${statusColor}; font-weight: 600;">${status}</td>
      <td data-label="Action">
        <button class="delete-btn" data-id="${record.id}" data-type="mileage" aria-label="Delete mileage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m0 0v14a2 2 0 01-2 2H10a2 2 0 01-2-2V6m3 0v10m4-10v10"/>
          </svg>
        </button>
      </td>
    `;
    mileageTableBody.appendChild(row);
  });

  // Attach delete handlers for current page
  document.querySelectorAll('.delete-btn[data-type="mileage"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recordId = btn.getAttribute('data-id');
      if (confirm('Are you sure you want to delete this mileage record?')) {
        try {
          const res = await fetch(`api/daily-mileage/${recordId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete mileage');
          setMileageStatus('Mileage record deleted');
          await fetchMileage();
        } catch (err) {
          setMileageStatus(err.message || 'Failed to delete mileage', true);
        }
      }
    });
  });

  // Update pagination UI
  if (mileagePageInfo) {
    mileagePageInfo.textContent = `Page ${mileageRecords.length ? mileagePage : 0} of ${totalPages}`;
  }
  if (mileagePrevBtn) mileagePrevBtn.disabled = mileagePage <= 1;
  if (mileageNextBtn) mileageNextBtn.disabled = mileagePage >= totalPages;
}

if (mileagePrevBtn) {
  mileagePrevBtn.addEventListener('click', () => {
    if (mileagePage > 1) {
      mileagePage -= 1;
      renderMileagePage();
    }
  });
}

if (mileageNextBtn) {
  mileageNextBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(mileageRecords.length / MILEAGE_PAGE_SIZE));
    if (mileagePage < totalPages) {
      mileagePage += 1;
      renderMileagePage();
    }
  });
}

// Handle mode switching for mileage form
const modeRadios = document.querySelectorAll('input[name="mode"]');
const startInputs = document.getElementById('start-inputs');
const endInputs = document.getElementById('end-inputs');

modeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.value === 'start') {
      startInputs.classList.remove('hidden');
      endInputs.classList.add('hidden');
      document.getElementById('start-mileage').required = true;
      document.getElementById('end-mileage').required = false;
      document.getElementById('record-id').required = false;
    } else if (radio.value === 'end') {
      startInputs.classList.add('hidden');
      endInputs.classList.remove('hidden');
      document.getElementById('start-mileage').required = false;
      document.getElementById('end-mileage').required = true;
      document.getElementById('record-id').required = true;
    }
  });
});

mileageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMileageStatus('Saving...');

  const mode = document.querySelector('input[name="mode"]:checked').value;

  try {
    if (mode === 'start') {
      // Create a new record with start mileage only
      const payload = {
        date: document.getElementById('mileage-date').value,
        vehicle: document.getElementById('mileage-vehicle').value,
        startMileage: document.getElementById('start-mileage').value
      };

      const res = await fetch('api/daily-mileage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to save start mileage');
      }

      mileageForm.reset();
      setMileageStatus('Start mileage logged successfully');
      await fetchMileage();
    } else if (mode === 'end') {
      // Update existing record with end mileage
      const recordId = document.getElementById('record-id').value;
      if (!recordId) {
        throw new Error('Please select a record to update');
      }

      const payload = {
        endMileage: document.getElementById('end-mileage').value
      };

      const res = await fetch(`api/daily-mileage/${recordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to save end mileage');
      }

      document.getElementById('end-mileage').value = '';
      document.getElementById('record-id').value = '';
      setMileageStatus('End mileage logged successfully');
      await fetchMileage();
    }
  } catch (err) {
    setMileageStatus(err.message || 'Failed to save mileage', true);
  }
});

// Initialize with today's date and data load
const today = new Date().toLocaleDateString('en-CA');
document.getElementById('date').value = today;
document.getElementById('mileage-date').value = today;
fetchTrips();
fetchMileage();

// Tab switching
function activateTab(target) {
  if (target === 'tracker') {
    tabTracker.classList.add('active');
    tabTracker.setAttribute('aria-selected', 'true');
    tabUber.classList.remove('active');
    tabUber.setAttribute('aria-selected', 'false');
    trackerView.classList.remove('hidden');
    uberView.classList.add('hidden');
    fetchTrips();
  } else if (target === 'uber') {
    tabUber.classList.add('active');
    tabUber.setAttribute('aria-selected', 'true');
    tabTracker.classList.remove('active');
    tabTracker.setAttribute('aria-selected', 'false');
    uberView.classList.remove('hidden');
    trackerView.classList.add('hidden');
    fetchMileage();
  }
  localStorage.setItem('activeTab', target);
}

tabTracker.addEventListener('click', () => activateTab('tracker'));
tabUber.addEventListener('click', () => activateTab('uber'));

// Restore active tab from localStorage
const savedTab = localStorage.getItem('activeTab') || 'uber';
activateTab(savedTab);
} // End of initialize() function