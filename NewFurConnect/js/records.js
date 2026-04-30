document.addEventListener("DOMContentLoaded", function () {
  initializeRecordsPage();
});

/* TEMP DATA (papalitan later ng Firebase) */
let patientRecords = [];

/* ================= INIT ================= */

function initializeRecordsPage() {
  const isArchivedPage = document.getElementById("archivedRecordsPage");

  if (isArchivedPage) {
    renderArchivedRecords();
    initializeArchivedEvents();
  } else {
    renderActiveRecords();
    initializeActiveEvents();
  }
}

/* ================= RENDER ACTIVE ================= */

function renderActiveRecords() {
  const body = document.getElementById("recordsTableBody");
  if (!body) return;

  body.innerHTML = "";

  const active = patientRecords.filter(r => !r.appointmentArchived);

  if (active.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="9" class="text-center text-muted py-4">
          No records found
        </td>
      </tr>
    `;
    return;
  }

  active.forEach((rec, index) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td><input type="checkbox" class="record-checkbox" data-index="${index}"></td>
      <td>${rec.id || ""}</td>
      <td>${rec.petName || ""}</td>
      <td>${rec.petSpecies || ""}</td>
      <td>${rec.breed || ""}</td>
      <td>${rec.ownerName || ""}</td>
      <td>${formatSchedule(rec.appointmentDate, rec.appointmentTime)}</td>
      <td>${rec.appointmentType || ""}</td>
      <td>
        <button class="btn btn-sm btn-primary edit-btn" data-index="${index}">Edit</button>
      </td>
    `;

    body.appendChild(row);
  });
}

/* ================= RENDER ARCHIVED ================= */

function renderArchivedRecords() {
  const body = document.getElementById("archivedRecordsTableBody");
  if (!body) return;

  body.innerHTML = "";

  const archived = patientRecords.filter(r => r.appointmentArchived);

  if (archived.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="9" class="text-center text-muted py-4">
          No archived records
        </td>
      </tr>
    `;
    return;
  }

  archived.forEach((rec, index) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td><input type="checkbox" class="archived-checkbox" data-index="${index}"></td>
      <td>${rec.id || ""}</td>
      <td>${rec.petName || ""}</td>
      <td>${rec.petSpecies || ""}</td>
      <td>${rec.breed || ""}</td>
      <td>${rec.ownerName || ""}</td>
      <td>${formatSchedule(rec.appointmentDate, rec.appointmentTime)}</td>
      <td>${rec.appointmentType || ""}</td>
      <td>-</td>
    `;

    body.appendChild(row);
  });
}

/* ================= SEARCH ================= */

function initializeActiveEvents() {
  const search = document.getElementById("recordsSearch");

  if (search) {
    search.addEventListener("input", function () {
      const keyword = this.value.toLowerCase();

      const filtered = patientRecords.filter(r =>
        !r.appointmentArchived &&
        (
          (r.petName || "").toLowerCase().includes(keyword) ||
          (r.ownerName || "").toLowerCase().includes(keyword)
        )
      );

      renderFilteredActive(filtered);
    });
  }

  initializeEditButtons();
}

function initializeArchivedEvents() {
  const search = document.getElementById("archivedRecordsSearch");

  if (search) {
    search.addEventListener("input", function () {
      const keyword = this.value.toLowerCase();

      const filtered = patientRecords.filter(r =>
        r.appointmentArchived &&
        (
          (r.petName || "").toLowerCase().includes(keyword) ||
          (r.ownerName || "").toLowerCase().includes(keyword)
        )
      );

      renderFilteredArchived(filtered);
    });
  }
}

/* ================= FILTER RENDER ================= */

function renderFilteredActive(list) {
  const body = document.getElementById("recordsTableBody");
  if (!body) return;

  body.innerHTML = "";

  list.forEach((rec) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>-</td>
      <td>${rec.id}</td>
      <td>${rec.petName}</td>
      <td>${rec.petSpecies}</td>
      <td>${rec.breed}</td>
      <td>${rec.ownerName}</td>
      <td>${formatSchedule(rec.appointmentDate, rec.appointmentTime)}</td>
      <td>${rec.appointmentType}</td>
      <td>-</td>
    `;

    body.appendChild(row);
  });
}

function renderFilteredArchived(list) {
  const body = document.getElementById("archivedRecordsTableBody");
  if (!body) return;

  body.innerHTML = "";

  list.forEach((rec) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>-</td>
      <td>${rec.id}</td>
      <td>${rec.petName}</td>
      <td>${rec.petSpecies}</td>
      <td>${rec.breed}</td>
      <td>${rec.ownerName}</td>
      <td>${formatSchedule(rec.appointmentDate, rec.appointmentTime)}</td>
      <td>${rec.appointmentType}</td>
      <td>-</td>
    `;

    body.appendChild(row);
  });
}

/* ================= EDIT ================= */

function initializeEditButtons() {
  document.addEventListener("click", function (e) {
    if (!e.target.classList.contains("edit-btn")) return;

    const index = e.target.dataset.index;
    openEditModal(patientRecords[index]);
  });
}

function openEditModal(record) {
  const modal = document.getElementById("editPatientModal");
  if (!modal) return;

  document.getElementById("editPetName").value = record.petName || "";
  document.getElementById("editPetSpecies").value = record.petSpecies || "";
  document.getElementById("editBreed").value = record.breed || "";
  document.getElementById("editOwnerName").value = record.ownerName || "";

  modal.classList.remove("hidden");
}

/* ================= ARCHIVE ================= */

function archiveRecord(index) {
  if (!patientRecords[index]) return;

  patientRecords[index].appointmentArchived = true;
  renderActiveRecords();
}

/* ================= HELPERS ================= */

function formatSchedule(date, time) {
  if (!date) return "-";

  const d = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  if (!time) return d;

  return `${d} ${formatTime(time)}`;
}

function formatTime(time) {
  let [h, m] = time.split(":");
  h = parseInt(h);

  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;

  return `${h}:${m} ${ampm}`;
}