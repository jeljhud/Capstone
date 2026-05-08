document.addEventListener("DOMContentLoaded", async function () {
  await syncAppointmentLogsFromFirebaseToLocalStorage();

  loadArchivedAppointments();
  renderArchivedAppointments();
  initializeArchivedAppointmentsEvents();
});

/* ================= DATA ================= */
let archivedAppointments = [];

let currentLogsPage = 1;
const logsPerPage = 8;
let logsFilterTimer = null;

/* ================= LOCAL STORAGE ================= */
const ARCHIVED_APPOINTMENT_STORAGE_KEYS = {
  archivedAppointments: "archivedAppointments",
  patientRecords: "patientRecords",
  archivedPatientRecords: "archivedPatientRecords"
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

async function syncAppointmentLogsFromFirebaseToLocalStorage() {
  if (!window.db) {
    console.warn("Firestore is not ready. Using localStorage only.");
    return;
  }

  try {
    const snapshot = await window.db.collection("archivedAppointments").get();

    const firebaseAppointmentLogs = snapshot.docs
      .map(function (doc) {
        const data = doc.data();

        return normalizeArchivedAppointment({
          firebaseDocId: doc.id,
          ...data,
          createdAt: normalizeFirebaseDate(data.createdAt),
          archivedAt: normalizeFirebaseDate(data.archivedAt),
          appointmentArchivedAt: normalizeFirebaseDate(data.appointmentArchivedAt),
          loggedAt: normalizeFirebaseDate(data.loggedAt),
          firebaseCreatedAt: normalizeFirebaseDate(data.firebaseCreatedAt)
        });
      })
      .filter(isAppointmentLoggable);

    setLocalStorageArray(
      ARCHIVED_APPOINTMENT_STORAGE_KEYS.archivedAppointments,
      sortAppointmentLogsLifo(firebaseAppointmentLogs)
    );

    console.log("Firebase appointment logs loaded:", firebaseAppointmentLogs.length);
  } catch (error) {
    console.error("Firebase appointment logs load error:", error);
  }
}
function normalizeFirebaseDate(value) {
  if (!value) return "";

  if (value.toDate) {
    return value.toDate().toISOString();
  }

  return value;
}

/* ================= LOAD / NORMALIZE ================= */
function normalizeArchivedAppointment(record) {
  const archivedAt =
    record.archivedAt ||
    record.appointmentArchivedAt ||
    record.dateArchived ||
    record.updatedAt ||
    record.createdAt ||
    "";

  return {
    id: record.id || record.patientId || "",
    petName: record.petName || "",
    petBreed: record.petBreed || record.breed || "",
    ownerName: record.ownerName || "",
    ownerContact: record.ownerContact || record.contactNumber || "",
    appointmentDate: record.appointmentDate || "",
    appointmentTime: record.appointmentTime || "",
    appointmentType: record.appointmentType || record.service || "",
    appointmentStatus: record.appointmentStatus || "Finished",
    notes: record.notes || record.internalNotes || "",
    archivedAt
  };
}

function isAppointmentLoggable(record) {
  return Boolean(
    record &&
    (
      record.appointmentDate ||
      record.appointmentTime ||
      record.appointmentType ||
      record.service
    )
  );
}

function isArchivedPatientRecord(record) {
  return (
    record?.appointmentArchived === true ||
    record?.archived === true ||
    record?.isArchived === true ||
    String(record?.status || "").toLowerCase() === "archived"
  );
}

function loadArchivedAppointments() {
  const savedArchivedAppointments = getLocalStorageArray(
    ARCHIVED_APPOINTMENT_STORAGE_KEYS.archivedAppointments
  );

  const patientRecords = getLocalStorageArray(
    ARCHIVED_APPOINTMENT_STORAGE_KEYS.patientRecords
  );

  const archivedPatientRecords = getLocalStorageArray(
    ARCHIVED_APPOINTMENT_STORAGE_KEYS.archivedPatientRecords
  );

  const directArchivedAppointments = savedArchivedAppointments
    .filter(isAppointmentLoggable)
    .map(function (record) {
      return normalizeArchivedAppointment(record);
    });

  const legacyArchivedFromPatientRecords = patientRecords
    .filter(function (record) {
      return isArchivedPatientRecord(record) && isAppointmentLoggable(record);
    })
    .map(function (record) {
      return normalizeArchivedAppointment(record);
    });

  const archivedFromArchivedPatientRecords = archivedPatientRecords
    .filter(isAppointmentLoggable)
    .map(function (record) {
      return normalizeArchivedAppointment(record);
    });

  const combinedLogs = [
    ...directArchivedAppointments,
    ...legacyArchivedFromPatientRecords,
    ...archivedFromArchivedPatientRecords
  ];

  archivedAppointments = mergeUniqueAppointmentLogs(combinedLogs);
  archivedAppointments = sortAppointmentLogsLifo(archivedAppointments);

  saveArchivedAppointmentsToLocalStorage();
}

function mergeUniqueAppointmentLogs(records) {
  const uniqueLogs = [];
  const usedKeys = new Set();

  records.forEach(function (item) {
    const normalized = normalizeArchivedAppointment(item);

    const uniqueKey = [
      String(normalized.id || ""),
      String(normalized.appointmentDate || ""),
      String(normalized.appointmentTime || ""),
      String(normalized.appointmentType || "")
    ].join("|");

    if (!usedKeys.has(uniqueKey)) {
      usedKeys.add(uniqueKey);
      uniqueLogs.push(normalized);
    }
  });

  return uniqueLogs;
}

function sortAppointmentLogsLifo(records) {
  return [...records].sort(function (a, b) {
    return getAppointmentLogSortTime(b) - getAppointmentLogSortTime(a);
  });
}

function getAppointmentLogSortTime(record) {
  const rawDate =
    record.archivedAt ||
    record.appointmentDate ||
    record.createdAt ||
    "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  return Number(record.id) || 0;
}

function saveArchivedAppointmentsToLocalStorage() {
  setLocalStorageArray(
    ARCHIVED_APPOINTMENT_STORAGE_KEYS.archivedAppointments,
    archivedAppointments
  );
}

/* ================= FILTER + PAGINATION ================= */
function getFilteredArchivedAppointments() {
  const searchInput = document.getElementById("archivedAppointmentSearch");
  const fromInput = document.getElementById("archivedFromDate");
  const toInput = document.getElementById("archivedToDate");

  const keyword = (searchInput?.value || "").toLowerCase().trim();
  const fromDate = fromInput?.value || "";
  const toDate = toInput?.value || "";

  return archivedAppointments.filter(function (item) {
    const searchableText = [
      item.id,
      item.petName,
      item.petBreed,
      item.ownerName,
      item.ownerContact,
      item.appointmentDate,
      item.appointmentTime,
      item.appointmentType,
      item.appointmentStatus,
      item.notes
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      keyword === "" || searchableText.includes(keyword);

    const archivedDateValue = getDateOnly(item.archivedAt || item.appointmentDate);

    const matchesFrom =
      !fromDate || (archivedDateValue && archivedDateValue >= fromDate);

    const matchesTo =
      !toDate || (archivedDateValue && archivedDateValue <= toDate);

    return matchesSearch && matchesFrom && matchesTo;
  });
}

/* ================= LOADING RENDER ================= */
function renderArchivedAppointmentsWithLoading() {
  const loader = document.getElementById("logsLoadingOverlay");

  if (loader) {
    loader.classList.add("show");
  }

  clearTimeout(logsFilterTimer);

  logsFilterTimer = setTimeout(function () {
    currentLogsPage = 1;
    renderArchivedAppointments();

    if (loader) {
      loader.classList.remove("show");
    }
  }, 600);
}

/* ================= RENDER ================= */
function renderArchivedAppointments() {
  loadArchivedAppointments();

  const filtered = getFilteredArchivedAppointments();
  const totalPages = Math.ceil(filtered.length / logsPerPage) || 1;

  if (currentLogsPage > totalPages) {
    currentLogsPage = totalPages;
  }

  const startIndex = (currentLogsPage - 1) * logsPerPage;
  const paginatedList = filtered.slice(startIndex, startIndex + logsPerPage);

  renderArchivedAppointmentsRows(paginatedList, filtered.length, startIndex);
  renderLogsPagination(filtered.length);
}

function renderArchivedAppointmentsRows(list, totalCount, startIndex) {
  const tableBody = document.getElementById("archivedAppointmentsBody");
  const showingText = document.getElementById("logsShowingText");

  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (totalCount === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center text-muted py-4">
          No appointment logs found for the selected filters.
        </td>
      </tr>
    `;

    if (showingText) {
      showingText.textContent = "Showing 0 logs";
    }

    return;
  }

  list.forEach(function (item) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHTML(item.id || "")}</td>
      <td>
        <strong>${escapeHTML(item.petName || "")}</strong>
        ${
          item.petBreed
            ? `<br><span class="text-muted">${escapeHTML(item.petBreed)}</span>`
            : ""
        }
      </td>
      <td>
        <strong>${escapeHTML(item.ownerName || "")}</strong>
        ${
          item.ownerContact
            ? `<br><span class="text-muted">${escapeHTML(item.ownerContact)}</span>`
            : ""
        }
      </td>
      <td>${formatSchedule(item.appointmentDate, item.appointmentTime)}</td>
      <td>${escapeHTML(item.appointmentType || "")}</td>
      <td>
        <span class="status-log-finished">
          ${escapeHTML(item.appointmentStatus || "Finished")}
        </span>
      </td>
      <td class="log-notes-cell">${escapeHTML(item.notes || "-")}</td>
      <td>${formatArchivedDateTime(item.archivedAt)}</td>
    `;

    tableBody.appendChild(row);
  });

  if (showingText) {
    const from = startIndex + 1;
    const to = startIndex + list.length;

    showingText.textContent = `Showing ${from} to ${to} of ${totalCount} logs`;
  }
}

function renderLogsPagination(totalCount) {
  const pagination = document.getElementById("logsPagination");
  if (!pagination) return;

  const totalPages = Math.ceil(totalCount / logsPerPage) || 1;

  pagination.innerHTML = "";

  if (totalCount <= logsPerPage) return;

  const prevBtn = createPageButton("‹", currentLogsPage === 1, function () {
    currentLogsPage--;
    renderArchivedAppointments();
  });

  pagination.appendChild(prevBtn);

  for (let page = 1; page <= totalPages; page++) {
    const pageBtn = createPageButton(page, false, function () {
      currentLogsPage = page;
      renderArchivedAppointments();
    });

    if (page === currentLogsPage) {
      pageBtn.classList.add("active");
    }

    pagination.appendChild(pageBtn);
  }

  const nextBtn = createPageButton("›", currentLogsPage === totalPages, function () {
    currentLogsPage++;
    renderArchivedAppointments();
  });

  pagination.appendChild(nextBtn);
}

function createPageButton(label, disabled, onClick) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "logs-page-btn";
  button.textContent = label;
  button.disabled = disabled;

  if (!disabled) {
    button.addEventListener("click", onClick);
  }

  return button;
}

/* ================= EVENTS ================= */
function initializeArchivedAppointmentsEvents() {
  const searchInput = document.getElementById("archivedAppointmentSearch");
  const fromInput = document.getElementById("archivedFromDate");
  const toInput = document.getElementById("archivedToDate");
  const exportBtn = document.getElementById("exportArchivedAppointmentsBtn");

  [searchInput, fromInput, toInput].forEach(function (input) {
    if (!input) return;

    input.addEventListener("input", renderArchivedAppointmentsWithLoading);
    input.addEventListener("change", renderArchivedAppointmentsWithLoading);
  });

  if (exportBtn) {
    exportBtn.addEventListener("click", exportArchivedAppointmentsToExcel);
  }
}

/* ================= EXPORT ================= */
async function exportArchivedAppointmentsToExcel() {
  await syncAppointmentLogsFromFirebaseToLocalStorage();
  loadArchivedAppointments();

  const filtered = getFilteredArchivedAppointments();

  if (filtered.length === 0) {
    alert("No appointment logs to export.");
    return;
  }

  const rows = filtered.map(function (item) {
    return {
      ID: item.id || "",
      "Pet Name": item.petName || "",
      "Pet Breed": item.petBreed || "",
      Owner: item.ownerName || "",
      "Owner Contact": item.ownerContact || "",
      Schedule: stripHtml(formatSchedule(item.appointmentDate, item.appointmentTime)),
      Appointment: item.appointmentType || "",
      Status: item.appointmentStatus || "Finished",
      Notes: item.notes || "",
      "Archived Date": stripHtml(formatArchivedDateTime(item.archivedAt))
    };
  });

  if (typeof XLSX === "undefined") {
    exportArchivedAppointmentsToCSV(rows);
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, "Appointment Logs");
  XLSX.writeFile(workbook, "appointment-logs.xlsx");
}

function exportArchivedAppointmentsToCSV(rows) {
  const headers = Object.keys(rows[0]);

  const csvRows = [
    headers.join(","),
    ...rows.map(function (row) {
      return headers
        .map(function (header) {
          return `"${String(row[header] || "").replaceAll('"', '""')}"`;
        })
        .join(",");
    })
  ];

  const blob = new Blob([csvRows.join("\n")], {
    type: "text/csv;charset=utf-8;"
  });

  const link = document.createElement("a");
  const dateKey = new Date().toISOString().slice(0, 10);

  link.href = URL.createObjectURL(blob);
  link.download = `appointment-logs-${dateKey}.csv`;
  link.click();

  URL.revokeObjectURL(link.href);
}

/* ================= HELPERS ================= */
function formatSchedule(date, time) {
  if (!date) return "-";

  const dateObj = new Date(date);

  const formattedDate = Number.isNaN(dateObj.getTime())
    ? date
    : dateObj.toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });

  if (!time) return escapeHTML(formattedDate);

  return `${escapeHTML(formattedDate)}<br>${formatTime(time)}`;
}

function formatTime(timeValue) {
  if (!timeValue) return "-";

  return String(timeValue)
    .split(",")
    .map(function (time) {
      let [hours, minutes] = time.trim().split(":");
      hours = parseInt(hours, 10);

      if (isNaN(hours) || !minutes) return escapeHTML(time.trim());

      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;

      return `${hours}:${minutes} ${ampm}`;
    })
    .join(", ");
}

function formatArchivedDateTime(date) {
  if (!date) return "-";

  const dateObj = new Date(date);

  if (isNaN(dateObj.getTime())) return "-";

  const formattedDate = dateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const formattedTime = dateObj.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  });

  return `${formattedDate}<br>${formattedTime}`;
}

function getDateOnly(date) {
  if (!date) return "";

  const dateObj = new Date(date);

  if (isNaN(dateObj.getTime())) return "";

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function stripHtml(value) {
  return String(value || "").replace(/<br\s*\/?>/gi, " ");
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}