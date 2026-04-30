document.addEventListener("DOMContentLoaded", function () {
  renderArchivedAppointments();
  initializeArchivedAppointmentsEvents();
});

/* TEMP DATA — papalitan later ng Firebase */
let archivedAppointments = [];

/* ================= RENDER ================= */

function renderArchivedAppointments() {
  const tableBody = document.getElementById("archivedAppointmentsBody");

  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (archivedAppointments.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4">
          No archived appointments found.
        </td>
      </tr>
    `;
    return;
  }

  archivedAppointments.forEach((item) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.id || ""}</td>
      <td>${item.petName || ""}</td>
      <td>${item.ownerName || ""}</td>
      <td>${formatSchedule(item.appointmentDate, item.appointmentTime)}</td>
      <td>${item.appointmentType || ""}</td>
      <td>${item.appointmentStatus || ""}</td>
      <td>${formatDate(item.archivedAt)}</td>
    `;

    tableBody.appendChild(row);
  });
}

/* ================= SEARCH ================= */

function initializeArchivedAppointmentsEvents() {
  const searchInput = document.getElementById("archivedAppointmentSearch");

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      const keyword = this.value.toLowerCase();

      const filtered = archivedAppointments.filter((item) =>
        (item.petName || "").toLowerCase().includes(keyword) ||
        (item.ownerName || "").toLowerCase().includes(keyword) ||
        (item.appointmentType || "").toLowerCase().includes(keyword)
      );

      renderFilteredArchivedAppointments(filtered);
    });
  }
}

function renderFilteredArchivedAppointments(list) {
  const tableBody = document.getElementById("archivedAppointmentsBody");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (list.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4">
          No results found.
        </td>
      </tr>
    `;
    return;
  }

  list.forEach((item) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.id || ""}</td>
      <td>${item.petName || ""}</td>
      <td>${item.ownerName || ""}</td>
      <td>${formatSchedule(item.appointmentDate, item.appointmentTime)}</td>
      <td>${item.appointmentType || ""}</td>
      <td>${item.appointmentStatus || ""}</td>
      <td>${formatDate(item.archivedAt)}</td>
    `;

    tableBody.appendChild(row);
  });
}

/* ================= HELPERS ================= */

function formatSchedule(date, time) {
  if (!date) return "-";

  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  if (!time) return formattedDate;

  return `${formattedDate} ${formatTime(time)}`;
}

function formatTime(timeValue) {
  if (!timeValue) return "-";

  let [hours, minutes] = timeValue.split(":");
  hours = parseInt(hours, 10);

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${hours}:${minutes} ${ampm}`;
}

function formatDate(date) {
  if (!date) return "-";

  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}