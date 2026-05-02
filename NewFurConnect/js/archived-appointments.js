document.addEventListener("DOMContentLoaded", async function () {
  await loadArchivedAppointments();
  renderArchivedAppointments();
  initializeArchivedAppointmentsEvents();
});

/* DATA */
let archivedAppointments = [];

function loadArchivedAppointments() {
  archivedAppointments = [];

}

let currentLogsPage = 1;
const logsPerPage = 8;
let logsFilterTimer = null;

/* ================= FILTER + PAGINATION ================= */

function getFilteredArchivedAppointments() {
  const searchInput = document.getElementById("archivedAppointmentSearch");
  const fromInput = document.getElementById("archivedFromDate");
  const toInput = document.getElementById("archivedToDate");

  const keyword = (searchInput?.value || "").toLowerCase().trim();
  const fromDate = fromInput?.value || "";
  const toDate = toInput?.value || "";

  return archivedAppointments.filter((item) => {
    const searchableText = `
      ${item.id || ""}
      ${item.petName || ""}
      ${item.ownerName || ""}
      ${item.appointmentType || ""}
      ${item.appointmentStatus || ""}
      ${item.notes || ""}
    `.toLowerCase();

    const matchesSearch = searchableText.includes(keyword);

    const archivedDateValue = getDateOnly(item.archivedAt || item.appointmentDate);
    const matchesFrom = !fromDate || archivedDateValue >= fromDate;
    const matchesTo = !toDate || archivedDateValue <= toDate;

    return matchesSearch && matchesFrom && matchesTo;
  });
}

/* ================= LOADING RENDER ================= */

function renderArchivedAppointmentsWithLoading() {
  const loader = document.getElementById("logsLoadingOverlay");

  if (loader) loader.classList.add("show");

  clearTimeout(logsFilterTimer);

  logsFilterTimer = setTimeout(() => {
    currentLogsPage = 1;
    renderArchivedAppointments();

    if (loader) loader.classList.remove("show");
  }, 600);
}

/* ================= RENDER ================= */

function renderArchivedAppointments() {
  const filtered = getFilteredArchivedAppointments();
  const totalPages = Math.ceil(filtered.length / logsPerPage) || 1;

  if (currentLogsPage > totalPages) currentLogsPage = totalPages;

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

    if (showingText) showingText.textContent = "Showing 0 logs";
    return;
  }

  list.forEach((item) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.id || ""}</td>
      <td>
        <strong>${item.petName || ""}</strong>
        ${item.petBreed ? `<br><span class="text-muted">${item.petBreed}</span>` : ""}
      </td>
      <td>
        <strong>${item.ownerName || ""}</strong>
        ${item.ownerContact ? `<br><span class="text-muted">${item.ownerContact}</span>` : ""}
      </td>
      <td>${formatSchedule(item.appointmentDate, item.appointmentTime)}</td>
      <td>${item.appointmentType || ""}</td>
      <td>
        <span class="status-log-finished">
          ${item.appointmentStatus || "Finished"}
        </span>
      </td>
      <td class="log-notes-cell">${item.notes || "-"}</td>
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

  const prevBtn = createPageButton("‹", currentLogsPage === 1, () => {
    currentLogsPage--;
    renderArchivedAppointments();
  });

  pagination.appendChild(prevBtn);

  for (let page = 1; page <= totalPages; page++) {
    const pageBtn = createPageButton(page, false, () => {
      currentLogsPage = page;
      renderArchivedAppointments();
    });

    if (page === currentLogsPage) {
      pageBtn.classList.add("active");
    }

    pagination.appendChild(pageBtn);
  }

  const nextBtn = createPageButton("›", currentLogsPage === totalPages, () => {
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

  [searchInput, fromInput, toInput].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", renderArchivedAppointmentsWithLoading);
  });

  if (exportBtn) {
    exportBtn.addEventListener("click", exportArchivedAppointmentsToExcel);
  }
}

/* ================= EXPORT ================= */

function exportArchivedAppointmentsToExcel() {
  const filtered = getFilteredArchivedAppointments();

  if (filtered.length === 0) {
    alert("No appointment logs to export.");
    return;
  }

  const rows = filtered.map((item) => ({
    ID: item.id || "",
    "Pet Name": item.petName || "",
    Owner: item.ownerName || "",
    Schedule: stripHtml(formatSchedule(item.appointmentDate, item.appointmentTime)),
    Appointment: item.appointmentType || "",
    Status: item.appointmentStatus || "Finished",
    Notes: item.notes || "",
    "Archived Date": stripHtml(formatArchivedDateTime(item.archivedAt))
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, "Appointment Logs");
  XLSX.writeFile(workbook, "appointment-logs.xlsx");
}

/* ================= HELPERS ================= */

function formatSchedule(date, time) {
  if (!date) return "-";

  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  if (!time) return formattedDate;

  return `${formattedDate}<br>${formatTime(time)}`;
}

function formatTime(timeValue) {
  if (!timeValue) return "-";

  return String(timeValue)
    .split(",")
    .map((time) => {
      let [hours, minutes] = time.trim().split(":");
      hours = parseInt(hours, 10);

      if (isNaN(hours) || !minutes) return time.trim();

      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;

      return `${hours}:${minutes} ${ampm}`;
    })
    .join(", ");
}

function formatArchivedDateTime(date) {
  if (!date) return "-";

  const dateObj = new Date(date);

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