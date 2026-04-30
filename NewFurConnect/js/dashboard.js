document.addEventListener("DOMContentLoaded", function () {
  startPhilippineDateTimeClock();
  renderUpcomingAppointments();
  renderPatientRebookingRequests();
  renderLowStockAlerts();
  renderActivityLogs();
  initializeDashboardEvents();
});

/* TEMP DATA (papalitan later ng Firebase) */
let patientRecords = [];
let archivedAppointments = [];
let inventoryRecords = [];
let activityLogs = [];
let onlineAppointmentRequests = [];

/* ================= CLOCK ================= */
function startPhilippineDateTimeClock() {
  const el = document.getElementById("dashboardDateTime");
  if (!el) return;

  function update() {
    el.textContent = new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(new Date());
  }

  update();
  setInterval(update, 1000);
}

/* ================= HELPERS ================= */
function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(time) {
  if (!time) return "-";

  let [h, m] = time.split(":");
  h = parseInt(h);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;

  return `${h}:${m} ${ampm}`;
}

function formatSchedule(date, time) {
  if (!date) return "-";

  const d = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  return time ? `${d} ${formatTime(time)}` : d;
}

/* ================= APPOINTMENTS ================= */
function renderUpcomingAppointments() {
  const body = document.getElementById("upcomingAppointmentsBody");
  const counter = document.getElementById("dashboardAppointments");

  if (!body) return;

  const today = getTodayDateString();

  const data = patientRecords.filter(r =>
    !r.appointmentArchived && r.appointmentDate >= today
  );

  if (counter) counter.textContent = data.length;

  body.innerHTML = "";

  if (data.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="text-center">No appointments</td></tr>`;
    return;
  }

  data.forEach((rec, i) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${rec.id || ""}</td>
      <td>${rec.petName || ""}</td>
      <td>${rec.ownerName || ""}</td>
      <td>${formatSchedule(rec.appointmentDate, rec.appointmentTime)}</td>
      <td>${rec.appointmentType || ""}</td>
      <td>${rec.appointmentStatus || "Waiting"}</td>
      <td>
        <a href="records.html" class="btn btn-sm btn-primary">Edit</a>
      </td>
    `;

    body.appendChild(row);
  });
}

/* ================= REBOOKING ================= */
function renderPatientRebookingRequests() {
  const body = document.getElementById("patientRebookingRequestsBody");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="8" class="text-center">No requests</td></tr>`;
}

/* ================= INVENTORY ================= */
function renderLowStockAlerts() {
  const body = document.getElementById("lowStockBody");
  const count = document.getElementById("dashboardLowStockCount");

  if (!body) return;

  const low = inventoryRecords.filter(i => i.quantity <= 5);

  if (count) count.textContent = low.length;

  body.innerHTML = "";

  if (low.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="text-center">No low stock</td></tr>`;
    return;
  }

  low.forEach(item => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.itemName}</td>
      <td>${item.category}</td>
      <td>${item.quantity}</td>
    `;

    body.appendChild(row);
  });
}

/* ================= ACTIVITY ================= */
function addActivity(module, action, details) {
  activityLogs.unshift({
    dateTime: new Date().toISOString(),
    module,
    action,
    details
  });
}

function renderActivityLogs() {
  const body = document.getElementById("activityLogBody");
  if (!body) return;

  body.innerHTML = "";

  if (activityLogs.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="text-center">No activity</td></tr>`;
    return;
  }

  activityLogs.forEach(log => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${new Date(log.dateTime).toLocaleString()}</td>
      <td>${log.module}</td>
      <td>${log.action}</td>
      <td>${log.details}</td>
    `;

    body.appendChild(row);
  });
}

/* ================= EVENTS ================= */
function initializeDashboardEvents() {
  const clearBtn = document.getElementById("clearActivityLogsBtn");

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      activityLogs = [];
      renderActivityLogs();
    });
  }
}