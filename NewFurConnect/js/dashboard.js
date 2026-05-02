document.addEventListener("DOMContentLoaded", function () {
  startPhilippineDateTimeClock();
  renderUpcomingAppointments();
  renderPatientRebookingRequests();
  renderDashboardStats();
  initializeDashboardEvents();
});

/* ================= DATA ================= */
let patientRecords = [
  {
    id: 101,
    petName: "Bantay",
    ownerName: "Juan Dela Cruz",
    appointmentDate: "2026-05-30",
    appointmentTime: "09:00",
    appointmentType: "Grooming",
    appointmentStatus: "Waiting",
    appointmentArchived: false
  },
  {
    id: 102,
    petName: "Mingming",
    ownerName: "Maria Santos",
    appointmentDate: "2026-05-31",
    appointmentTime: "10:30",
    appointmentType: "Vaccination",
    appointmentStatus: "Confirmed",
    appointmentArchived: false
  }
];

let onlineAppointmentRequests = [
  {
    id: 201,
    petName: "Rocky",
    ownerName: "Pedro Reyes",
    service: "Grooming",
    requestedDate: "2026-06-02",
    requestedTime: "11:00",
    status: "Pending"
  }
];

/* ================= HELPERS ================= */
function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function formatTime(time) {
  let [h, m] = time.split(":");
  h = parseInt(h);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function formatSchedule(date, time) {
  return `${formatDate(date)} ${formatTime(time)}`;
}

/* ================= NOTIFICATION ================= */
function showNotification(message, type = "success") {
  const container = document.getElementById("notificationContainer");
  if (!container) return;

  const notif = document.createElement("div");
  notif.className = `notif ${type}`;
  notif.innerHTML = `<span>${message}</span>`;

  container.appendChild(notif);

  setTimeout(() => notif.classList.add("show"), 10);

  setTimeout(() => {
    notif.classList.remove("show");
    setTimeout(() => notif.remove(), 300);
  }, 3000);
}

/* ================= CLOCK ================= */
function startPhilippineDateTimeClock() {
  const el = document.getElementById("dashboardDateTime");

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

/* ================= UPCOMING ================= */
function renderUpcomingAppointments() {
  const body = document.getElementById("upcomingAppointmentsBody");
  if (!body) return;

  const searchValue = document.getElementById("upcomingSearch")?.value.toLowerCase() || "";

  body.innerHTML = "";

  patientRecords
    .filter(rec =>
      rec.id.toString().includes(searchValue) ||
      rec.petName.toLowerCase().includes(searchValue) ||
      rec.ownerName.toLowerCase().includes(searchValue) ||
      rec.appointmentType.toLowerCase().includes(searchValue) ||
      rec.appointmentStatus.toLowerCase().includes(searchValue) ||
      formatSchedule(rec.appointmentDate, rec.appointmentTime).toLowerCase().includes(searchValue)
    )
    .forEach(rec => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${rec.id}</td>
        <td>${rec.petName}</td>
        <td>${rec.ownerName}</td>
        <td>${formatSchedule(rec.appointmentDate, rec.appointmentTime)}</td>
        <td>${rec.appointmentType}</td>

        <td>
          <div class="status-dropdown">
            <button type="button" class="status-trigger">
              ${rec.appointmentStatus} ⌄
            </button>

            <div class="status-menu">
              <button data-id="${rec.id}" data-status="Waiting">Waiting</button>
              <button data-id="${rec.id}" data-status="Ongoing">Ongoing</button>
              <button data-id="${rec.id}" data-status="Finished">Finished</button>
              <button data-id="${rec.id}" data-status="Missed">Missed</button>
            </div>
          </div>
        </td>

        <td class="action-td">
          <div class="action-cell">
            <a href="records.html" class="btn btn-action btn-sm">Edit</a>
          </div>
        </td>
      `;

      body.appendChild(row);
    });
}

/* ================= REBOOKING ================= */
function renderPatientRebookingRequests() {
  const body = document.getElementById("patientRebookingRequestsBody");
  if (!body) return;

  const searchValue = document.getElementById("rebookingSearch")?.value.toLowerCase() || "";

  body.innerHTML = "";

  onlineAppointmentRequests
    .filter(req =>
      req.id.toString().includes(searchValue) ||
      req.petName.toLowerCase().includes(searchValue) ||
      req.ownerName.toLowerCase().includes(searchValue) ||
      req.service.toLowerCase().includes(searchValue) ||
      req.status.toLowerCase().includes(searchValue) ||
      formatDate(req.requestedDate).toLowerCase().includes(searchValue) ||
      formatTime(req.requestedTime).toLowerCase().includes(searchValue)
    )
    .forEach(req => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${req.id}</td>
        <td>${req.petName}</td>
        <td>${req.ownerName}</td>
        <td>${req.service}</td>
        <td>${formatDate(req.requestedDate)}</td>
        <td>${formatTime(req.requestedTime)}</td>
        <td>${req.status}</td>

        <td class="action-td">
          <div class="action-cell">
            <div class="action-dropdown">
              <button type="button" class="btn btn-action btn-sm dropdown-toggle-btn">
                Action
              </button>

              <div class="action-dropdown-menu">
                <button class="dropdown-item" data-action="approve" data-id="${req.id}">Approve</button>
                <button class="dropdown-item" data-action="decline" data-id="${req.id}">Decline</button>
              </div>
            </div>
          </div>
        </td>
      `;

      body.appendChild(row);
    });
}

/* ================= ACTION HANDLER ================= */
function handleRebooking(action, id) {
  const index = onlineAppointmentRequests.findIndex(r => r.id == id);
  if (index === -1) return;

  const req = onlineAppointmentRequests[index];

  if (action === "approve") {
    patientRecords.push({
      id: req.id,
      petName: req.petName,
      ownerName: req.ownerName,
      appointmentDate: req.requestedDate,
      appointmentTime: req.requestedTime,
      appointmentType: req.service,
      appointmentStatus: "Waiting"
    });

    showNotification("Approved successfully");
  }

  if (action === "decline") {
    showNotification("Declined successfully", "error");
  }

  onlineAppointmentRequests.splice(index, 1);

  renderUpcomingAppointments();
  renderPatientRebookingRequests();
}

/* ================= EVENTS ================= */
function initializeDashboardEvents() {
  document.addEventListener("click", function (e) {
    /* ACTION DROPDOWN */
    const actionBtn = e.target.closest(".dropdown-toggle-btn");

    if (actionBtn) {
      const drop = actionBtn.closest(".action-dropdown");

      document.querySelectorAll(".action-dropdown").forEach(d => {
        if (d !== drop) d.classList.remove("active");
      });

      drop.classList.toggle("active");
      return;
    }

    const actionItem = e.target.closest(".dropdown-item");

    if (actionItem) {
      handleRebooking(
        actionItem.dataset.action,
        actionItem.dataset.id
      );
      return;
    }

    /* STATUS DROPDOWN */
    const statusBtn = e.target.closest(".status-trigger");

    if (statusBtn) {
      const drop = statusBtn.closest(".status-dropdown");

      document.querySelectorAll(".status-dropdown").forEach(d => {
        if (d !== drop) d.classList.remove("active");
      });

      drop.classList.toggle("active");
      return;
    }

    const statusItem = e.target.closest(".status-menu button");

    if (statusItem) {
      const id = statusItem.dataset.id;
      const status = statusItem.dataset.status;

      const rec = patientRecords.find(r => r.id == id);
      if (rec) {
        rec.appointmentStatus = status;
        showNotification("Status updated");
        renderUpcomingAppointments();
      }
      return;
    }

    /* CLOSE ALL */
    document.querySelectorAll(".action-dropdown, .status-dropdown")
      .forEach(d => d.classList.remove("active"));
  });
}

const upcomingSearch = document.getElementById("upcomingSearch");
if (upcomingSearch) {
  upcomingSearch.addEventListener("input", renderUpcomingAppointments);
}

const rebookingSearch = document.getElementById("rebookingSearch");
if (rebookingSearch) {
  rebookingSearch.addEventListener("input", renderPatientRebookingRequests);
}

/* ================= STATS ================= */
function renderDashboardStats() {
  document.getElementById("totalPatients").textContent = patientRecords.length;
  document.getElementById("pendingRebooking").textContent = onlineAppointmentRequests.length;
}