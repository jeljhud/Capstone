document.addEventListener("DOMContentLoaded", async function () {
  startPhilippineDateTimeClock();

  await syncDashboardFromFirebaseToLocalStorage();
  loadDashboardLocalStorage();

  renderUpcomingAppointments();
  renderPatientRebookingRequests();
  renderInventoryRestockAlerts();
  renderRecentActivity();
  renderDashboardStats();

  initializeDashboardEditModal();
  initializeFinishAppointmentModalEvents();
  initializeDashboardEvents();
});

/* ================= CONFIG ================= */
const DASHBOARD_ROWS_PER_PAGE = 8;

/* ================= STATE ================= */
let currentDashboardEditId = null;
let pendingFinishedAppointmentId = null;

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
let archivedAppointments = [];

/* ================= LOCAL STORAGE ================= */
const DASHBOARD_STORAGE_KEYS = {
  patientRecords: "patientRecords",
  onlineAppointmentRequests: "onlineAppointmentRequests",
  lowStockItems: "lowStockItems",
  recentActivities: "recentActivities",
  archivedAppointments: "archivedAppointments"
};

function getLocalStorageArray(key) {
  try {
    const storedData = localStorage.getItem(key);

    if (!storedData) return [];

    const parsedData = JSON.parse(storedData);

    return Array.isArray(parsedData) ? parsedData : [];
  } catch (error) {
    console.error("LocalStorage read error:", error);
    return [];
  }
}

function setLocalStorageArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("LocalStorage save error:", error);
  }
}

function loadDashboardLocalStorage() {
  patientRecords = getLocalStorageArray(DASHBOARD_STORAGE_KEYS.patientRecords)
    .filter(function (record) {
      return !isPatientArchived(record);
    });

  patientRecords = sortDashboardRecordsLifo(patientRecords);

  onlineAppointmentRequests = getLocalStorageArray(
    DASHBOARD_STORAGE_KEYS.onlineAppointmentRequests
  );

  lowStockItems = getLocalStorageArray(DASHBOARD_STORAGE_KEYS.lowStockItems);
  recentActivities = getLocalStorageArray(DASHBOARD_STORAGE_KEYS.recentActivities);
  archivedAppointments = getLocalStorageArray(DASHBOARD_STORAGE_KEYS.archivedAppointments);
}

function saveDashboardLocalStorage() {
  patientRecords = sortDashboardRecordsLifo(
    patientRecords.filter(function (record) {
      return !isPatientArchived(record);
    })
  );

  archivedAppointments = sortArchivedAppointmentsLifo(archivedAppointments);

  setLocalStorageArray(DASHBOARD_STORAGE_KEYS.patientRecords, patientRecords);
  setLocalStorageArray(DASHBOARD_STORAGE_KEYS.onlineAppointmentRequests, onlineAppointmentRequests);
  setLocalStorageArray(DASHBOARD_STORAGE_KEYS.lowStockItems, lowStockItems);
  setLocalStorageArray(DASHBOARD_STORAGE_KEYS.recentActivities, recentActivities);
  setLocalStorageArray(DASHBOARD_STORAGE_KEYS.archivedAppointments, archivedAppointments);
}

async function syncDashboardFromFirebaseToLocalStorage() {
  if (!window.db) {
    console.warn("Firestore is not ready. Dashboard will use localStorage only.");
    return;
  }

  try {
    const patientSnapshot = await window.db.collection("patientRecords").get();

    const firebasePatientRecords = patientSnapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt),
        updatedAt: normalizeFirebaseDate(data.updatedAt),
        appointmentCreatedAt: normalizeFirebaseDate(data.appointmentCreatedAt),
        appointmentUpdatedAt: normalizeFirebaseDate(data.appointmentUpdatedAt),
        appointmentLoggedAt: normalizeFirebaseDate(data.appointmentLoggedAt)
      };
    });

    const activePatients = firebasePatientRecords.filter(function (record) {
      return !isPatientArchived(record);
    });

    setLocalStorageArray(
      DASHBOARD_STORAGE_KEYS.patientRecords,
      sortDashboardRecordsLifo(activePatients)
    );

    const activitySnapshot = await window.db.collection("recentActivities").get();

    const firebaseActivities = activitySnapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt)
      };
    });

    setLocalStorageArray(
      DASHBOARD_STORAGE_KEYS.recentActivities,
      firebaseActivities.sort(function (a, b) {
        return getActivitySortTime(b) - getActivitySortTime(a);
      })
    );

    const logsSnapshot = await window.db.collection("archivedAppointments").get();

    const firebaseLogs = logsSnapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt),
        archivedAt: normalizeFirebaseDate(data.archivedAt),
        appointmentArchivedAt: normalizeFirebaseDate(data.appointmentArchivedAt),
        loggedAt: normalizeFirebaseDate(data.loggedAt)
      };
    });

    setLocalStorageArray(
      DASHBOARD_STORAGE_KEYS.archivedAppointments,
      sortArchivedAppointmentsLifo(firebaseLogs)
    );

    console.log("Dashboard Firebase sync complete.");
  } catch (error) {
    console.error("Dashboard Firebase sync error:", error);
    showNotification("Failed to sync dashboard from Firebase.", "warning");
  }
}

function normalizeFirebaseDate(value) {
  if (!value) return "";

  if (value.toDate) {
    return value.toDate().toISOString();
  }

  return value;
}

async function getPatientFirebaseDocRef(recordOrId) {
  if (!window.db) {
    throw new Error("Firestore is not initialized.");
  }

  const firebaseDocId =
    typeof recordOrId === "object" ? recordOrId.firebaseDocId : "";

  const patientId =
    typeof recordOrId === "object" ? recordOrId.id : recordOrId;

  if (firebaseDocId) {
    return window.db.collection("patientRecords").doc(firebaseDocId);
  }

  const snapshot = await window.db
    .collection("patientRecords")
    .where("id", "==", String(patientId))
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new Error("Patient document not found in Firebase.");
  }

  return snapshot.docs[0].ref;
}

async function updatePatientRecordInFirebase(recordOrId, updates) {
  const docRef = await getPatientFirebaseDocRef(recordOrId);

  await docRef.update({
    ...updates,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function saveRecentActivityToFirebase(activity) {
  if (!window.db) return;

  await window.db.collection("recentActivities").add({
    ...activity,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function saveArchivedAppointmentLogToFirebase(logRecord) {
  if (!window.db) return;

  await window.db.collection("archivedAppointments").add({
    ...logRecord,
    firebaseCreatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/* ================= FORMATTERS ================= */
function formatDate(date) {
  if (!date) return "-";

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return parsedDate.toLocaleDateString("en-US", {
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
      .map(function (item) {
        return item.trim();
      })
      .filter(Boolean);

    if (times.length === 0) return "-";

    return `${formatSingleTime(times[0])} - ${formatSingleTime(times[times.length - 1])}`;
  }

  return formatSingleTime(time);
}

function formatSingleTime(time) {
  if (!time || !String(time).includes(":")) return "-";

  let [h, m] = String(time).split(":");
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
  prev.onclick = function () {
    callback(page - 1);
  };
  container.appendChild(prev);

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.className = `logs-page-btn ${i === page ? "active" : ""}`;
    btn.textContent = i;
    btn.onclick = function () {
      callback(i);
    };
    container.appendChild(btn);
  }

  const next = document.createElement("button");
  next.className = "logs-page-btn";
  next.textContent = "Next";
  next.disabled = page === totalPages;
  next.onclick = function () {
    callback(page + 1);
  };
  container.appendChild(next);
}

/* ================= NOTIFICATION ================= */
function showNotification(message, type = "success") {
  let container = document.getElementById("notificationContainer");

  if (!container) {
    container = document.createElement("div");
    container.id = "notificationContainer";
    container.className = "notif-container";
    document.body.appendChild(container);
  }

  const notif = document.createElement("div");
  notif.className = `notif notif-${type}`;
  notif.textContent = message;

  const colors = {
    success: "#1b7f89",
    warning: "#d89b00",
    danger: "#dc3545",
    error: "#dc3545",
    info: "#0f6d7a"
  };

  notif.style.background = colors[type] || colors.success;

  container.appendChild(notif);

  setTimeout(function () {
    notif.classList.add("hide");

    setTimeout(function () {
      notif.remove();
    }, 250);
  }, 2600);
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

function getRecordAppointmentSlots(record) {
  return String(record.appointmentTime || "")
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

function isDashboardSlotTaken(date, time, currentId = null) {
  return patientRecords.some(function (record) {
    if (String(record.id) === String(currentId)) return false;
    if (!isActiveAppointment(record)) return false;
    if (String(record.appointmentDate || "") !== String(date)) return false;

    return getRecordAppointmentSlots(record).includes(time);
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
  loadDashboardLocalStorage();

  const body = document.getElementById("upcomingAppointmentsBody");
  if (!body) return;

  const searchValue =
    document.getElementById("upcomingSearch")?.value.toLowerCase().trim() || "";

  const filtered = patientRecords
    .filter(isActiveAppointment)
    .filter(function (rec) {
      const searchableText = [
        rec.id,
        rec.petName,
        rec.ownerName,
        rec.appointmentDate,
        rec.appointmentTime,
        rec.appointmentType,
        rec.appointmentStatus,
        formatSchedule(rec.appointmentDate, rec.appointmentTime)
      ]
        .join(" ")
        .toLowerCase();

      return searchValue === "" || searchableText.includes(searchValue);
    })
    .sort(function (a, b) {
      return getDashboardRecordSortTime(b) - getDashboardRecordSortTime(a);
    });

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
    pageItems.forEach(function (rec) {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${escapeHTML(rec.id)}</td>
        <td>${escapeHTML(rec.petName || "-")}</td>
        <td>${escapeHTML(rec.ownerName || "-")}</td>
        <td>${escapeHTML(formatSchedule(rec.appointmentDate, rec.appointmentTime))}</td>
        <td>${escapeHTML(rec.appointmentType || "-")}</td>
        <td>
          <div class="status-dropdown">
            <button type="button" class="status-trigger">
              ${escapeHTML(rec.appointmentStatus || "Waiting")} ⌄
            </button>

            <div class="status-menu">
              <button data-id="${escapeHTML(rec.id)}" data-status="Waiting">Waiting</button>
              <button data-id="${escapeHTML(rec.id)}" data-status="Ongoing">Ongoing</button>
              <button data-id="${escapeHTML(rec.id)}" data-status="Finished">Finished</button>
              <button data-id="${escapeHTML(rec.id)}" data-status="Missed">Missed</button>
            </div>
          </div>
        </td>
        <td>
          <button type="button" class="btn btn-action btn-sm dashboard-edit-btn" data-id="${escapeHTML(rec.id)}">
            Edit
          </button>
        </td>
      `;

      body.appendChild(row);
    });
  }

  updateDashboardShowingText("upcomingShowingText", upcomingPage, filtered.length);
  renderDashboardPagination("upcomingPagination", upcomingPage, filtered.length, function (page) {
    upcomingPage = page;
    renderUpcomingAppointments();
  });
}

/* ================= REBOOKING ================= */
function renderPatientRebookingRequests() {
  const body = document.getElementById("patientRebookingRequestsBody");
  if (!body) return;

  const searchValue =
    document.getElementById("rebookingSearch")?.value.toLowerCase().trim() || "";

  const filtered = onlineAppointmentRequests
    .filter(function (req) {
      const searchableText = [
        req.id,
        req.patientId,
        req.petName,
        req.ownerName,
        req.service,
        req.status,
        req.requestedDate,
        req.requestedTime,
        formatDate(req.requestedDate),
        formatTime(req.requestedTime)
      ]
        .join(" ")
        .toLowerCase();

      return searchValue === "" || searchableText.includes(searchValue);
    })
    .sort(function (a, b) {
      return getRequestSortTime(b) - getRequestSortTime(a);
    });

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
    pageItems.forEach(function (req) {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${escapeHTML(req.patientId || req.id || "")}</td>
        <td>${escapeHTML(req.petName || "-")}</td>
        <td>${escapeHTML(req.ownerName || "-")}</td>
        <td>${escapeHTML(req.service || "-")}</td>
        <td>${escapeHTML(formatDate(req.requestedDate))}</td>
        <td>${escapeHTML(formatTime(req.requestedTime))}</td>
        <td>${escapeHTML(req.status || "Pending")}</td>
        <td>
          <div class="action-dropdown">
            <button type="button" class="btn btn-action btn-sm dropdown-toggle-btn">
              Action
            </button>

            <div class="action-dropdown-menu">
              <button class="dropdown-item" data-action="approve" data-id="${escapeHTML(req.requestId || req.id)}">Approve</button>
              <button class="dropdown-item" data-action="decline" data-id="${escapeHTML(req.requestId || req.id)}">Decline</button>
            </div>
          </div>
        </td>
      `;

      body.appendChild(row);
    });
  }

  updateDashboardShowingText("rebookingShowingText", rebookingPage, filtered.length);
  renderDashboardPagination("rebookingPagination", rebookingPage, filtered.length, function (page) {
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
    pageItems.forEach(function (item) {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${escapeHTML(item.itemName || "-")}</td>
        <td>${escapeHTML(item.category || "-")}</td>
        <td>${escapeHTML(item.quantity || "0")}</td>
      `;

      body.appendChild(row);
    });
  }

  updateDashboardShowingText("inventoryShowingText", inventoryPage, lowStockItems.length);
  renderDashboardPagination("inventoryPagination", inventoryPage, lowStockItems.length, function (page) {
    inventoryPage = page;
    renderInventoryRestockAlerts();
  });
}

/* ================= RECENT ACTIVITY ================= */
function renderRecentActivity() {
  const body = document.getElementById("activityLogBody");
  if (!body) return;

  recentActivities = recentActivities.sort(function (a, b) {
    return getActivitySortTime(b) - getActivitySortTime(a);
  });

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
    pageItems.forEach(function (log) {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${escapeHTML(log.dateTime || "-")}</td>
        <td>${escapeHTML(log.module || "-")}</td>
        <td>${escapeHTML(log.action || "-")}</td>
        <td>${escapeHTML(log.details || "-")}</td>
      `;

      body.appendChild(row);
    });
  }

  updateDashboardShowingText("activityShowingText", activityPage, recentActivities.length);
  renderDashboardPagination("activityPagination", activityPage, recentActivities.length, function (page) {
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

    const takenSlots = getClinicTimeSlots().filter(function (slot) {
      return isDashboardSlotTaken(dateKey, slot, currentDashboardEditId);
    }).length;

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

      if (selectedDateInput) {
        selectedDateInput.value = dateKey;
      }

      const dashEditTime = document.getElementById("dashEditTime");

      if (dashEditTime) {
        dashEditTime.value = "";
      }

      if (selectedDateText) {
        selectedDateText.textContent = date.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric"
        }).toUpperCase();
      }

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

  if (!serviceType) {
    slotsContainer.innerHTML = `<p class="text-muted mb-0">Please select a service first.</p>`;
    return;
  }

  if (!dateInput.value) {
    slotsContainer.innerHTML = `<p class="text-muted mb-0">Please select a date first.</p>`;
    return;
  }

  const clinicSlots = getClinicTimeSlots();
  const neededSlots = getServiceDurationSlots(serviceType);

  clinicSlots.forEach(function (timeValue, index) {
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
          dashSelectedSlots = dashSelectedSlots.filter(function (slot) {
            return slot !== timeValue;
          });
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

    const dashEditTime = document.getElementById("dashEditTime");

    if (dashEditTime) {
      dashEditTime.value = "";
    }

    renderDashboardEditTimeSlots();
  });
}

/* ================= DASHBOARD EDIT MODAL ================= */
function openDashboardEditModal(id) {
  const record = patientRecords.find(function (item) {
    return String(item.id) === String(id);
  });

  const modal = document.getElementById("dashboardEditModal");

  if (!record || !modal) return;

  currentDashboardEditId = record.id;

  dashSelectedSlots = String(record.appointmentTime || "")
    .split(",")
    .map(function (item) {
      return item.trim();
    })
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

async function saveDashboardEdit(event) {
  event.preventDefault();

  const record = patientRecords.find(function (item) {
    return String(item.id) === String(currentDashboardEditId);
  });

  if (!record) return;

  const service = getValue("dashEditService");
  const date = getValue("dashEditDate");
  const time = getValue("dashEditTime");

  if (!service || !date || !time) {
    showNotification("Please select service, date, and time.", "error");
    return;
  }

  const now = new Date().toISOString();

  const updates = {
    petName: getValue("dashEditPetName").trim(),
    petSpecies: getValue("dashEditSpecies").trim(),
    breed: getValue("dashEditBreed").trim(),
    ownerName: getValue("dashEditOwnerName").trim(),
    contactNumber: getValue("dashEditContact").trim(),
    email: getValue("dashEditEmail").trim(),

    appointmentDate: date,
    appointmentTime: time,
    appointmentType: service,
    appointmentStatus: getValue("dashEditStatus") || "Waiting",

    notes: getValue("dashEditNotes").trim(),
    appointmentUpdatedAt: now,
    updatedAt: now
  };

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Appointment",
    action: "Edited Appointment",
    details: `${updates.petName || "Patient"} appointment updated`
  };

  try {
    await updatePatientRecordInFirebase(record, updates);
    await saveRecentActivityToFirebase(activity);

    Object.assign(record, updates);

    recentActivities.unshift(activity);

    saveDashboardLocalStorage();

    renderUpcomingAppointments();
    renderRecentActivity();
    renderDashboardStats();

    closeDashboardEditModal();
    showNotification("Appointment updated successfully");
  } catch (error) {
    console.error("Firebase dashboard edit error:", error);
    showNotification("Failed to update appointment in Firebase.", "error");
  }
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

/* ================= FINISH APPOINTMENT NOTES MODAL ================= */
function openFinishAppointmentModal(id) {
  const record = patientRecords.find(function (item) {
    return String(item.id) === String(id);
  });

  const modal = document.getElementById("finishAppointmentModal");
  const idInput = document.getElementById("finishAppointmentId");
  const notesInput = document.getElementById("finishAppointmentNotes");
  const details = document.getElementById("finishAppointmentDetails");

  if (!record || !modal || !idInput || !notesInput) return;

  pendingFinishedAppointmentId = id;

  idInput.value = id;
  notesInput.value = record.notes || "";

  if (details) {
    details.textContent = `Add notes for ${record.petName || "this pet"} before marking this appointment as finished.`;
  }

  document.querySelectorAll(".status-dropdown").forEach(function (item) {
    item.classList.remove("active");
  });

  modal.classList.remove("hidden");
  notesInput.focus();
}

function closeFinishAppointmentModal() {
  const modal = document.getElementById("finishAppointmentModal");
  const idInput = document.getElementById("finishAppointmentId");
  const notesInput = document.getElementById("finishAppointmentNotes");

  if (modal) modal.classList.add("hidden");
  if (idInput) idInput.value = "";
  if (notesInput) notesInput.value = "";

  pendingFinishedAppointmentId = null;
}

async function saveFinishedAppointmentNotes(event) {
  event.preventDefault();

  const id =
    document.getElementById("finishAppointmentId")?.value ||
    pendingFinishedAppointmentId;

  const notes =
    document.getElementById("finishAppointmentNotes")?.value.trim() || "";

  const index = patientRecords.findIndex(function (item) {
    return String(item.id) === String(id);
  });

  if (index === -1) {
    showNotification("Appointment not found.", "error");
    return;
  }

  if (!notes) {
    showNotification("Please add notes before marking as finished.", "error");
    return;
  }

  const record = patientRecords[index];
  const now = new Date().toISOString();

  record.appointmentStatus = "Finished";
  record.notes = notes;
  record.appointmentLogged = false;
  record.appointmentUpdatedAt = now;
  record.updatedAt = now;

  const inventoryResult = deductServiceInventoryForAppointment(record);

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Appointment",
    action: "Finished Appointment",
    details: `${record.petName || "Patient"} appointment marked as finished. ${inventoryResult.summary}`
  };

  try {
    await updatePatientRecordInFirebase(record, {
      appointmentStatus: "Finished",
      notes,
      appointmentLogged: false,
      appointmentUpdatedAt: now,

      serviceInventoryDeducted: record.serviceInventoryDeducted || false,
      serviceInventoryDeductedAt: record.serviceInventoryDeductedAt || "",
      serviceInventoryDeductionNotes: record.serviceInventoryDeductionNotes || ""
    });

    await saveRecentActivityToFirebase(activity);

    patientRecords[index] = record;
    recentActivities.unshift(activity);

    saveDashboardLocalStorage();

    renderUpcomingAppointments();
    renderInventoryRestockAlerts();
    renderRecentActivity();
    renderDashboardStats();

    closeFinishAppointmentModal();

    showNotification("Appointment marked as finished.", "success");
  } catch (error) {
    console.error("Firebase finish appointment error:", error);
    showNotification("Failed to update appointment status in Firebase.", "error");
  }
}

function initializeFinishAppointmentModalEvents() {
  const form = document.getElementById("finishAppointmentForm");
  const closeBtn = document.getElementById("closeFinishAppointmentModal");
  const cancelBtn = document.getElementById("cancelFinishAppointmentBtn");

  if (form) form.addEventListener("submit", saveFinishedAppointmentNotes);
  if (closeBtn) closeBtn.addEventListener("click", closeFinishAppointmentModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeFinishAppointmentModal);
}

/* ================= APPOINTMENT LOG ACTION ================= */


function moveAppointmentToLogs(id, forcedStatus = "") {
  const index = patientRecords.findIndex(function (record) {
    return String(record.id) === String(id);
  });

  if (index === -1) {
    showNotification("Appointment not found.", "error");
    return;
  }

  const record = patientRecords[index];

  if (!isActiveAppointment(record)) {
    showNotification("No active appointment to move to logs.", "error");
    return;
  }

  const finalStatus =
    forcedStatus ||
    record.appointmentStatus ||
    "Finished";

  const logRecord = createAppointmentLogRecord(record, finalStatus);

  addAppointmentLog(logRecord);

patientRecords[index] = {
...record,

  lastAppointmentDate: record.appointmentDate,
  lastAppointmentTime: record.appointmentTime,
  lastAppointmentType: record.appointmentType,
  lastAppointmentStatus: finalStatus,

  appointmentStatus: finalStatus,

  appointmentLogged: true,
  appointmentLoggedAt: new Date().toISOString(),

  appointmentUpdatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  appointmentArchived: false,
  archived: false,
  isArchived: false
};

  recentActivities.unshift({
    dateTime: new Date().toLocaleString(),
    module: "Appointment Logs",
    action: "Moved to Appointment Logs",
    details: `${record.petName || "Patient"} appointment moved to logs`
  });

  saveDashboardLocalStorage();

  renderUpcomingAppointments();
  renderRecentActivity();
  renderDashboardStats();

  showNotification("Appointment moved to logs successfully");
}

async function moveAllUpcomingAppointmentsToLogs() {
  loadDashboardLocalStorage();

  const finishedAppointments = patientRecords.filter(function (record) {
    return (
      isActiveAppointment(record) &&
      String(record.appointmentStatus || "").toLowerCase() === "finished"
    );
  });

  if (finishedAppointments.length === 0) {
    showNotification("No finished appointments to move to logs.", "info");
    return;
  }

  const now = new Date().toISOString();

  try {
    for (const record of finishedAppointments) {
      const finalStatus = record.appointmentStatus || "Finished";
      const logRecord = createAppointmentLogRecord(record, finalStatus);

      await window.db.collection("archivedAppointments").add({
        ...logRecord,
        firebaseCreatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      let patientDocRef = null;

      if (record.firebaseDocId) {
        patientDocRef = window.db.collection("patientRecords").doc(record.firebaseDocId);
      } else {
        const snapshot = await window.db
          .collection("patientRecords")
          .where("id", "==", String(record.id))
          .limit(1)
          .get();

        if (!snapshot.empty) {
          patientDocRef = snapshot.docs[0].ref;
        }
      }

      if (patientDocRef) {
        await patientDocRef.update({
          lastAppointmentDate: record.appointmentDate || "",
          lastAppointmentTime: record.appointmentTime || "",
          lastAppointmentType: record.appointmentType || "",
          lastAppointmentStatus: finalStatus,

          appointmentDate: "",
          appointmentTime: "",
          appointmentType: "",
          appointmentStatus: "Waiting",

          appointmentLogged: true,
          appointmentLoggedAt: now,

          appointmentUpdatedAt: now,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      addAppointmentLog(logRecord);
    }

    patientRecords = patientRecords.map(function (record) {
      const isFinished = finishedAppointments.some(function (item) {
        return String(item.id) === String(record.id);
      });

      if (!isFinished) return record;

      return {
        ...record,

        lastAppointmentDate: record.appointmentDate || "",
        lastAppointmentTime: record.appointmentTime || "",
        lastAppointmentType: record.appointmentType || "",
        lastAppointmentStatus: record.appointmentStatus || "Finished",

        appointmentDate: "",
        appointmentTime: "",
        appointmentType: "",
        appointmentStatus: "Waiting",

        appointmentLogged: true,
        appointmentLoggedAt: now,

        appointmentUpdatedAt: now,
        updatedAt: now
      };
    });

    const activity = {
      dateTime: new Date().toLocaleString(),
      module: "Appointment Logs",
      action: "Moved Finished Appointments",
      details: `${finishedAppointments.length} finished appointment(s) moved to appointment logs`
    };

    await window.db.collection("recentActivities").add({
      ...activity,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    recentActivities.unshift(activity);

    upcomingPage = 1;

    saveDashboardLocalStorage();

    renderUpcomingAppointments();
    renderRecentActivity();
    renderDashboardStats();

    showNotification("Finished appointment(s) moved to logs successfully.", "success");
  } catch (error) {
    console.error("Move appointment logs Firebase error:", error);
    showNotification("Failed to move appointment(s) to logs.", "error");
  }
}

function createAppointmentLogRecord(record, status) {
  const now = new Date().toISOString();

  return {
    id: record.id || "",
    petName: record.petName || "",
    petBreed: record.petBreed || record.breed || "",
    ownerName: record.ownerName || "",
    ownerContact: record.ownerContact || record.contactNumber || "",
    appointmentDate: record.appointmentDate || "",
    appointmentTime: record.appointmentTime || "",
    appointmentType: record.appointmentType || "",
    appointmentStatus: status || record.appointmentStatus || "Finished",
    notes: record.notes || record.internalNotes || "",
    archivedAt: now,
    appointmentArchivedAt: now,
    createdAt: record.appointmentCreatedAt || record.createdAt || "",
    loggedAt: now
  };
}

function addAppointmentLog(logRecord) {
  const key = getAppointmentLogKey(logRecord);

  archivedAppointments = archivedAppointments.filter(function (item) {
    return getAppointmentLogKey(item) !== key;
  });

  archivedAppointments.unshift(logRecord);
  archivedAppointments = sortArchivedAppointmentsLifo(archivedAppointments);
}

function getAppointmentLogKey(item) {
  return [
    String(item.id || ""),
    String(item.appointmentDate || ""),
    String(item.appointmentTime || ""),
    String(item.appointmentType || "")
  ].join("|");
}

/* ================= ACTIONS ================= */
function handleRebooking(action, id) {
  const index = onlineAppointmentRequests.findIndex(function (request) {
    return (
      String(request.requestId || request.id) === String(id)
    );
  });

  if (index === -1) return;

  const req = onlineAppointmentRequests[index];

  if (action === "approve") {
    approveRebookingRequest(req);

    recentActivities.unshift({
      dateTime: new Date().toLocaleString(),
      module: "Appointment",
      action: "Approved Rebooking",
      details: `${req.petName || "Patient"} appointment approved`
    });

    showNotification("Rebooking approved successfully");
  }

  if (action === "decline") {
    recentActivities.unshift({
      dateTime: new Date().toLocaleString(),
      module: "Appointment",
      action: "Declined Rebooking",
      details: `${req.petName || "Patient"} rebooking declined`
    });

    showNotification("Rebooking declined successfully", "error");
  }

  onlineAppointmentRequests.splice(index, 1);

  saveDashboardLocalStorage();

  renderUpcomingAppointments();
  renderPatientRebookingRequests();
  renderRecentActivity();
  renderDashboardStats();
}

function approveRebookingRequest(req) {
  const patientId = req.patientId || req.id;

  const existingIndex = patientRecords.findIndex(function (record) {
    return String(record.id) === String(patientId);
  });

  const now = new Date().toISOString();

  if (existingIndex !== -1) {
patientRecords.unshift({
  id: patientId,
  petName: req.petName || "",
  petSpecies: "",
  breed: "",
  ownerName: req.ownerName || "",
  contactNumber: req.contactNumber || "",
  email: req.email || "",
  appointmentDate: req.requestedDate || req.appointmentDate || "",
  appointmentTime: req.requestedTime || req.appointmentTime || "",
  appointmentType: req.service || req.appointmentType || "",
  appointmentStatus: "Waiting",

  appointmentLogged: false,
  appointmentLoggedAt: "",

  appointmentArchived: false,
  archived: false,
  isArchived: false,
  notes: "",
  createdAt: now,
  appointmentCreatedAt: now,
  appointmentUpdatedAt: now
});

    return;
  }

  patientRecords.unshift({
    id: patientId,
    petName: req.petName || "",
    petSpecies: "",
    breed: "",
    ownerName: req.ownerName || "",
    contactNumber: req.contactNumber || "",
    email: req.email || "",
    appointmentDate: req.requestedDate || req.appointmentDate || "",
    appointmentTime: req.requestedTime || req.appointmentTime || "",
    appointmentType: req.service || req.appointmentType || "",
    appointmentStatus: "Waiting",
    appointmentArchived: false,
    archived: false,
    isArchived: false,
    notes: "",
    createdAt: now,
    appointmentCreatedAt: now,
    appointmentUpdatedAt: now
  });
}

async function updateDashboardAppointmentStatus(id, status) {
  const rec = patientRecords.find(function (record) {
    return String(record.id) === String(id);
  });

  if (!rec) {
    showNotification("Appointment not found.", "error");
    return;
  }

  const now = new Date().toISOString();

  rec.appointmentStatus = status;
  rec.appointmentUpdatedAt = now;
  rec.updatedAt = now;

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Appointment",
    action: "Status Updated",
    details: `${rec.petName || "Patient"} marked as ${status}`
  };

  try {
    await updatePatientRecordInFirebase(rec, {
      appointmentStatus: status,
      appointmentUpdatedAt: now
    });

    await saveRecentActivityToFirebase(activity);

    recentActivities.unshift(activity);
    saveDashboardLocalStorage();

    showNotification(`Appointment status changed to ${status}`);
    renderUpcomingAppointments();
    renderRecentActivity();
    renderDashboardStats();
  } catch (error) {
    console.error("Firebase status update error:", error);
    showNotification("Failed to update appointment status in Firebase.", "error");
  }
}

async function clearRecentActivitiesInFirebase() {
  if (!window.db) return;

  const snapshot = await window.db.collection("recentActivities").get();

  if (snapshot.empty) return;

  const batch = window.db.batch();

  snapshot.docs.forEach(function (doc) {
    batch.delete(doc.ref);
  });

  await batch.commit();
}
/* ================= EVENTS ================= */
/* ================= EVENTS ================= */
function initializeDashboardEvents() {
  const upcomingSearch = document.getElementById("upcomingSearch");
  const rebookingSearch = document.getElementById("rebookingSearch");
  const clearActivityBtn = document.getElementById("clearActivityLogsBtn");
  const appointmentLogsBtn = document.getElementById("appointmentLogsBtn");

  if (appointmentLogsBtn) {
  appointmentLogsBtn.addEventListener("click", function (e) {
    e.preventDefault();
    moveAllUpcomingAppointmentsToLogs();
  });
}

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
  clearActivityBtn.addEventListener("click", async function () {
    try {
      await clearRecentActivitiesInFirebase();

      recentActivities = [];
      activityPage = 1;

      setLocalStorageArray(DASHBOARD_STORAGE_KEYS.recentActivities, []);

      renderRecentActivity();
      showNotification("Recent activity cleared successfully");
    } catch (error) {
      console.error("Firebase clear activity error:", error);
      showNotification("Failed to clear recent activity in Firebase.", "error");
    }
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

      document.querySelectorAll(".action-dropdown").forEach(function (item) {
        if (item !== drop) item.classList.remove("active");
      });

      document.querySelectorAll(".status-dropdown").forEach(function (item) {
        item.classList.remove("active");
      });

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

      document.querySelectorAll(".status-dropdown").forEach(function (item) {
        if (item !== drop) item.classList.remove("active");
      });

      document.querySelectorAll(".action-dropdown").forEach(function (item) {
        item.classList.remove("active");
      });

      drop.classList.toggle("active");
      return;
    }

const statusItem = e.target.closest(".status-menu button");

if (statusItem) {
  const id = statusItem.dataset.id;
  const status = statusItem.dataset.status;

  if (status === "Finished") {
    openFinishAppointmentModal(id);
    return;
  }

  updateDashboardAppointmentStatus(id, status);
  return;
}

    document.querySelectorAll(".action-dropdown, .status-dropdown").forEach(function (item) {
      item.classList.remove("active");
    });
  });
}



/* ================= STATS ================= */
function renderDashboardStats() {
  const totalPatients = document.getElementById("totalPatients");
  const todayAppointments = document.getElementById("todayAppointments");
  const pendingRebooking = document.getElementById("pendingRebooking");

  const todayKey = formatDateKey(new Date());

  const activePatients = patientRecords.filter(function (record) {
    return !isPatientArchived(record);
  });

  const todayActiveAppointments = activePatients.filter(function (record) {
    return (
      isActiveAppointment(record) &&
      String(record.appointmentDate || "") === todayKey
    );
  });

  const pendingRequests = onlineAppointmentRequests.filter(function (request) {
    return String(request.status || "Pending").toLowerCase() === "pending";
  });

  if (totalPatients) totalPatients.textContent = activePatients.length;
  if (todayAppointments) todayAppointments.textContent = todayActiveAppointments.length;
  if (pendingRebooking) pendingRebooking.textContent = pendingRequests.length;
}

/* ================= HELPERS ================= */
function isPatientArchived(record) {
  return (
    record?.appointmentArchived === true ||
    record?.archived === true ||
    record?.isArchived === true ||
    String(record?.status || "").toLowerCase() === "archived"
  );
}

function getDashboardAppointmentDate(record) {
  return record.appointmentDate || record.lastAppointmentDate || "";
}

function getDashboardAppointmentTime(record) {
  return record.appointmentTime || record.lastAppointmentTime || "";
}

function getDashboardAppointmentType(record) {
  return record.appointmentType || record.lastAppointmentType || record.service || "";
}

function getDashboardAppointmentLogKey(record) {
  return [
    String(record.id || record.patientId || ""),
    String(getDashboardAppointmentDate(record) || ""),
    String(getDashboardAppointmentTime(record) || ""),
    String(getDashboardAppointmentType(record) || "")
  ].join("|");
}

function getArchivedAppointmentLogKey(record) {
  return [
    String(record.id || record.patientId || ""),
    String(record.appointmentDate || record.lastAppointmentDate || ""),
    String(record.appointmentTime || record.lastAppointmentTime || ""),
    String(record.appointmentType || record.lastAppointmentType || record.service || "")
  ].join("|");
}

function isAppointmentAlreadyInLogs(record) {
  const recordKey = getDashboardAppointmentLogKey(record);

  if (recordKey === "|||") return false;

  const logs = Array.isArray(archivedAppointments)
    ? archivedAppointments
    : getLocalStorageArray(DASHBOARD_STORAGE_KEYS.archivedAppointments);

  return logs.some(function (log) {
    return getArchivedAppointmentLogKey(log) === recordKey;
  });
}

function isActiveAppointment(record) {
  if (!record) return false;
  if (isPatientArchived(record)) return false;

  const appointmentDate = getDashboardAppointmentDate(record);
  const appointmentTime = getDashboardAppointmentTime(record);
  const appointmentType = getDashboardAppointmentType(record);

  const hasAppointment =
    Boolean(appointmentDate) &&
    Boolean(appointmentTime) &&
    Boolean(appointmentType);

  if (!hasAppointment) return false;

  if (record.appointmentLogged === true) {
    return false;
  }

  /*
    Important:
    If appointmentLogged is explicitly false, it means this is a new/rebooked appointment.
    So do not hide it even if old logs exist.
  */
  if (record.appointmentLogged !== false && isAppointmentAlreadyInLogs(record)) {
    return false;
  }

  return true;
}

function sortDashboardRecordsLifo(records) {
  return [...records].sort(function (a, b) {
    return getDashboardRecordSortTime(b) - getDashboardRecordSortTime(a);
  });
}

function getDashboardRecordSortTime(record) {
  const rawDate =
    record.appointmentUpdatedAt ||
    record.appointmentCreatedAt ||
    record.retrievedAt ||
    record.createdAt ||
    record.registeredAt ||
    "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  return Number(record.id) || 0;
}

function sortArchivedAppointmentsLifo(records) {
  return [...records].sort(function (a, b) {
    return getArchivedAppointmentSortTime(b) - getArchivedAppointmentSortTime(a);
  });
}

function getArchivedAppointmentSortTime(record) {
  const rawDate =
    record.archivedAt ||
    record.loggedAt ||
    record.appointmentArchivedAt ||
    record.createdAt ||
    "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  return Number(record.id) || 0;
}

function getRequestSortTime(request) {
  const rawDate =
    request.createdAt ||
    request.requestedAt ||
    request.requestDate ||
    "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  return Number(request.requestId || request.id) || 0;
}

function getActivitySortTime(activity) {
  const rawDate = activity.dateTime || activity.createdAt || "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  return 0;
}

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

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ================= SERVICE INVENTORY AUTOMATION ================= */

function isInventoryArchivedItem(item) {
  return (
    item?.archived === true ||
    item?.isArchived === true ||
    item?.inventoryArchived === true ||
    String(item?.status || "").toLowerCase() === "archived"
  );
}

function normalizeInventoryText(value) {
  return String(value || "").toLowerCase().trim();
}

function getInventoryItemName(item) {
  return item.itemName || item.name || item.productName || item.item || "Unnamed Item";
}

function getInventoryItemDescription(item) {
  return item.itemDescription || item.description || "";
}

function getInventoryItemCategory(item) {
  return item.category || item.itemCategory || "";
}

function getInventoryItemUnit(item) {
  return String(item.unit || item.itemUnit || "").trim();
}

function getInventoryItemQuantity(item) {
  return parseFloat(
    item.quantity ??
    item.stock ??
    item.qty ??
    item.itemQuantity ??
    0
  ) || 0;
}

function setInventoryItemQuantity(item, quantity) {
  const cleanQuantity = Math.max(parseFloat(quantity) || 0, 0);

  item.quantity = cleanQuantity;
  item.stock = cleanQuantity;
  item.qty = cleanQuantity;
  item.itemQuantity = cleanQuantity;
  item.status = getServiceInventoryStatus(cleanQuantity);
  item.updatedAt = new Date().toISOString();
}

function getServiceInventoryStatus(quantity) {
  const qty = parseFloat(quantity) || 0;
  return qty <= 5 ? "Low Stock" : "In Stock";
}

function getServiceInventoryRules(serviceType) {
  const disposableGlovesRule = {
    label: "Disposable Gloves",
    category: "Clinic Supplies",
    keywords: ["disposable gloves", "gloves"],
    amount: 1,
    unit: "pair"
  };

  switch (serviceType) {
    case "Grooming":
      return [
        disposableGlovesRule,
        {
          label: "Shampoo",
          category: "Grooming Supplies",
          keywords: ["shampoo"],
          amount: 30,
          unit: "ml",
          defaultContainerSizeML: 250
        },
        {
          label: "Conditioner",
          category: "Grooming Supplies",
          keywords: ["conditioner"],
          amount: 1,
          unit: "sachet"
        },
        {
          label: "Cologne",
          category: "Grooming Supplies",
          keywords: ["cologne", "perfume", "spray"],
          amount: 5,
          unit: "ml",
          defaultContainerSizeML: 100
        }
      ];

    case "Vaccination":
      return [
        disposableGlovesRule,
        {
          label: "Vaccine",
          category: "Vaccine",
          keywords: ["vaccine", "rabies", "5-in-1", "6-in-1", "8-in-1"],
          amount: 1,
          unit: "vial"
        },
        {
          label: "Syringe",
          category: "Clinic Supplies",
          keywords: ["syringe"],
          amount: 1,
          unit: "pcs"
        },
        {
          label: "Needle",
          category: "Clinic Supplies",
          keywords: ["needle"],
          amount: 1,
          unit: "pcs"
        },
        {
          label: "Cotton",
          category: "Clinic Supplies",
          keywords: ["cotton"],
          amount: 1,
          unit: "pcs"
        }
      ];

    case "Deworming":
      return [
        disposableGlovesRule,
        {
          label: "Deworming Medicine",
          category: "Deworming Medicine",
          keywords: ["deworm", "worm", "anthelmintic"],
          amount: 1,
          unit: "auto-deworm"
        }
      ];

    case "Surgery":
      return [
        {
          label: "Surgical Gloves",
          category: "Surgery Supplies",
          keywords: ["surgical gloves", "gloves"],
          amount: 1,
          unit: "pair"
        },
        {
          label: "Gauze",
          category: "Surgery Supplies",
          keywords: ["gauze"],
          amount: 3,
          unit: "pcs"
        },
        {
          label: "Suture",
          category: "Surgery Supplies",
          keywords: ["suture"],
          amount: 1,
          unit: "pack"
        },
        {
          label: "Scalpel Blade",
          category: "Surgery Supplies",
          keywords: ["scalpel", "blade"],
          amount: 1,
          unit: "pcs"
        },
        {
          label: "Betadine",
          category: "Surgery Supplies",
          keywords: ["betadine", "povidone"],
          amount: 10,
          unit: "ml",
          defaultContainerSizeML: 60
        }
      ];

    default:
      return [];
  }
}

function findServiceInventoryItem(inventoryRecords, rule) {
  let candidates = inventoryRecords.filter(function (item) {
    return !isInventoryArchivedItem(item) && getInventoryItemQuantity(item) > 0;
  });

  if (rule.category) {
    const ruleCategory = normalizeInventoryText(rule.category);

    candidates = candidates.filter(function (item) {
      const itemCategory = normalizeInventoryText(getInventoryItemCategory(item));
      return itemCategory === ruleCategory || itemCategory.includes(ruleCategory);
    });
  }

  if (rule.keywords && rule.keywords.length > 0) {
    const keywordMatches = candidates.filter(function (item) {
      const itemText = [
        getInventoryItemName(item),
        getInventoryItemDescription(item),
        getInventoryItemCategory(item)
      ].join(" ").toLowerCase();

      return rule.keywords.some(function (keyword) {
        return itemText.includes(normalizeInventoryText(keyword));
      });
    });

    if (keywordMatches.length > 0) {
      return keywordMatches[0];
    }
  }

  return candidates[0] || null;
}

function getContainerSizeML(item, fallbackSize) {
  const directSize =
    parseFloat(item.containerSizeML) ||
    parseFloat(item.containerSize) ||
    parseFloat(item.bottleSizeML) ||
    parseFloat(item.sizePerUnitML);

  if (directSize > 0) {
    return directSize;
  }

  const text = `${getInventoryItemName(item)} ${getInventoryItemDescription(item)}`;
  const match = text.match(/(\d+(\.\d+)?)\s*(ml|mL|liter|liters|l|L)\b/);

  if (match) {
    const number = parseFloat(match[1]);
    const unit = String(match[3]).toLowerCase();

    if (unit === "l" || unit === "liter" || unit === "liters") {
      return number * 1000;
    }

    return number;
  }

  return fallbackSize || 250;
}

function resolveAutoDewormRule(item, rule) {
  const unit = normalizeInventoryText(getInventoryItemUnit(item));
  const itemText = `${getInventoryItemName(item)} ${getInventoryItemDescription(item)}`.toLowerCase();

  if (unit === "bottle" || itemText.includes("syrup")) {
    return {
      ...rule,
      amount: 5,
      unit: "ml",
      defaultContainerSizeML: 60
    };
  }

  if (unit === "sachet") {
    return {
      ...rule,
      amount: 1,
      unit: "sachet"
    };
  }

  return {
    ...rule,
    amount: 1,
    unit: getInventoryItemUnit(item) || "tablet"
  };
}
function applyServiceInventoryDeduction(item, rule) {
  const finalRule = rule.unit === "auto-deworm"
    ? resolveAutoDewormRule(item, rule)
    : rule;

  const itemName = getInventoryItemName(item);
  const currentQuantity = getInventoryItemQuantity(item);
  const itemUnit = normalizeInventoryText(getInventoryItemUnit(item));
  const ruleUnit = normalizeInventoryText(finalRule.unit);
  const amount = parseFloat(finalRule.amount) || 0;

  if (currentQuantity <= 0) {
    return {
      processed: false,
      message: `${itemName} is out of stock`
    };
  }

  /*
    DIRECT DEDUCTION UNITS:
    pcs, vial, tablet, sachet, pack, pair
  */
  const directDeductionUnits = [
    "pcs",
    "vial",
    "tablet",
    "sachet",
    "pack",
    "pair"
  ];

  if (directDeductionUnits.includes(ruleUnit)) {
    const actualDeduct = Math.min(amount, currentQuantity);
    setInventoryItemQuantity(item, currentQuantity - actualDeduct);

    return {
      processed: true,
      message: `${itemName} -${actualDeduct} ${getInventoryItemUnit(item) || finalRule.unit}`
    };
  }

  /*
    LIQUID USAGE RULE:
    Since mL is removed from dropdown, liquid items should usually be bottle.
    Example:
    Dog Shampoo | 250mL bottle | 10 bottle
    Grooming uses 30mL.
    Stock stays 10 bottle until accumulated usage reaches 250mL.
  */
  if (ruleUnit === "ml") {
    if (itemUnit === "bottle") {
      const containerSizeML = getContainerSizeML(item, finalRule.defaultContainerSizeML);
      const previousUsedML = parseFloat(item.serviceUsedAmountML) || 0;
      const totalUsedML = previousUsedML + amount;
      const unitsToDeduct = Math.floor(totalUsedML / containerSizeML);
      const remainingUsedML = totalUsedML % containerSizeML;

      item.serviceUsedAmountML = remainingUsedML;
      item.serviceContainerSizeML = containerSizeML;
      item.serviceUsageUpdatedAt = new Date().toISOString();
      item.updatedAt = new Date().toISOString();

      if (unitsToDeduct > 0) {
        const actualDeduct = Math.min(unitsToDeduct, currentQuantity);
        setInventoryItemQuantity(item, currentQuantity - actualDeduct);

        return {
          processed: true,
          message: `${itemName} used ${amount}mL; deducted ${actualDeduct} bottle`
        };
      }

      return {
        processed: true,
        message: `${itemName} used ${amount}mL; stock not deducted yet`
      };
    }

    /*
      If a liquid rule accidentally matches sachet/pack,
      deduct 1 unit instead of waiting for mL accumulation.
      Example:
      Conditioner sachet = minus 1 sachet per grooming.
    */
    if (itemUnit === "sachet" || itemUnit === "pack") {
      setInventoryItemQuantity(item, currentQuantity - 1);

      return {
        processed: true,
        message: `${itemName} -1 ${getInventoryItemUnit(item)}`
      };
    }

    /*
      Backward compatibility if old records still have mL unit.
    */
    if (itemUnit === "ml") {
      setInventoryItemQuantity(item, currentQuantity - amount);

      return {
        processed: true,
        message: `${itemName} -${amount}mL`
      };
    }

    /*
      Fallback: if unit is not recognized, deduct 1 item.
    */
    setInventoryItemQuantity(item, currentQuantity - 1);

    return {
      processed: true,
      message: `${itemName} -1 ${getInventoryItemUnit(item) || "unit"}`
    };
  }

  /*
    Final fallback for any other rule.
  */
  const actualDeduct = Math.min(amount, currentQuantity);
  setInventoryItemQuantity(item, currentQuantity - actualDeduct);

  return {
    processed: true,
    message: `${itemName} -${actualDeduct} ${getInventoryItemUnit(item) || finalRule.unit}`
  };
}

function syncDashboardLowStockFromInventory(inventoryRecords) {
  lowStockItems = inventoryRecords
    .filter(function (item) {
      return !isInventoryArchivedItem(item) && getInventoryItemQuantity(item) <= 5;
    })
    .map(function (item) {
      return {
        id: item.id,
        itemName: getInventoryItemName(item),
        itemDescription: getInventoryItemDescription(item),
        category: getInventoryItemCategory(item),
        quantity: getInventoryItemQuantity(item),
        unit: getInventoryItemUnit(item),
        expirationDate: item.expirationDate || "",
        price: item.price || 0,
        status: getServiceInventoryStatus(getInventoryItemQuantity(item))
      };
    });

  setLocalStorageArray("lowStockItems", lowStockItems);
}

function deductServiceInventoryForAppointment(record) {
  if (!record || !record.appointmentType) {
    return {
      alreadyDeducted: false,
      processed: [],
      skipped: ["No appointment service found."],
      summary: "No service inventory deduction applied."
    };
  }

  if (record.serviceInventoryDeducted === true) {
    return {
      alreadyDeducted: true,
      processed: [],
      skipped: [],
      summary: "Inventory already deducted for this appointment."
    };
  }

  const rules = getServiceInventoryRules(record.appointmentType);
  const inventoryRecords = getLocalStorageArray("inventoryRecords");

  const processed = [];
  const skipped = [];

  if (rules.length === 0) {
    record.serviceInventoryDeducted = true;
    record.serviceInventoryDeductedAt = new Date().toISOString();
    record.serviceInventoryDeductionNotes = "No inventory rules for this service.";

    return {
      alreadyDeducted: false,
      processed,
      skipped: ["No inventory rules for this service."],
      summary: "No inventory rules for this service."
    };
  }

  rules.forEach(function (rule) {
    const item = findServiceInventoryItem(inventoryRecords, rule);

    if (!item) {
      skipped.push(`${rule.label} not found or out of stock`);
      return;
    }

    const result = applyServiceInventoryDeduction(item, rule);

    if (result.processed) {
      processed.push(result.message);
    } else {
      skipped.push(result.message);
    }
  });

  setLocalStorageArray("inventoryRecords", inventoryRecords);
  syncDashboardLowStockFromInventory(inventoryRecords);

  const summaryParts = [];

  if (processed.length > 0) {
    summaryParts.push(`Deducted/updated: ${processed.join("; ")}`);
  }

  if (skipped.length > 0) {
    summaryParts.push(`Skipped: ${skipped.join("; ")}`);
  }

  const summary = summaryParts.join(" | ") || "No inventory changes applied.";

  record.serviceInventoryDeducted = true;
  record.serviceInventoryDeductedAt = new Date().toISOString();
  record.serviceInventoryDeductionNotes = summary;

  return {
    alreadyDeducted: false,
    processed,
    skipped,
    summary
  };
}

/* =========================================================
   REPAIR: HIDE APPOINTMENTS THAT ARE ALREADY IN LOGS
   Paste at VERY BOTTOM of dashboard.js
========================================================= */

function repairDashboardLoggedAppointments() {
  const records = getLocalStorageArray(DASHBOARD_STORAGE_KEYS.patientRecords);
  const logs = getLocalStorageArray(DASHBOARD_STORAGE_KEYS.archivedAppointments);

  if (!Array.isArray(records) || records.length === 0) return;
  if (!Array.isArray(logs) || logs.length === 0) return;

  const logKeys = new Set(
    logs.map(function (log) {
      return [
        String(log.id || log.patientId || ""),
        String(log.appointmentDate || log.lastAppointmentDate || ""),
        String(log.appointmentTime || log.lastAppointmentTime || ""),
        String(log.appointmentType || log.lastAppointmentType || log.service || "")
      ].join("|");
    })
  );

  let changed = false;

  const repairedRecords = records.map(function (record) {
    const appointmentDate = record.appointmentDate || record.lastAppointmentDate || "";
    const appointmentTime = record.appointmentTime || record.lastAppointmentTime || "";
    const appointmentType = record.appointmentType || record.lastAppointmentType || record.service || "";

    const recordKey = [
      String(record.id || record.patientId || ""),
      String(appointmentDate || ""),
      String(appointmentTime || ""),
      String(appointmentType || "")
    ].join("|");

    if (record.appointmentLogged === false) {
      return record;
    }

    if (!logKeys.has(recordKey)) {
      return record;
    }

    changed = true;

    return {
      ...record,

      appointmentDate,
      appointmentTime,
      appointmentType,

      lastAppointmentDate: record.lastAppointmentDate || appointmentDate,
      lastAppointmentTime: record.lastAppointmentTime || appointmentTime,
      lastAppointmentType: record.lastAppointmentType || appointmentType,
      lastAppointmentStatus: record.lastAppointmentStatus || record.appointmentStatus || "Finished",

      appointmentLogged: true,
      appointmentLoggedAt: record.appointmentLoggedAt || new Date().toISOString()
    };
  });

  if (changed) {
    setLocalStorageArray(DASHBOARD_STORAGE_KEYS.patientRecords, repairedRecords);
  }
}

document.addEventListener("DOMContentLoaded", function () {
  repairDashboardLoggedAppointments();

  loadDashboardLocalStorage();
  renderUpcomingAppointments();
  renderDashboardStats();
});