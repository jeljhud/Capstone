document.addEventListener("DOMContentLoaded", function () {
  startPhilippineDateTimeClock();

  renderUpcomingAppointments();
  renderPatientRebookingRequests();
  renderInventoryRestockAlerts();
  renderRecentActivity();
  renderDashboardStats();

  initializeDashboardEditModal();
  initializeDashboardEvents();
});

/* ================= CONFIG ================= */
const DASHBOARD_ROWS_PER_PAGE = 8;

/* ================= STATE ================= */
let currentDashboardEditId = null;

let upcomingPage = 1;
let rebookingPage = 1;
let inventoryPage = 1;
let activityPage = 1;

let dashSelectedSlots = [];
let dashCalendarDate = new Date();

/* ================= DATA ================= */
let patientRecords = [];
let onlineAppointmentRequests = [];
let lowStockItems = [];
let recentActivities = [];

/* ================= FORMATTERS ================= */
function formatDate(date) {
  if (!date) return "-";

  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function formatTime(time) {
  if (!time) return "-";

  if (String(time).includes(",")) {
    const times = String(time)
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);

    if (times.length === 0) return "-";

    return `${formatSingleTime(times[0])} - ${formatSingleTime(times[times.length - 1])}`;
  }

  return formatSingleTime(time);
}

function formatSingleTime(time) {
  if (!time || !String(time).includes(":")) return "-";

  let [h, m] = time.split(":");
  h = parseInt(h, 10);

  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;

  return `${h}:${m} ${ampm}`;
}

function formatSchedule(date, time) {
  return `${formatDate(date)} ${formatTime(time)}`;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatSlotLabel(timeValue) {
  return formatSingleTime(timeValue);
}

/* ================= PAGINATION ================= */
function getPageItems(data, page) {
  const start = (page - 1) * DASHBOARD_ROWS_PER_PAGE;
  return data.slice(start, start + DASHBOARD_ROWS_PER_PAGE);
}

function updateDashboardShowingText(id, page, total) {
  const el = document.getElementById(id);
  if (!el) return;

  let label = "records";

  if (id === "upcomingShowingText") label = "appointments";
  if (id === "rebookingShowingText") label = "rebookings";
  if (id === "inventoryShowingText") label = "alerts";
  if (id === "activityShowingText") label = "activity";

  if (total === 0) {
    el.textContent = `No ${label}`;
    return;
  }

  const totalPages = Math.ceil(total / DASHBOARD_ROWS_PER_PAGE) || 1;

  el.textContent = `Page ${page} of ${totalPages} • ${total} ${label}`;
}

function renderDashboardPagination(id, page, total, callback) {
  const container = document.getElementById(id);
  if (!container) return;

  container.innerHTML = "";

  const totalPages = Math.ceil(total / DASHBOARD_ROWS_PER_PAGE) || 1;
  if (totalPages <= 1) return;

  const prev = document.createElement("button");
  prev.className = "logs-page-btn";
  prev.textContent = "Prev";
  prev.disabled = page === 1;
  prev.onclick = () => callback(page - 1);
  container.appendChild(prev);

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.className = `logs-page-btn ${i === page ? "active" : ""}`;
    btn.textContent = i;
    btn.onclick = () => callback(i);
    container.appendChild(btn);
  }

  const next = document.createElement("button");
  next.className = "logs-page-btn";
  next.textContent = "Next";
  next.disabled = page === totalPages;
  next.onclick = () => callback(page + 1);
  container.appendChild(next);
}

/* ================= NOTIFICATION ================= */
function showNotification(message, type = "success") {
  const container = document.getElementById("notificationContainer");
  if (!container) return;

  container.innerHTML = "";

  const notif = document.createElement("div");
  notif.className = `notif ${type}`;
  notif.textContent = message;

  container.appendChild(notif);

  setTimeout(() => notif.classList.add("hide"), 2200);
  setTimeout(() => notif.remove(), 2600);
}

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

/* ================= CLINIC SLOTS ================= */
function getClinicTimeSlots() {
  const slots = [];
  let hour = 9;
  let minute = 0;

  while (hour < 17 || (hour === 17 && minute === 0)) {
    slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);

    minute += 30;

    if (minute === 60) {
      minute = 0;
      hour++;
    }
  }

  return slots;
}

function getServiceDurationSlots(serviceType) {
  switch (serviceType) {
    case "Grooming":
      return 3;
    case "Vaccination":
      return 1;
    case "Deworming":
      return 1;
    case "Surgery":
      return 0;
    default:
      return 1;
  }
}

function isDashboardSlotTaken(date, time, currentId = null) {
  return patientRecords.some(record => {
    if (String(record.id) === String(currentId)) return false;
    if (record.appointmentDate !== date) return false;

    return String(record.appointmentTime || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
      .includes(time);
  });
}

function canDashboardAutoSelectSlots(date, startIndex, neededSlots, clinicSlots) {
  for (let i = 0; i < neededSlots; i++) {
    const slot = clinicSlots[startIndex + i];

    if (!slot) return false;
    if (isDashboardSlotTaken(date, slot, currentDashboardEditId)) return false;
  }

  return true;
}

/* ================= UPCOMING APPOINTMENTS ================= */
function renderUpcomingAppointments() {
  const body = document.getElementById("upcomingAppointmentsBody");
  if (!body) return;

  const searchValue = document.getElementById("upcomingSearch")?.value.toLowerCase().trim() || "";

  const filtered = patientRecords.filter(rec =>
    !rec.appointmentArchived &&
    (
      String(rec.id).toLowerCase().includes(searchValue) ||
      String(rec.petName || "").toLowerCase().includes(searchValue) ||
      String(rec.ownerName || "").toLowerCase().includes(searchValue) ||
      String(rec.appointmentType || "").toLowerCase().includes(searchValue) ||
      String(rec.appointmentStatus || "").toLowerCase().includes(searchValue) ||
      formatSchedule(rec.appointmentDate, rec.appointmentTime).toLowerCase().includes(searchValue)
    )
  );

  const totalPages = Math.ceil(filtered.length / DASHBOARD_ROWS_PER_PAGE) || 1;
  if (upcomingPage > totalPages) upcomingPage = totalPages;

  body.innerHTML = "";

  const pageItems = getPageItems(filtered, upcomingPage);

  if (pageItems.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4">
          No upcoming appointments found.
        </td>
      </tr>
    `;
  } else {
    pageItems.forEach(rec => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${rec.id}</td>
        <td>${rec.petName || "-"}</td>
        <td>${rec.ownerName || "-"}</td>
        <td>${formatSchedule(rec.appointmentDate, rec.appointmentTime)}</td>
        <td>${rec.appointmentType || "-"}</td>
        <td>
          <div class="status-dropdown">
            <button type="button" class="status-trigger">
              ${rec.appointmentStatus || "Waiting"} ⌄
            </button>

            <div class="status-menu">
              <button data-id="${rec.id}" data-status="Waiting">Waiting</button>
              <button data-id="${rec.id}" data-status="Ongoing">Ongoing</button>
              <button data-id="${rec.id}" data-status="Finished">Finished</button>
              <button data-id="${rec.id}" data-status="Missed">Missed</button>
            </div>
          </div>
        </td>
        <td>
          <button type="button" class="btn btn-action btn-sm dashboard-edit-btn" data-id="${rec.id}">
            Edit
          </button>
        </td>
      `;

      body.appendChild(row);
    });
  }

  updateDashboardShowingText("upcomingShowingText", upcomingPage, filtered.length);
  renderDashboardPagination("upcomingPagination", upcomingPage, filtered.length, page => {
    upcomingPage = page;
    renderUpcomingAppointments();
  });
}

/* ================= REBOOKING ================= */
function renderPatientRebookingRequests() {
  const body = document.getElementById("patientRebookingRequestsBody");
  if (!body) return;

  const searchValue = document.getElementById("rebookingSearch")?.value.toLowerCase().trim() || "";

  const filtered = onlineAppointmentRequests.filter(req =>
    String(req.id).toLowerCase().includes(searchValue) ||
    String(req.petName || "").toLowerCase().includes(searchValue) ||
    String(req.ownerName || "").toLowerCase().includes(searchValue) ||
    String(req.service || "").toLowerCase().includes(searchValue) ||
    String(req.status || "").toLowerCase().includes(searchValue) ||
    formatDate(req.requestedDate).toLowerCase().includes(searchValue) ||
    formatTime(req.requestedTime).toLowerCase().includes(searchValue)
  );

  const totalPages = Math.ceil(filtered.length / DASHBOARD_ROWS_PER_PAGE) || 1;
  if (rebookingPage > totalPages) rebookingPage = totalPages;

  body.innerHTML = "";

  const pageItems = getPageItems(filtered, rebookingPage);

  if (pageItems.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="8" class="text-center text-muted py-4">
          No patient rebooking requests found.
        </td>
      </tr>
    `;
  } else {
    pageItems.forEach(req => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${req.id}</td>
        <td>${req.petName || "-"}</td>
        <td>${req.ownerName || "-"}</td>
        <td>${req.service || "-"}</td>
        <td>${formatDate(req.requestedDate)}</td>
        <td>${formatTime(req.requestedTime)}</td>
        <td>${req.status || "Pending"}</td>
        <td>
          <div class="action-dropdown">
            <button type="button" class="btn btn-action btn-sm dropdown-toggle-btn">
              Action
            </button>

            <div class="action-dropdown-menu">
              <button class="dropdown-item" data-action="approve" data-id="${req.id}">Approve</button>
              <button class="dropdown-item" data-action="decline" data-id="${req.id}">Decline</button>
            </div>
          </div>
        </td>
      `;

      body.appendChild(row);
    });
  }

  updateDashboardShowingText("rebookingShowingText", rebookingPage, filtered.length);
  renderDashboardPagination("rebookingPagination", rebookingPage, filtered.length, page => {
    rebookingPage = page;
    renderPatientRebookingRequests();
  });
}

/* ================= INVENTORY ALERTS ================= */
function renderInventoryRestockAlerts() {
  const body = document.getElementById("lowStockBody");
  if (!body) return;

  const totalPages = Math.ceil(lowStockItems.length / DASHBOARD_ROWS_PER_PAGE) || 1;
  if (inventoryPage > totalPages) inventoryPage = totalPages;

  body.innerHTML = "";

  const pageItems = getPageItems(lowStockItems, inventoryPage);

  if (pageItems.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-muted py-4">
          No restock alerts found.
        </td>
      </tr>
    `;
  } else {
    pageItems.forEach(item => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${item.itemName || "-"}</td>
        <td>${item.category || "-"}</td>
        <td>${item.quantity || "0"}</td>
      `;

      body.appendChild(row);
    });
  }

  updateDashboardShowingText("inventoryShowingText", inventoryPage, lowStockItems.length);
  renderDashboardPagination("inventoryPagination", inventoryPage, lowStockItems.length, page => {
    inventoryPage = page;
    renderInventoryRestockAlerts();
  });
}

/* ================= RECENT ACTIVITY ================= */
function renderRecentActivity() {
  const body = document.getElementById("activityLogBody");
  if (!body) return;

  const totalPages = Math.ceil(recentActivities.length / DASHBOARD_ROWS_PER_PAGE) || 1;
  if (activityPage > totalPages) activityPage = totalPages;

  body.innerHTML = "";

  const pageItems = getPageItems(recentActivities, activityPage);

  if (pageItems.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="4" class="text-center text-muted py-4">
          No recent activity found.
        </td>
      </tr>
    `;
  } else {
    pageItems.forEach(log => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${log.dateTime || "-"}</td>
        <td>${log.module || "-"}</td>
        <td>${log.action || "-"}</td>
        <td>${log.details || "-"}</td>
      `;

      body.appendChild(row);
    });
  }

  updateDashboardShowingText("activityShowingText", activityPage, recentActivities.length);
  renderDashboardPagination("activityPagination", activityPage, recentActivities.length, page => {
    activityPage = page;
    renderRecentActivity();
  });
}

/* ================= DASHBOARD EDIT CALENDAR ================= */
function renderDashboardEditCalendar() {
  const monthLabel = document.getElementById("dashCalendarMonthLabel");
  const daysContainer = document.getElementById("dashAppointmentCalendarDays");
  const selectedDateInput = document.getElementById("dashEditDate");
  const selectedDateText = document.getElementById("dashAppointmentSelectedDateText");

  if (!monthLabel || !daysContainer) return;

  const year = dashCalendarDate.getFullYear();
  const month = dashCalendarDate.getMonth();

  monthLabel.textContent = dashCalendarDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });

  daysContainer.innerHTML = "";

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  let startDay = firstDay.getDay();
  startDay = startDay === 0 ? 6 : startDay - 1;

  for (let i = 0; i < startDay; i++) {
    const blank = document.createElement("div");
    blank.className = "calendar-day disabled";
    daysContainer.appendChild(blank);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalSlots = getClinicTimeSlots().length;

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateKey = formatDateKey(date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    const takenSlots = getClinicTimeSlots().filter(slot =>
      isDashboardSlotTaken(dateKey, slot, currentDashboardEditId)
    ).length;

    const isPastDate = date < today;
    const isFullSlots = takenSlots >= totalSlots;

    if (isPastDate) {
      button.classList.add("disabled");
      button.disabled = true;
      button.innerHTML = `
        <strong>${day}</strong>
        <small>Past Date</small>
      `;
      daysContainer.appendChild(button);
      continue;
    }

    if (isFullSlots) {
      button.classList.add("red");
    } else if (totalSlots - takenSlots <= 5) {
      button.classList.add("yellow");
    } else {
      button.classList.add("green");
    }

    if (selectedDateInput?.value === dateKey) {
      button.classList.add("selected");
    }

    button.innerHTML = `
      <strong>${day}</strong>
      <small>${isFullSlots ? "Full Slots" : `${takenSlots}/${totalSlots}`}</small>
    `;

    button.addEventListener("click", function () {
      if (button.disabled || isFullSlots) return;

      dashSelectedSlots = [];
      selectedDateInput.value = dateKey;
      document.getElementById("dashEditTime").value = "";

      selectedDateText.textContent = date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      }).toUpperCase();

      renderDashboardEditCalendar();
      renderDashboardEditTimeSlots();
    });

    daysContainer.appendChild(button);
  }
}

function renderDashboardEditTimeSlots() {
  const dateInput = document.getElementById("dashEditDate");
  const timeInput = document.getElementById("dashEditTime");
  const slotsContainer = document.getElementById("dashAppointmentTimeSlots");
  const serviceType = document.getElementById("dashEditService")?.value;

  if (!dateInput || !timeInput || !slotsContainer) return;

  slotsContainer.innerHTML = "";

  if (!dateInput.value) {
    slotsContainer.innerHTML = `<p class="text-muted mb-0">Please select a date first.</p>`;
    return;
  }

  const clinicSlots = getClinicTimeSlots();
  const neededSlots = getServiceDurationSlots(serviceType);

  clinicSlots.forEach((timeValue, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-slot-btn";
    button.textContent = formatSlotLabel(timeValue);

    const isTaken = isDashboardSlotTaken(dateInput.value, timeValue, currentDashboardEditId);

    if (isTaken) {
      button.disabled = true;
      button.classList.add("booked");
    }

    if (dashSelectedSlots.includes(timeValue)) {
      button.classList.add("active");
    }

    button.addEventListener("click", function () {
      if (isTaken) return;

      if (serviceType === "Surgery") {
        if (dashSelectedSlots.includes(timeValue)) {
          dashSelectedSlots = dashSelectedSlots.filter(slot => slot !== timeValue);
        } else {
          dashSelectedSlots.push(timeValue);
        }

        timeInput.value = dashSelectedSlots.join(",");
        renderDashboardEditTimeSlots();
        return;
      }

      if (!canDashboardAutoSelectSlots(dateInput.value, index, neededSlots, clinicSlots)) {
        showNotification("Not enough available slots.", "error");
        dashSelectedSlots = [];
        timeInput.value = "";
        renderDashboardEditTimeSlots();
        return;
      }

      dashSelectedSlots = clinicSlots.slice(index, index + neededSlots);
      timeInput.value = dashSelectedSlots.join(",");

      renderDashboardEditTimeSlots();
    });

    slotsContainer.appendChild(button);
  });
}

function initializeDashboardEditCalendarEvents() {
  document.getElementById("dashPrevCalendarMonth")?.addEventListener("click", function () {
    dashCalendarDate.setMonth(dashCalendarDate.getMonth() - 1);
    renderDashboardEditCalendar();
  });

  document.getElementById("dashNextCalendarMonth")?.addEventListener("click", function () {
    dashCalendarDate.setMonth(dashCalendarDate.getMonth() + 1);
    renderDashboardEditCalendar();
  });

  document.getElementById("dashEditService")?.addEventListener("change", function () {
    dashSelectedSlots = [];
    document.getElementById("dashEditTime").value = "";
    renderDashboardEditTimeSlots();
  });
}

/* ================= DASHBOARD EDIT MODAL ================= */
function openDashboardEditModal(id) {
  const record = patientRecords.find(r => String(r.id) === String(id));
  const modal = document.getElementById("dashboardEditModal");

  if (!record || !modal) return;

  currentDashboardEditId = record.id;

  dashSelectedSlots = String(record.appointmentTime || "")
    .split(",")
    .map(t => t.trim())
    .filter(Boolean);

  if (record.appointmentDate) {
    dashCalendarDate = new Date(record.appointmentDate);
  } else {
    dashCalendarDate = new Date();
  }

  setValue("dashEditId", record.id);
  setValue("dashEditPetName", record.petName);
  setValue("dashEditSpecies", record.petSpecies);
  setValue("dashEditBreed", record.breed);
  setValue("dashEditOwnerName", record.ownerName);
  setValue("dashEditContact", record.contactNumber);
  setValue("dashEditEmail", record.email);
  setValue("dashEditDate", record.appointmentDate);
  setValue("dashEditTime", record.appointmentTime);
  setValue("dashEditService", record.appointmentType);
  setValue("dashEditStatus", record.appointmentStatus || "Waiting");
  setValue("dashEditNotes", record.notes);

  setText("dashEditHeaderPetName", record.petName || "Pet Name");
  setText("dashEditHeaderOwner", record.ownerName || "Owner Name");
  setText("dashEditHeaderId", `P-${record.id}`);
  setText("dashEditAvatarLetter", (record.petName || "P").charAt(0).toUpperCase());

  const selectedDateText = document.getElementById("dashAppointmentSelectedDateText");

  if (record.appointmentDate && selectedDateText) {
    selectedDateText.textContent = new Date(record.appointmentDate).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).toUpperCase();
  } else if (selectedDateText) {
    selectedDateText.textContent = "Select a date to view slots";
  }

  renderDashboardEditCalendar();
  renderDashboardEditTimeSlots();

  modal.classList.remove("hidden");
}

function closeDashboardEditModal() {
  const modal = document.getElementById("dashboardEditModal");
  if (!modal) return;

  modal.classList.add("hidden");
  currentDashboardEditId = null;
  dashSelectedSlots = [];
}

function saveDashboardEdit(event) {
  event.preventDefault();

  const record = patientRecords.find(r => String(r.id) === String(currentDashboardEditId));
  if (!record) return;

  const service = getValue("dashEditService");
  const date = getValue("dashEditDate");
  const time = getValue("dashEditTime");

  if (!service || !date || !time) {
    showNotification("Please select service, date, and time.", "error");
    return;
  }

  record.petName = getValue("dashEditPetName").trim();
  record.petSpecies = getValue("dashEditSpecies").trim();
  record.breed = getValue("dashEditBreed").trim();
  record.ownerName = getValue("dashEditOwnerName").trim();
  record.contactNumber = getValue("dashEditContact").trim();
  record.email = getValue("dashEditEmail").trim();
  record.appointmentDate = date;
  record.appointmentTime = time;
  record.appointmentType = service;
  record.appointmentStatus = getValue("dashEditStatus");
  record.notes = getValue("dashEditNotes").trim();

  recentActivities.unshift({
    dateTime: new Date().toLocaleString(),
    module: "Appointment",
    action: "Edited Appointment",
    details: `${record.petName} appointment updated`
  });

  renderUpcomingAppointments();
  renderRecentActivity();
  renderDashboardStats();

  closeDashboardEditModal();
  showNotification("Appointment updated successfully");
}

function initializeDashboardEditModal() {
  const closeBtn = document.getElementById("closeDashboardEditModal");
  const cancelBtn = document.getElementById("cancelDashboardEditBtn");
  const form = document.getElementById("dashboardEditForm");

  if (closeBtn) closeBtn.addEventListener("click", closeDashboardEditModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeDashboardEditModal);
  if (form) form.addEventListener("submit", saveDashboardEdit);

  initializeDashboardEditCalendarEvents();
}

/* ================= ACTIONS ================= */
function handleRebooking(action, id) {
  const index = onlineAppointmentRequests.findIndex(r => String(r.id) === String(id));
  if (index === -1) return;

  const req = onlineAppointmentRequests[index];

  if (action === "approve") {
    patientRecords.push({
      id: req.id,
      petName: req.petName,
      petSpecies: "",
      breed: "",
      ownerName: req.ownerName,
      contactNumber: "",
      email: "",
      appointmentDate: req.requestedDate,
      appointmentTime: req.requestedTime,
      appointmentType: req.service,
      appointmentStatus: "Waiting",
      appointmentArchived: false,
      notes: ""
    });

    recentActivities.unshift({
      dateTime: new Date().toLocaleString(),
      module: "Appointment",
      action: "Approved Rebooking",
      details: `${req.petName} appointment approved`
    });

    showNotification("Rebooking approved successfully");
  }

  if (action === "decline") {
    recentActivities.unshift({
      dateTime: new Date().toLocaleString(),
      module: "Appointment",
      action: "Declined Rebooking",
      details: `${req.petName} rebooking declined`
    });

    showNotification("Rebooking declined successfully", "error");
  }

  onlineAppointmentRequests.splice(index, 1);

  renderUpcomingAppointments();
  renderPatientRebookingRequests();
  renderRecentActivity();
  renderDashboardStats();
}

/* ================= EVENTS ================= */
function initializeDashboardEvents() {
  const upcomingSearch = document.getElementById("upcomingSearch");
  const rebookingSearch = document.getElementById("rebookingSearch");
  const clearActivityBtn = document.getElementById("clearActivityLogsBtn");

  if (upcomingSearch) {
    upcomingSearch.addEventListener("input", function () {
      upcomingPage = 1;
      renderUpcomingAppointments();
    });
  }

  if (rebookingSearch) {
    rebookingSearch.addEventListener("input", function () {
      rebookingPage = 1;
      renderPatientRebookingRequests();
    });
  }

  if (clearActivityBtn) {
    clearActivityBtn.addEventListener("click", function () {
      recentActivities = [];
      activityPage = 1;
      renderRecentActivity();
      showNotification("Recent activity cleared successfully");
    });
  }

  document.addEventListener("click", function (e) {
    const dashboardEditBtn = e.target.closest(".dashboard-edit-btn");

    if (dashboardEditBtn) {
      openDashboardEditModal(dashboardEditBtn.dataset.id);
      return;
    }

    const actionBtn = e.target.closest(".dropdown-toggle-btn");

    if (actionBtn) {
      const drop = actionBtn.closest(".action-dropdown");

      document.querySelectorAll(".action-dropdown").forEach(d => {
        if (d !== drop) d.classList.remove("active");
      });

      document.querySelectorAll(".status-dropdown").forEach(d => d.classList.remove("active"));

      drop.classList.toggle("active");
      return;
    }

    const actionItem = e.target.closest(".dropdown-item");

    if (actionItem) {
      handleRebooking(actionItem.dataset.action, actionItem.dataset.id);
      return;
    }

    const statusBtn = e.target.closest(".status-trigger");

    if (statusBtn) {
      const drop = statusBtn.closest(".status-dropdown");

      document.querySelectorAll(".status-dropdown").forEach(d => {
        if (d !== drop) d.classList.remove("active");
      });

      document.querySelectorAll(".action-dropdown").forEach(d => d.classList.remove("active"));

      drop.classList.toggle("active");
      return;
    }

    const statusItem = e.target.closest(".status-menu button");

    if (statusItem) {
      const id = statusItem.dataset.id;
      const status = statusItem.dataset.status;

      const rec = patientRecords.find(r => String(r.id) === String(id));

      if (rec) {
        rec.appointmentStatus = status;

        recentActivities.unshift({
          dateTime: new Date().toLocaleString(),
          module: "Appointment",
          action: "Status Updated",
          details: `${rec.petName} marked as ${status}`
        });

        showNotification(`Appointment status changed to ${status}`);
        renderUpcomingAppointments();
        renderRecentActivity();
      }

      return;
    }

    document.querySelectorAll(".action-dropdown, .status-dropdown")
      .forEach(d => d.classList.remove("active"));
  });
}

/* ================= STATS ================= */
function renderDashboardStats() {
  const totalPatients = document.getElementById("totalPatients");
  const todayAppointments = document.getElementById("todayAppointments");
  const pendingRebooking = document.getElementById("pendingRebooking");

  if (totalPatients) totalPatients.textContent = patientRecords.length;
  if (todayAppointments) todayAppointments.textContent = patientRecords.filter(r => !r.appointmentArchived).length;
  if (pendingRebooking) pendingRebooking.textContent = onlineAppointmentRequests.length;
}

/* ================= HELPERS ================= */
function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}