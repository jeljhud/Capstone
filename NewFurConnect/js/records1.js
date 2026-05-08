document.addEventListener("DOMContentLoaded", function () {
  loadRecordsLocalStorage();

  initializeExportQr();
  initializeQrModal();
  initializePrintQr();
  initializeRecordsPage();
  initializePublicPatientQrMobileView();
  initializePatientLoginFormOnly();
  initializePatientAccountSettings();
});

const RECORDS_PER_PAGE = 8;

let currentRecordsPage = 1;
let filteredActiveRecords = [];
let currentEditIndex = null;
let editCalendarDate = new Date();

/* ================= DATA ================= */
let patientRecords = [];
let archivedPatientRecords = [];
let onlineAppointmentRequests = [];

/* ================= LOCAL STORAGE ================= */
const RECORDS_STORAGE_KEYS = {
  patientRecords: "patientRecords",
  archivedPatientRecords: "archivedPatientRecords",
  onlineAppointmentRequests: "onlineAppointmentRequests",
  archivedAppointments: "archivedAppointments",
  recentActivities: "recentActivities"
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

function loadRecordsLocalStorage() {
  const savedPatientRecords = getLocalStorageArray(RECORDS_STORAGE_KEYS.patientRecords);
  const savedArchivedPatientRecords = getLocalStorageArray(RECORDS_STORAGE_KEYS.archivedPatientRecords);

  const activeRecords = [];
  const archivedFromOldPatientRecords = [];

  savedPatientRecords.forEach(function (record) {
    if (isPatientRecordArchived(record)) {
      archivedFromOldPatientRecords.push(createArchivedPatientRecord(record));
    } else {
      activeRecords.push(createActivePatientRecord(record));
    }
  });

  patientRecords = sortActiveRecordsLifo(activeRecords);

  archivedPatientRecords = mergeUniqueRecords([
    ...savedArchivedPatientRecords.map(function (record) {
      return createArchivedPatientRecord(record);
    }),
    ...archivedFromOldPatientRecords
  ]);

  archivedPatientRecords = sortArchivedRecordsLifo(archivedPatientRecords);

  if (archivedFromOldPatientRecords.length > 0) {
    savePatientRecords();
    saveArchivedPatientRecords();
  }

  onlineAppointmentRequests = getLocalStorageArray(
    RECORDS_STORAGE_KEYS.onlineAppointmentRequests
  );
}

function savePatientRecords() {
  patientRecords = sortActiveRecordsLifo(
    patientRecords.filter(function (record) {
      return !isPatientRecordArchived(record);
    })
  );

  setLocalStorageArray(RECORDS_STORAGE_KEYS.patientRecords, patientRecords);
}

function saveArchivedPatientRecords() {
  archivedPatientRecords = sortArchivedRecordsLifo(archivedPatientRecords);

  setLocalStorageArray(
    RECORDS_STORAGE_KEYS.archivedPatientRecords,
    archivedPatientRecords
  );
}

function saveOnlineAppointmentRequests() {
  setLocalStorageArray(
    RECORDS_STORAGE_KEYS.onlineAppointmentRequests,
    onlineAppointmentRequests
  );
}

function saveRecentActivity(activity) {
  const recentActivities = getLocalStorageArray(RECORDS_STORAGE_KEYS.recentActivities);

  recentActivities.unshift(activity);

  setLocalStorageArray(RECORDS_STORAGE_KEYS.recentActivities, recentActivities);
}

function saveArchivedAppointmentLog(record) {
  const archivedAppointments = getLocalStorageArray(RECORDS_STORAGE_KEYS.archivedAppointments);

  const archivedLog = {
    id: record.id || "",
    petName: record.petName || "",
    petBreed: record.petBreed || record.breed || "",
    ownerName: record.ownerName || "",
    ownerContact: record.ownerContact || record.contactNumber || "",
    appointmentDate: record.appointmentDate || "",
    appointmentTime: record.appointmentTime || "",
    appointmentType: record.appointmentType || "",
    appointmentStatus: record.appointmentStatus || "Finished",
    notes: record.notes || record.internalNotes || "",
    archivedAt: record.archivedAt || record.appointmentArchivedAt || new Date().toISOString()
  };

  const duplicate = archivedAppointments.some(function (item) {
    return (
      String(item.id) === String(archivedLog.id) &&
      String(item.appointmentDate || "") === String(archivedLog.appointmentDate || "") &&
      String(item.appointmentTime || "") === String(archivedLog.appointmentTime || "")
    );
  });

  if (!duplicate) {
    archivedAppointments.unshift(archivedLog);
    setLocalStorageArray(RECORDS_STORAGE_KEYS.archivedAppointments, archivedAppointments);
  }
}

/* ================= RECORDS PAGE INIT ================= */
function initializeRecordsPage() {
  const isArchivedPage = document.getElementById("archivedRecordsPage");

  if (isArchivedPage) {
    renderArchivedRecords();
    initializeArchivedEvents();
  } else {
    renderActiveRecords();
    initializeActiveEvents();
  }

  initializeEditModalEvents();
}

/* ================= ACTIVE RECORDS ================= */
function renderActiveRecords(records = null) {
  const body = document.getElementById("recordsTableBody");
  if (!body) return;

  loadRecordsLocalStorage();

  const activeRecords = records
    ? sortActiveRecordsLifo(records)
    : sortActiveRecordsLifo(patientRecords);

  filteredActiveRecords = activeRecords;

  body.innerHTML = "";

  const totalRecords = activeRecords.length;
  const totalPages = Math.ceil(totalRecords / RECORDS_PER_PAGE) || 1;

  if (currentRecordsPage > totalPages) currentRecordsPage = totalPages;

  const startIndex = (currentRecordsPage - 1) * RECORDS_PER_PAGE;
  const endIndex = startIndex + RECORDS_PER_PAGE;
  const pageRecords = activeRecords.slice(startIndex, endIndex);

  if (pageRecords.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="8" class="text-center text-muted py-4">
          No records found
        </td>
      </tr>
    `;

    updateRecordsShowingText(0, 0, 0);
    renderRecordsPagination(totalPages);
    return;
  }

  pageRecords.forEach(function (record) {
    const actualIndex = patientRecords.findIndex(function (item) {
      return String(item.id) === String(record.id);
    });

    const row = document.createElement("tr");

    row.innerHTML = `
      <td><input type="checkbox" class="record-checkbox" data-index="${actualIndex}" data-id="${escapeHTML(record.id)}"></td>
      <td>${escapeHTML(record.id || "")}</td>
      <td>${escapeHTML(record.petName || "")}</td>
      <td>${escapeHTML(record.petSpecies || "")}</td>
      <td>${escapeHTML(record.breed || "")}</td>
      <td>${escapeHTML(record.ownerName || "")}</td>
      <td>${escapeHTML(record.appointmentType || "")}</td>
      <td>
        <button class="btn btn-sm btn-primary edit-btn" data-index="${actualIndex}" type="button">
          Edit
        </button>
      </td>
    `;

    body.appendChild(row);
  });

  updateRecordsShowingText(startIndex + 1, Math.min(endIndex, totalRecords), totalRecords);
  renderRecordsPagination(totalPages);
}

function initializeActiveEvents() {
  const search = document.getElementById("recordsSearch");
  const selectAll = document.getElementById("selectAllRecords");
  const archiveSelectedBtn =
    document.getElementById("archiveSelectedRecordsBtn") ||
    document.getElementById("archiveRecordsBtn");

  if (search) {
    search.addEventListener("input", function () {
      const keyword = this.value.toLowerCase().trim();

      const filtered = patientRecords.filter(function (record) {
        return (
          !isPatientRecordArchived(record) &&
          (
            String(record.id || "").toLowerCase().includes(keyword) ||
            String(record.petName || "").toLowerCase().includes(keyword) ||
            String(record.petSpecies || "").toLowerCase().includes(keyword) ||
            String(record.breed || "").toLowerCase().includes(keyword) ||
            String(record.ownerName || "").toLowerCase().includes(keyword) ||
            String(record.appointmentType || "").toLowerCase().includes(keyword)
          )
        );
      });

      currentRecordsPage = 1;
      renderActiveRecords(filtered);
    });
  }

  if (selectAll) {
    selectAll.addEventListener("change", function () {
      document.querySelectorAll(".record-checkbox").forEach(function (checkbox) {
        checkbox.checked = selectAll.checked;
      });
    });
  }

  if (archiveSelectedBtn) {
    archiveSelectedBtn.addEventListener("click", archiveSelectedActiveRecords);
  }

  document.addEventListener("click", function (event) {
    const row = event.target.closest("#recordsTableBody tr");
    if (!row) return;

    if (
      event.target.closest("button") ||
      event.target.closest("input[type='checkbox']")
    ) {
      return;
    }

    const checkbox = row.querySelector(".record-checkbox");
    if (!checkbox) return;

    checkbox.checked = !checkbox.checked;
  });
}

/* ================= ARCHIVED RECORDS ================= */
function renderArchivedRecords(records = null) {
  const body = document.getElementById("archivedRecordsTableBody");
  if (!body) return;

  loadRecordsLocalStorage();

  body.innerHTML = "";

  const archivedRecords = records
    ? sortArchivedRecordsLifo(records)
    : sortArchivedRecordsLifo(archivedPatientRecords);

  updateArchivedRecordsShowingText(archivedRecords.length);

  if (archivedRecords.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted py-4">
          No archived records
        </td>
      </tr>
    `;
    return;
  }

  archivedRecords.forEach(function (record) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td><input type="checkbox" class="archived-checkbox" data-id="${escapeHTML(record.id)}"></td>
      <td>${escapeHTML(record.id || "")}</td>
      <td>${escapeHTML(record.petName || "")}</td>
      <td>${escapeHTML(record.petSpecies || "")}</td>
      <td>${escapeHTML(record.breed || "")}</td>
      <td>${escapeHTML(record.ownerName || "")}</td>
    `;

    body.appendChild(row);
  });
}

function initializeArchivedEvents() {
  const search = document.getElementById("archivedRecordsSearch");
  const selectAll = document.getElementById("selectAllArchivedRecords");
  const retrieveBtn = document.getElementById("retrieveArchivedRecordsBtn");

  if (search) {
    search.addEventListener("input", function () {
      const keyword = this.value.toLowerCase().trim();

      const filtered = archivedPatientRecords.filter(function (record) {
        return (
          String(record.id || "").toLowerCase().includes(keyword) ||
          String(record.petName || "").toLowerCase().includes(keyword) ||
          String(record.petSpecies || "").toLowerCase().includes(keyword) ||
          String(record.breed || "").toLowerCase().includes(keyword) ||
          String(record.ownerName || "").toLowerCase().includes(keyword)
        );
      });

      renderArchivedRecords(filtered);
    });
  }

  if (selectAll) {
    selectAll.addEventListener("change", function () {
      document.querySelectorAll(".archived-checkbox").forEach(function (checkbox) {
        checkbox.checked = selectAll.checked;
      });
    });
  }

  document.addEventListener("click", function (event) {
    const row = event.target.closest("#archivedRecordsTableBody tr");
    if (!row) return;

    if (event.target.closest("input[type='checkbox']")) return;

    const checkbox = row.querySelector(".archived-checkbox");
    if (!checkbox) return;

    checkbox.checked = !checkbox.checked;
  });

  if (retrieveBtn) {
    retrieveBtn.addEventListener("click", retrieveSelectedArchivedRecords);
  }
}

/* ================= FILTERED RENDERS ================= */
function renderFilteredActive(records) {
  renderActiveRecords(records);
}

function renderFilteredArchived(records) {
  renderArchivedRecords(records);
}

/* ================= EDIT MODAL ================= */
function initializeEditModalEvents() {
  const closeBtn = document.getElementById("closeEditModal");
  const cancelBtn = document.getElementById("cancelEditBtn");
  const archiveBtn = document.getElementById("archiveEditBtn");
  const form = document.getElementById("editPatientForm");
  const imageInput = document.getElementById("editPetImageInput");

  document.addEventListener("click", function (event) {
    const editBtn = event.target.closest(".edit-btn");
    if (!editBtn) return;

    const index = Number(editBtn.dataset.index);
    openEditModal(index);
  });

  if (closeBtn) closeBtn.addEventListener("click", closeEditModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeEditModal);
  if (archiveBtn) archiveBtn.addEventListener("click", archiveCurrentRecord);
  if (form) form.addEventListener("submit", saveEditedRecord);

  if (imageInput) {
    imageInput.addEventListener("change", handleAvatarPreview);
  }
}

function openEditModal(index) {
  const modal = document.getElementById("editPatientModal");
  const record = patientRecords[index];

  if (!modal || !record) return;

  currentEditIndex = index;

  setValue("editId", record.id);
  setValue("editPetName", record.petName);
  setValue("editPetSpecies", record.petSpecies);
  setValue("editBreed", record.breed);
  setValue("editOwnerName", record.ownerName);
  setValue("editAppointmentType", record.appointmentType);

  setValue("editAppointmentDate", record.appointmentDate);
  setValue("editAppointmentTime", record.appointmentTime);

  editCalendarDate = record.appointmentDate
    ? new Date(record.appointmentDate)
    : new Date();

  setText(
    "editAppointmentSelectedDateText",
    record.appointmentDate ? formatFullDateUpper(record.appointmentDate) : "Schedule is locked"
  );

  setValue("editGender", record.gender);
  setValue("editWeight", record.weight);
  setValue("editAge", record.age);
  setValue("editContactNumber", record.contactNumber);
  setValue("editEmail", record.email);
  setValue("editInternalNotes", record.notes || record.internalNotes || "");
  setValue("editPetImageData", record.petImage);

  setText("editHeaderPetName", record.petName || "Pet Name");
  setText("editHeaderBreed", record.breed || "Breed");
  setText("editHeaderPatientId", `P-${record.id || "-"}`);
  setText("editPatientAvatarLetter", String(record.petName || "P").charAt(0).toUpperCase());

  showAvatar(record.petImage, record.petName);

  renderLockedEditCalendar();
  renderLockedEditTimeSlots();

  modal.classList.remove("hidden");
}

function closeEditModal() {
  const modal = document.getElementById("editPatientModal");
  if (!modal) return;

  modal.classList.add("hidden");
  currentEditIndex = null;
}

function saveEditedRecord(event) {
  event.preventDefault();

  if (currentEditIndex === null || !patientRecords[currentEditIndex]) return;

  const oldRecord = patientRecords[currentEditIndex];
  const appointmentType = getValue("editAppointmentType").trim();

  if (!appointmentType) {
    showNotification("Please select visit type.", "error");
    return;
  }

  patientRecords[currentEditIndex] = {
    ...oldRecord,
    id: getValue("editId"),
    petName: getValue("editPetName").trim(),
    petSpecies: getValue("editPetSpecies").trim(),
    breed: getValue("editBreed").trim(),
    ownerName: getValue("editOwnerName").trim(),

    appointmentDate: oldRecord.appointmentDate,
    appointmentTime: oldRecord.appointmentTime,

    appointmentType,

    gender: getValue("editGender").trim(),
    weight: getValue("editWeight").trim(),
    age: getValue("editAge").trim(),
    contactNumber: getValue("editContactNumber").trim(),
    email: getValue("editEmail").trim(),
    notes: getValue("editInternalNotes").trim(),
    internalNotes: getValue("editInternalNotes").trim(),
    petImage: getValue("editPetImageData"),

    appointmentArchived: false,
    archivedAt: "",
    appointmentArchivedAt: "",
    updatedAt: new Date().toISOString()
  };

  savePatientRecords();

  saveRecentActivity({
    dateTime: new Date().toLocaleString(),
    module: "Patient Records",
    action: "Edited Record",
    details: `${patientRecords[currentEditIndex].petName || "Patient"} record updated`
  });

  renderActiveRecords();
  closeEditModal();
  showNotification("Record updated successfully");
}

function archiveCurrentRecord() {
  if (currentEditIndex === null || !patientRecords[currentEditIndex]) return;

  const record = patientRecords[currentEditIndex];
  archiveRecordsByIds([record.id]);

  renderActiveRecords();
  closeEditModal();
}

function archiveSelectedActiveRecords() {
  const selected = document.querySelectorAll(".record-checkbox:checked");

  if (selected.length === 0) {
    showNotification("Please select at least 1 record to archive", "error");
    return;
  }

  const selectedIds = Array.from(selected)
    .map(function (checkbox) {
      return checkbox.dataset.id;
    })
    .filter(Boolean);

  archiveRecordsByIds(selectedIds);
  renderActiveRecords();
}

function archiveRecordsByIds(recordIds) {
  if (!Array.isArray(recordIds) || recordIds.length === 0) return;

  loadRecordsLocalStorage();

  const idsToArchive = recordIds.map(function (id) {
    return String(id);
  });

  const archivedNow = [];
  const remainingActiveRecords = [];

  patientRecords.forEach(function (record) {
    if (idsToArchive.includes(String(record.id))) {
      const archivedRecord = createArchivedPatientRecord(record);

      archivedNow.push(archivedRecord);
      saveArchivedAppointmentLog(archivedRecord);
    } else {
      remainingActiveRecords.push(record);
    }
  });

  if (archivedNow.length === 0) {
    showNotification("Selected record not found.", "error");
    return;
  }

  const archivedIds = archivedNow.map(function (record) {
    return String(record.id);
  });

  archivedPatientRecords = archivedPatientRecords.filter(function (record) {
    return !archivedIds.includes(String(record.id));
  });

  archivedPatientRecords = [
    ...archivedNow,
    ...archivedPatientRecords
  ];

  patientRecords = remainingActiveRecords;

  savePatientRecords();
  saveArchivedPatientRecords();

  saveRecentActivity({
    dateTime: new Date().toLocaleString(),
    module: "Patient Records",
    action: "Archived Record",
    details:
      archivedNow.length === 1
        ? `${archivedNow[0].petName || "Patient"} record archived`
        : `${archivedNow.length} patient record(s) archived`
  });

  showNotification(
    archivedNow.length === 1
      ? "Record archived successfully"
      : "Selected records archived successfully"
  );
}

function handleAvatarPreview() {
  const file = this.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (event) {
    const imageData = event.target.result;

    setValue("editPetImageData", imageData);
    showAvatar(imageData, getValue("editPetName"));
  };

  reader.readAsDataURL(file);
}

function showAvatar(imageData, petName) {
  const img = document.getElementById("editPatientAvatarImg");
  const letter = document.getElementById("editPatientAvatarLetter");

  if (!img || !letter) return;

  if (imageData) {
    img.src = imageData;
    img.classList.remove("hidden");
    letter.classList.add("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
    letter.classList.remove("hidden");
    letter.textContent = String(petName || "P").charAt(0).toUpperCase();
  }
}

/* ================= LOCKED PET RECORD EDIT SCHEDULE ================= */
function renderLockedEditCalendar() {
  const monthLabel = document.getElementById("editCalendarMonthLabel");
  const daysContainer = document.getElementById("editCalendarDays");
  const selectedDateInput = document.getElementById("editAppointmentDate");

  if (!monthLabel || !daysContainer || !selectedDateInput) return;

  const year = editCalendarDate.getFullYear();
  const month = editCalendarDate.getMonth();
  const selectedDate = selectedDateInput.value;

monthLabel.textContent = editCalendarDate.toLocaleDateString("en-US", {
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
    blank.className = "calendar-day disabled readonly-date";
    daysContainer.appendChild(blank);
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateKey = formatDateKey(date);

    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.className = "calendar-day readonly-date blocked-date";

    if (dateKey === selectedDate) {
      button.classList.add("selected", "locked-selected-date");
    }

    button.innerHTML = `
      <strong>${day}</strong>
      <small>${dateKey === selectedDate ? "Locked" : "Blocked"}</small>
    `;

    daysContainer.appendChild(button);
  }
}

function renderLockedEditTimeSlots() {
  const slotsContainer = document.getElementById("editAppointmentTimeSlots");
  const appointmentTime = getValue("editAppointmentTime");

  if (!slotsContainer) return;

  slotsContainer.innerHTML = "";

  if (!appointmentTime) {
    slotsContainer.innerHTML = `<p class="text-muted mb-0">No time selected</p>`;
    return;
  }

  const selectedTimes = String(appointmentTime)
    .split(",")
    .map(function (time) {
      return time.trim();
    })
    .filter(Boolean);

  selectedTimes.forEach(function (timeValue) {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.className = "time-slot-btn active locked-time-slot";
    button.textContent = formatSingleTime(timeValue);

    slotsContainer.appendChild(button);
  });
}

/* ================= QR ================= */
function initializeExportQr() {
  const exportBtn = document.getElementById("exportQrBtn");
  if (!exportBtn) return;

  exportBtn.addEventListener("click", function () {
    const selectedCheckboxes = document.querySelectorAll(".record-checkbox:checked");

    if (selectedCheckboxes.length === 0) {
      showNotification("Please select 1 record", "error");
      return;
    }

    if (selectedCheckboxes.length > 1) {
      showNotification("Please select only one record to generate QR", "error");
      return;
    }

    const index = selectedCheckboxes[0].dataset.index;
    const record = patientRecords[index];

    openQrModal(record);
  });
}

function openQrModal(record) {
  const modal = document.getElementById("qrModal");
  const qrBox = document.getElementById("qrCodeBox");

  if (!modal || !qrBox || !record) return;

  if (typeof QRCode === "undefined") {
    showNotification("QR library not loaded.", "error");
    return;
  }

  qrBox.innerHTML = "";

  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const qrUrl = `${baseUrl}?view=patient&id=${encodeURIComponent(record.id)}`;

  new QRCode(qrBox, {
    text: qrUrl,
    width: 200,
    height: 200,
    correctLevel: QRCode.CorrectLevel.H
  });

  setText("qrPatientName", record.petName || "Patient Record");
  setText("qrPatientDetails", `${record.ownerName || "-"} • ${record.appointmentType || "-"}`);

  modal.classList.remove("hidden");
}

function initializeQrModal() {
  const closeBtn = document.getElementById("closeQrModal");

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      document.getElementById("qrModal")?.classList.add("hidden");
    });
  }
}

function initializePrintQr() {
  const printBtn = document.getElementById("printQrBtn");
  if (!printBtn) return;

  printBtn.addEventListener("click", function () {
    const qrContent = document.getElementById("qrCodeBox")?.innerHTML || "";
    const name = document.getElementById("qrPatientName")?.textContent || "QR Code";

    const win = window.open("", "", "width=600,height=600");
    if (!win) return;

    win.document.write(`
      <html>
        <head>
          <title>Print QR</title>
        </head>
        <body style="text-align:center; font-family:sans-serif;">
          <h2>${escapeHTML(name)}</h2>
          ${qrContent}
        </body>
      </html>
    `);

    win.document.close();
    win.print();
  });
}

/* ================= PAGINATION ================= */
function updateRecordsShowingText(start, end, total) {
  const text = document.getElementById("recordsShowingText");
  if (!text) return;

  const totalPages = Math.ceil(total / RECORDS_PER_PAGE) || 1;

  if (total === 0) {
    text.textContent = "No records";
    return;
  }

  text.textContent = `Page ${currentRecordsPage} of ${totalPages} • ${total} records`;
}

function renderRecordsPagination(totalPages) {
  const pagination = document.getElementById("recordsPagination");
  if (!pagination) return;

  pagination.innerHTML = "";

  if (totalPages <= 1) return;

  const prevBtn = document.createElement("button");
  prevBtn.className = "logs-page-btn";
  prevBtn.textContent = "Prev";
  prevBtn.disabled = currentRecordsPage === 1;
  prevBtn.onclick = function () {
    currentRecordsPage--;
    renderActiveRecords(filteredActiveRecords);
  };
  pagination.appendChild(prevBtn);

  for (let i = 1; i <= totalPages; i++) {
    const pageBtn = document.createElement("button");
    pageBtn.className = `logs-page-btn ${i === currentRecordsPage ? "active" : ""}`;
    pageBtn.textContent = i;
    pageBtn.onclick = function () {
      currentRecordsPage = i;
      renderActiveRecords(filteredActiveRecords);
    };
    pagination.appendChild(pageBtn);
  }

  const nextBtn = document.createElement("button");
  nextBtn.className = "logs-page-btn";
  nextBtn.textContent = "Next";
  nextBtn.disabled = currentRecordsPage === totalPages;
  nextBtn.onclick = function () {
    currentRecordsPage++;
    renderActiveRecords(filteredActiveRecords);
  };
  pagination.appendChild(nextBtn);
}

/* ================= ARCHIVE ACTIONS ================= */
function retrieveSelectedArchivedRecords() {
  const selected = document.querySelectorAll(".archived-checkbox:checked");

  if (selected.length === 0) {
    showNotification("Please select at least 1 archived record", "error");
    return;
  }

  loadRecordsLocalStorage();

  const selectedIds = Array.from(selected)
    .map(function (checkbox) {
      return String(checkbox.dataset.id || "");
    })
    .filter(Boolean);

  const recordsToRetrieve = archivedPatientRecords.filter(function (record) {
    return selectedIds.includes(String(record.id));
  });

  if (recordsToRetrieve.length === 0) {
    showNotification("Selected archived record not found", "error");
    return;
  }

  const restoredRecords = recordsToRetrieve.map(function (record) {
    return createRetrievedPatientRecord(record);
  });

  const restoredIds = restoredRecords.map(function (record) {
    return String(record.id);
  });

  patientRecords = patientRecords.filter(function (record) {
    return !restoredIds.includes(String(record.id));
  });

  archivedPatientRecords = archivedPatientRecords.filter(function (record) {
    return !restoredIds.includes(String(record.id));
  });

  patientRecords = [
    ...restoredRecords,
    ...patientRecords
  ];

  savePatientRecords();
  saveArchivedPatientRecords();

  saveRecentActivity({
    dateTime: new Date().toLocaleString(),
    module: "Patient Records",
    action: "Retrieved Archived Record",
    details: `${restoredRecords.length} archived record(s) retrieved`
  });

  renderArchivedRecords();
  showNotification("Selected record(s) retrieved successfully");
}

function updateArchivedRecordsShowingText(total) {
  const text = document.getElementById("archivedRecordsShowingText");
  if (!text) return;

  if (total === 0) {
    text.textContent = "No records";
    return;
  }

  text.textContent = `Page 1 of 1 • ${total} record${total === 1 ? "" : "s"}`;
}

/* ================= PUBLIC PATIENT QR MOBILE VIEW ================= */
function initializePublicPatientQrMobileView() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const patientId = params.get("id");

  if (view !== "patient" || !patientId) return;

  loadRecordsLocalStorage();

  const patient = patientRecords.find(function (record) {
    return String(record.id) === String(patientId);
  });

  if (!patient) {
    showPatientQrNotFoundPage();
    return;
  }

  showPatientQrMobilePage(patient);
}

function showPatientQrMobilePage(patient) {
  document.getElementById("mainSystem")?.classList.add("hidden");
  document.getElementById("recordsPage")?.classList.add("hidden");
  document.getElementById("qrModal")?.classList.add("hidden");

  const publicPage = document.getElementById("publicPatientPage");
  const publicView = document.getElementById("patientPublicView");
  const accountView = document.getElementById("patientAccountView");

  if (!publicPage) {
    showPatientQrNotFoundPage("Mobile QR design section not found.");
    return;
  }

  window.__currentPatientFromQR = patient;

  publicPage.classList.remove("hidden");
  publicView?.classList.remove("hidden");
  accountView?.classList.add("hidden");

  setText("publicPatientName", patient.petName || "Patient Name");
  setText("publicPatientId", `Patient ID: P-${patient.id || "-"}`);

  setText("publicEmergencyName", patient.ownerName || "-");
  setText("publicEmergencyContact", patient.contactNumber || "-");

  setText("publicPetSpecies", patient.petSpecies || "-");
  setText("publicPetBreed", patient.breed || "-");
  setText("publicInternalNotes", patient.notes || patient.internalNotes || "No medical notes yet.");

  setPublicPatientAvatar(patient.petImage, patient.petName);

  bindPublicPatientTabs();
  startPublicQrClock();
}

function setPublicPatientAvatar(imageData, petName) {
  const img = document.getElementById("publicPatientAvatarImg");
  const letter = document.getElementById("publicPatientAvatarLetter");

  if (!img || !letter) return;

  if (imageData) {
    img.src = imageData;
    img.classList.remove("hidden");
    letter.classList.add("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
    letter.textContent = String(petName || "P").charAt(0).toUpperCase();
    letter.classList.remove("hidden");
  }
}

function bindPublicPatientTabs() {
  document.querySelectorAll("[data-public-target]").forEach(function (button) {
    button.onclick = function () {
      const target = this.dataset.publicTarget;

      document.querySelectorAll("[data-public-target]").forEach(function (item) {
        item.classList.remove("active");
      });

      this.classList.add("active");

      document.querySelectorAll(".fc-info-card").forEach(function (card) {
        card.classList.add("hidden");
        card.classList.remove("active");
      });

      const activePanel = document.getElementById(`publicPanel-${target}`);
      if (activePanel) {
        activePanel.classList.remove("hidden");
        activePanel.classList.add("active");
      }
    };
  });
}

function startPublicQrClock() {
  const timeText = document.getElementById("fcStatusTime");
  if (!timeText) return;

  function updateTime() {
    const now = new Date();

    timeText.textContent = now.toLocaleTimeString("en-PH", {
      hour: "numeric",
      minute: "2-digit",
      hour12: false
    });
  }

  updateTime();
  setInterval(updateTime, 1000);
}

function showPatientQrNotFoundPage(message = "This QR code does not match any active patient record.") {
  document.getElementById("mainSystem")?.classList.add("hidden");

  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#c9f4f6;font-family:Inter, Arial, sans-serif;padding:20px;">
      <div style="max-width:390px;width:100%;background:white;border-radius:28px;padding:28px;text-align:center;box-shadow:0 20px 50px rgba(15,23,42,.15);">
        <h2 style="margin:0 0 10px;color:#173f46;">Patient not found</h2>
        <p style="margin:0;color:#53737a;">${escapeHTML(message)}</p>
      </div>
    </div>
  `;
}

/* ================= PATIENT LOGIN FIX ================= */

function initializePatientLoginFormOnly() {
  const loginBtn = document.getElementById("publicPatientLoginBtn");
  const loginModal = document.getElementById("publicPatientLoginModal");
  const closeBtn = document.getElementById("publicLoginCloseBtn");
  const submitBtn = document.getElementById("publicLoginSubmitBtn");
  const passwordInput = document.getElementById("publicLoginPassword");
  const logoutBtn = document.getElementById("patientAccountLogoutBtn");
  const bookingBtn = document.getElementById("accountSubmitBookingBtn");

  if (loginBtn) {
    loginBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();

      const patient = getCurrentPatientForLogin();

      if (!patient) {
        alert("Patient record not found.");
        return;
      }

      if (!loginModal) {
        alert("Patient login modal not found.");
        return;
      }

      const idInput = document.getElementById("publicLoginPatientId");
      const errorBox = document.getElementById("publicLoginError");

      if (idInput) {
        idInput.value = `P-${patient.id}`;
        idInput.readOnly = true;
      }

      if (passwordInput) {
        passwordInput.value = "";
      }

      if (errorBox) {
        errorBox.textContent = "";
        errorBox.classList.add("hidden");
      }

      document.getElementById("patientPublicView")?.classList.remove("hidden");
      document.getElementById("patientAccountView")?.classList.add("hidden");

      loginModal.classList.remove("hidden");

      setTimeout(function () {
        passwordInput?.focus();
      }, 100);
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      loginModal?.classList.add("hidden");

      document.getElementById("patientPublicView")?.classList.remove("hidden");
      document.getElementById("patientAccountView")?.classList.add("hidden");
    });
  }

  if (loginModal) {
    loginModal.addEventListener("click", function (event) {
      if (event.target === loginModal) {
        loginModal.classList.add("hidden");

        document.getElementById("patientPublicView")?.classList.remove("hidden");
        document.getElementById("patientAccountView")?.classList.add("hidden");
      }
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", function (event) {
      event.preventDefault();
      handlePublicPatientLogin();
    });
  }

  if (passwordInput) {
    passwordInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        handlePublicPatientLogin();
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      document.getElementById("patientAccountView")?.classList.add("hidden");
      document.getElementById("patientPublicView")?.classList.remove("hidden");
      openPatientAccountPage("home");
    });
  }

  if (bookingBtn) {
    bookingBtn.addEventListener("click", submitPatientBookingRequest);
  }
}

function getCurrentPatientForLogin() {
  loadRecordsLocalStorage();

  const params = new URLSearchParams(window.location.search);

  const patientId =
    params.get("id") ||
    window.__currentPatientId ||
    window.__currentPatientFromQR?.id;

  if (!patientId) return null;

  const patient = patientRecords.find(function (record) {
    return String(record.id) === String(patientId);
  });

  if (patient) {
    window.__currentPatientId = patient.id;
    window.__currentPatientFromQR = patient;
  }

  return patient || null;
}

function handlePublicPatientLogin() {
  const patient = getCurrentPatientForLogin();

  if (!patient) {
    alert("Patient record not found.");
    return;
  }

  const idInput = document.getElementById("publicLoginPatientId");
  const passwordInput = document.getElementById("publicLoginPassword");
  const errorBox = document.getElementById("publicLoginError");

  const enteredId = String(idInput?.value || "")
    .trim()
    .replace(/^P-/i, "");

  const enteredPassword = String(passwordInput?.value || "").trim();

  const correctId = String(patient.id);
  const correctPassword = getPatientLoginPassword(patient);

  const acceptedPasswords = [correctPassword];

  if (!hasSavedPatientPassword(patient)) {
    acceptedPasswords.push("1234");
  }

  if (!enteredPassword) {
    if (errorBox) {
      errorBox.textContent = "Please enter your password.";
      errorBox.classList.remove("hidden");
    }

    passwordInput?.focus();
    return;
  }

  if (enteredId !== correctId || !acceptedPasswords.includes(enteredPassword)) {
    if (errorBox) {
      errorBox.textContent = "Invalid Patient ID or password.";
      errorBox.classList.remove("hidden");
    }

    if (passwordInput) {
      passwordInput.value = "";
      passwordInput.focus();
    }

    return;
  }

  document.getElementById("publicPatientLoginModal")?.classList.add("hidden");
  document.getElementById("patientPublicView")?.classList.add("hidden");
  document.getElementById("patientAccountView")?.classList.remove("hidden");

  renderPatientAccountView(patient);
  openPatientAccountPage("home");
}

function renderPatientAccountView(patient) {
  buildPatientAccountSettingsUI();
  initializePatientAccountSettings();

  setText("accountPatientName", patient.petName || "Patient Name");
  setText("accountPatientId", `Patient ID: P-${patient.id || "-"}`);
  setText("settingsPatientId", `P-${patient.id || "-"}`);
  setText("settingsPasswordText", maskPassword(getPatientLoginPassword(patient)));

  setText("accountOwnerName", patient.ownerName || "-");
  setText("accountOwnerContact", patient.contactNumber || patient.ownerContact || "-");
  setText("accountOwnerEmail", patient.email || "-");

  setText("accountPetName", patient.petName || "-");
  setText("accountPetSpecies", patient.petSpecies || "-");
  setText("accountPetBreed", patient.breed || patient.petBreed || "-");
  setText("accountPetAge", patient.age || "-");
  setText("accountPetGender", patient.gender || "-");
  setText("accountPetWeight", patient.weight || "-");

  setText("accountMedicalNotes", patient.notes || patient.internalNotes || "No medical notes yet.");

  setText("accountCurrentSchedule", formatSchedule(patient.appointmentDate, patient.appointmentTime));
  setText(
    "accountNextSchedule",
    patient.nextAppointmentDate ? formatSchedule(patient.nextAppointmentDate, patient.nextAppointmentTime) : "-"
  );

  setText("accountAppointmentType", patient.appointmentType || "-");
  setText("accountAppointmentStatus", patient.appointmentStatus || "Waiting");

  setPatientAccountAvatar(patient.petImage, patient.petName);
  populatePatientSettingsForms(patient);
}

function setPatientAccountAvatar(imageData, petName) {
  const img = document.getElementById("accountPatientAvatarImg");
  const letter = document.getElementById("accountPatientAvatarLetter");

  if (!img || !letter) return;

  if (imageData) {
    img.src = imageData;
    img.classList.remove("hidden");
    letter.classList.add("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
    letter.textContent = String(petName || "P").charAt(0).toUpperCase();
    letter.classList.remove("hidden");
  }
}

function openPatientAccountPage(pageName) {
  document.querySelectorAll(".patient-account-page").forEach(function (page) {
    page.classList.add("hidden");
  });

  const targetId = pageName === "home"
    ? "patientAccountHome"
    : `patientAccountPage-${pageName}`;

  document.getElementById(targetId)?.classList.remove("hidden");

  if (pageName === "settings") {
    const patient = getCurrentPatientForLogin();

    if (patient) {
      buildPatientAccountSettingsUI();
      initializePatientAccountSettings();
      populatePatientSettingsForms(patient);
      setText("settingsPatientId", `P-${patient.id || "-"}`);
      setText("settingsPasswordText", maskPassword(getPatientLoginPassword(patient)));
    }
  }
}

/* ================= PATIENT ACCOUNT SETTINGS SYNC ================= */

function buildPatientAccountSettingsUI() {
  const settingsPage = document.getElementById("patientAccountPage-settings");

  if (!settingsPage) return;

  injectPatientSettingsModalStyles();

  if (document.getElementById("settingsActionButtons")) return;

  settingsPage.innerHTML = `
    <button type="button" class="fc-back-btn" onclick="openPatientAccountPage('home')">← Back</button>

    <div class="fc-detail-card">
      <h2>Account Settings</h2>
      <p class="fc-settings-subtext">
        Choose what you want to update.
      </p>

      <div id="settingsActionButtons" class="fc-settings-button-list">
        <button type="button" class="fc-settings-action-btn" id="openChangePasswordBtn">
          <span class="fc-settings-icon">🔒</span>
          <span>
            <strong>Change Password</strong>
            <small>Update your account password</small>
          </span>
        </button>

        <button type="button" class="fc-settings-action-btn" id="openChangeOwnerBtn">
          <span class="fc-settings-icon">👤</span>
          <span>
            <strong>Change Owner Information</strong>
            <small>Edit owner name, contact, and email</small>
          </span>
        </button>

        <button type="button" class="fc-settings-action-btn" id="openChangePetBtn">
          <span class="fc-settings-icon">🐾</span>
          <span>
            <strong>Change Pet Information</strong>
            <small>Edit pet details and profile information</small>
          </span>
        </button>
      </div>
    </div>

    <div id="patientSettingsModal" class="fc-settings-modal hidden">
      <div class="fc-settings-modal-box">
        <button type="button" class="fc-settings-modal-close" onclick="closePatientSettingsModal()">×</button>

        <form id="settingsPasswordForm" class="fc-settings-form hidden">
          <h2>Change Password</h2>
          <p class="fc-settings-subtext">Enter your current password before saving a new one.</p>

          <label for="settingsCurrentPassword">Current Password</label>
          <input type="password" id="settingsCurrentPassword" class="fc-input" placeholder="Enter current password">

          <label for="settingsNewPassword">New Password</label>
          <input type="password" id="settingsNewPassword" class="fc-input" placeholder="Enter new password">

          <label for="settingsConfirmPassword">Confirm New Password</label>
          <input type="password" id="settingsConfirmPassword" class="fc-input" placeholder="Confirm new password">

          <button type="submit" class="fc-submit-btn">Save Password</button>
          <div id="settingsPasswordMessage" class="fc-success hidden"></div>
        </form>

        <form id="settingsOwnerForm" class="fc-settings-form hidden">
          <h2>Change Owner Information</h2>
          <p class="fc-settings-subtext">Update the owner details connected to this patient record.</p>

          <label for="settingsOwnerName">Owner Name</label>
          <input type="text" id="settingsOwnerName" class="fc-input" placeholder="Owner name">

          <label for="settingsOwnerContact">Contact Number</label>
          <input type="text" id="settingsOwnerContact" class="fc-input" placeholder="Contact number">

          <label for="settingsOwnerEmail">Email</label>
          <input type="email" id="settingsOwnerEmail" class="fc-input" placeholder="Email address">

          <button type="submit" class="fc-submit-btn">Save Owner Information</button>
          <div id="settingsOwnerMessage" class="fc-success hidden"></div>
        </form>

        <form id="settingsPetForm" class="fc-settings-form hidden">
          <h2>Change Pet Information</h2>
          <p class="fc-settings-subtext">Update your pet’s basic information.</p>

          <label for="settingsPetName">Pet Name</label>
          <input type="text" id="settingsPetName" class="fc-input" placeholder="Pet name">

          <label for="settingsPetSpecies">Species</label>
          <input type="text" id="settingsPetSpecies" class="fc-input" placeholder="Species">

          <label for="settingsPetBreed">Breed</label>
          <input type="text" id="settingsPetBreed" class="fc-input" placeholder="Breed">

          <label for="settingsPetAge">Age</label>
          <input type="text" id="settingsPetAge" class="fc-input" placeholder="Age">

          <label for="settingsPetGender">Gender</label>
          <input type="text" id="settingsPetGender" class="fc-input" placeholder="Gender">

          <label for="settingsPetWeight">Weight</label>
          <input type="text" id="settingsPetWeight" class="fc-input" placeholder="Weight">

          <button type="submit" class="fc-submit-btn">Save Pet Information</button>
          <div id="settingsPetMessage" class="fc-success hidden"></div>
        </form>
      </div>
    </div>
  `;
}

function initializePatientAccountSettings() {
  buildPatientAccountSettingsUI();

  const passwordForm = document.getElementById("settingsPasswordForm");
  const ownerForm = document.getElementById("settingsOwnerForm");
  const petForm = document.getElementById("settingsPetForm");

  const openChangePasswordBtn = document.getElementById("openChangePasswordBtn");
  const openChangeOwnerBtn = document.getElementById("openChangeOwnerBtn");
  const openChangePetBtn = document.getElementById("openChangePetBtn");

  if (openChangePasswordBtn && openChangePasswordBtn.dataset.bound !== "true") {
    openChangePasswordBtn.addEventListener("click", function () {
      openPatientSettingsSection("password");
    });
    openChangePasswordBtn.dataset.bound = "true";
  }

  if (openChangeOwnerBtn && openChangeOwnerBtn.dataset.bound !== "true") {
    openChangeOwnerBtn.addEventListener("click", function () {
      openPatientSettingsSection("owner");
    });
    openChangeOwnerBtn.dataset.bound = "true";
  }

  if (openChangePetBtn && openChangePetBtn.dataset.bound !== "true") {
    openChangePetBtn.addEventListener("click", function () {
      openPatientSettingsSection("pet");
    });
    openChangePetBtn.dataset.bound = "true";
  }

  if (passwordForm && passwordForm.dataset.bound !== "true") {
    passwordForm.addEventListener("submit", handlePatientPasswordChange);
    passwordForm.dataset.bound = "true";
  }

  if (ownerForm && ownerForm.dataset.bound !== "true") {
    ownerForm.addEventListener("submit", handlePatientOwnerInfoChange);
    ownerForm.dataset.bound = "true";
  }

  if (petForm && petForm.dataset.bound !== "true") {
    petForm.addEventListener("submit", handlePatientPetInfoChange);
    petForm.dataset.bound = "true";
  }
}

function hasSavedPatientPassword(patient) {
  return Boolean(patient?.patientPassword || patient?.password || patient?.accountPassword);
}

function getPatientLoginPassword(patient) {
  return String(
    patient?.patientPassword ||
    patient?.password ||
    patient?.accountPassword ||
    "1234"
  ).trim();
}

function maskPassword(password) {
  const length = Math.max(String(password || "").length, 4);
  return "•".repeat(length);
}

function populatePatientSettingsForms(patient) {
  if (!patient) return;

  setValue("settingsOwnerName", patient.ownerName || "");
  setValue("settingsOwnerContact", patient.contactNumber || patient.ownerContact || "");
  setValue("settingsOwnerEmail", patient.email || "");

  setValue("settingsPetName", patient.petName || "");
  setValue("settingsPetSpecies", patient.petSpecies || "");
  setValue("settingsPetBreed", patient.breed || patient.petBreed || "");
  setValue("settingsPetAge", patient.age || "");
  setValue("settingsPetGender", patient.gender || "");
  setValue("settingsPetWeight", patient.weight || "");
}

function handlePatientPasswordChange(event) {
  event.preventDefault();

  const patient = getCurrentPatientForLogin();
  if (!patient) return;

  const currentPassword = getValue("settingsCurrentPassword").trim();
  const newPassword = getValue("settingsNewPassword").trim();
  const confirmPassword = getValue("settingsConfirmPassword").trim();
  const actualPassword = getPatientLoginPassword(patient);

  if (!currentPassword || !newPassword || !confirmPassword) {
    showPatientSettingsMessage("settingsPasswordMessage", "Please complete all password fields.", "error");
    return;
  }

  if (currentPassword !== actualPassword) {
    showPatientSettingsMessage("settingsPasswordMessage", "Current password is incorrect.", "error");
    return;
  }

  if (newPassword.length < 4) {
    showPatientSettingsMessage("settingsPasswordMessage", "New password must be at least 4 characters.", "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    showPatientSettingsMessage("settingsPasswordMessage", "New passwords do not match.", "error");
    return;
  }

  const updatedPatient = updateCurrentPatientRecord(
    {
      patientPassword: newPassword,
      password: newPassword,
      accountPassword: newPassword
    },
    "Changed Password",
    `${patient.petName || "Patient"} updated patient login password`
  );

  if (!updatedPatient) return;

  setValue("settingsCurrentPassword", "");
  setValue("settingsNewPassword", "");
  setValue("settingsConfirmPassword", "");

  showPatientSettingsMessage("settingsPasswordMessage", "Password updated successfully.");
}

function handlePatientOwnerInfoChange(event) {
  event.preventDefault();

  const patient = getCurrentPatientForLogin();
  if (!patient) return;

  const ownerName = getValue("settingsOwnerName").trim();
  const contactNumber = getValue("settingsOwnerContact").trim();
  const email = getValue("settingsOwnerEmail").trim();

  if (!ownerName || !contactNumber) {
    showPatientSettingsMessage("settingsOwnerMessage", "Owner name and contact number are required.", "error");
    return;
  }

  const updatedPatient = updateCurrentPatientRecord(
    {
      ownerName,
      contactNumber,
      ownerContact: contactNumber,
      email
    },
    "Changed Owner Information",
    `${patient.petName || "Patient"} owner information updated`
  );

  if (!updatedPatient) return;

  showPatientSettingsMessage("settingsOwnerMessage", "Owner information updated successfully.");
}

function handlePatientPetInfoChange(event) {
  event.preventDefault();

  const patient = getCurrentPatientForLogin();
  if (!patient) return;

  const petName = getValue("settingsPetName").trim();
  const petSpecies = getValue("settingsPetSpecies").trim();
  const breed = getValue("settingsPetBreed").trim();
  const age = getValue("settingsPetAge").trim();
  const gender = getValue("settingsPetGender").trim();
  const weight = getValue("settingsPetWeight").trim();

  if (!petName || !petSpecies || !breed) {
    showPatientSettingsMessage("settingsPetMessage", "Pet name, species, and breed are required.", "error");
    return;
  }

  const updatedPatient = updateCurrentPatientRecord(
    {
      petName,
      petSpecies,
      breed,
      petBreed: breed,
      age,
      gender,
      weight
    },
    "Changed Pet Information",
    `${petName || "Patient"} pet information updated`
  );

  if (!updatedPatient) return;

  showPatientSettingsMessage("settingsPetMessage", "Pet information updated successfully.");
}

function updateCurrentPatientRecord(changes, activityAction, activityDetails) {
  loadRecordsLocalStorage();

  const params = new URLSearchParams(window.location.search);

  const patientId =
    params.get("id") ||
    window.__currentPatientId ||
    window.__currentPatientFromQR?.id;

  const recordIndex = patientRecords.findIndex(function (record) {
    return String(record.id) === String(patientId);
  });

  if (recordIndex === -1) {
    showPatientSettingsMessage("settingsOwnerMessage", "Patient record not found.", "error");
    return null;
  }

  const oldRecord = patientRecords[recordIndex];

  const updatedRecord = {
    ...oldRecord,
    ...changes,
    updatedAt: new Date().toISOString()
  };

  patientRecords[recordIndex] = updatedRecord;

  savePatientRecords();
  syncPatientRecordRelatedStorage(updatedRecord);

  window.__currentPatientId = updatedRecord.id;
  window.__currentPatientFromQR = updatedRecord;

  renderPatientAccountView(updatedRecord);
  renderPublicPatientSnapshot(updatedRecord);

  if (document.getElementById("recordsTableBody")) {
    renderActiveRecords();
  }

  saveRecentActivity({
    dateTime: new Date().toLocaleString(),
    module: "Patient Portal",
    action: activityAction,
    details: activityDetails
  });

  return updatedRecord;
}

function syncPatientRecordRelatedStorage(updatedRecord) {
  const patientId = String(updatedRecord.id || "");

  onlineAppointmentRequests = getLocalStorageArray(RECORDS_STORAGE_KEYS.onlineAppointmentRequests).map(function (request) {
    const requestPatientId = String(request.patientId || request.id || "");

    if (requestPatientId !== patientId) return request;

    return {
      ...request,
      petName: updatedRecord.petName || request.petName || "",
      ownerName: updatedRecord.ownerName || request.ownerName || "",
      contactNumber: updatedRecord.contactNumber || request.contactNumber || "",
      ownerContact: updatedRecord.contactNumber || updatedRecord.ownerContact || request.ownerContact || "",
      email: updatedRecord.email || request.email || "",
      updatedAt: new Date().toISOString()
    };
  });

  saveOnlineAppointmentRequests();

  const archivedAppointments = getLocalStorageArray(RECORDS_STORAGE_KEYS.archivedAppointments).map(function (appointment) {
    if (String(appointment.id || appointment.patientId || "") !== patientId) return appointment;

    return {
      ...appointment,
      petName: updatedRecord.petName || appointment.petName || "",
      ownerName: updatedRecord.ownerName || appointment.ownerName || "",
      ownerContact: updatedRecord.contactNumber || updatedRecord.ownerContact || appointment.ownerContact || "",
      updatedAt: new Date().toISOString()
    };
  });

  setLocalStorageArray(RECORDS_STORAGE_KEYS.archivedAppointments, archivedAppointments);
}

function renderPublicPatientSnapshot(patient) {
  setText("publicPatientName", patient.petName || "Patient Name");
  setText("publicPatientId", `Patient ID: P-${patient.id || "-"}`);
  setText("publicEmergencyName", patient.ownerName || "-");
  setText("publicEmergencyContact", patient.contactNumber || patient.ownerContact || "-");
  setText("publicPetSpecies", patient.petSpecies || "-");
  setText("publicPetBreed", patient.breed || patient.petBreed || "-");
  setText("publicInternalNotes", patient.notes || patient.internalNotes || "No medical notes yet.");
  setPublicPatientAvatar(patient.petImage, patient.petName);
}

function showPatientSettingsMessage(elementId, message, type = "success") {
  const messageBox = document.getElementById(elementId);
  if (!messageBox) return;

  messageBox.textContent = message;
  messageBox.classList.remove("hidden", "fc-success", "fc-error");

  if (type === "error") {
    messageBox.classList.add("fc-error");
    messageBox.style.color = "#dc3545";
    messageBox.style.fontWeight = "800";
  } else {
    messageBox.classList.add("fc-success");
    messageBox.style.color = "#198754";
    messageBox.style.fontWeight = "800";
  }
}

/* ================= PATIENT BOOKING REQUEST ================= */

function submitPatientBookingRequest() {
  const patient = getCurrentPatientForLogin();
  if (!patient) return;

  const serviceInput = document.getElementById("accountBookingService");
  const dateInput = document.getElementById("accountBookingDate");
  const timeInput = document.getElementById("accountBookingTime");
  const messageBox = document.getElementById("accountBookingMessage");

  const service = serviceInput?.value || "";
  const date = dateInput?.value || "";
  const time = timeInput?.value || "";

  if (!service || !date || !time) {
    alert("Please complete service, date, and time.");
    return;
  }

  onlineAppointmentRequests = getLocalStorageArray(RECORDS_STORAGE_KEYS.onlineAppointmentRequests);

  const request = {
    requestId: Date.now(),
    id: patient.id,
    patientId: patient.id,
    petName: patient.petName || "",
    ownerName: patient.ownerName || "",
    contactNumber: patient.contactNumber || patient.ownerContact || "",
    ownerContact: patient.contactNumber || patient.ownerContact || "",
    email: patient.email || "",
    service,
    requestedDate: date,
    requestedTime: time,
    appointmentDate: date,
    appointmentTime: time,
    status: "Pending",
    createdAt: new Date().toISOString()
  };

  onlineAppointmentRequests.push(request);
  saveOnlineAppointmentRequests();

  saveRecentActivity({
    dateTime: new Date().toLocaleString(),
    module: "Patient Portal",
    action: "Submitted Booking Request",
    details: `${patient.petName || "Patient"} requested ${service}`
  });

  if (messageBox) {
    messageBox.textContent = "Appointment request submitted successfully.";
    messageBox.classList.remove("hidden");
  }

  if (serviceInput) serviceInput.value = "";
  if (dateInput) dateInput.value = "";
  if (timeInput) timeInput.value = "";
}

/* ================= RECORD ARCHIVE HELPERS ================= */

function isPatientRecordArchived(record) {
  return (
    record?.appointmentArchived === true ||
    record?.archived === true ||
    record?.isArchived === true ||
    String(record?.status || "").toLowerCase() === "archived"
  );
}

function createActivePatientRecord(record) {
  return {
    ...record,
    appointmentArchived: false,
    archived: false,
    isArchived: false
  };
}

function createArchivedPatientRecord(record) {
  const archivedAt =
    record.archivedAt ||
    record.appointmentArchivedAt ||
    record.dateArchived ||
    new Date().toISOString();

  return {
    ...record,
    appointmentArchived: true,
    archived: true,
    isArchived: true,
    archivedAt,
    appointmentArchivedAt: archivedAt,
    dateArchived: archivedAt,
    status: record.status || "Archived"
  };
}

function createRetrievedPatientRecord(record) {
  return {
    ...record,
    appointmentArchived: false,
    archived: false,
    isArchived: false,
    archivedAt: "",
    appointmentArchivedAt: "",
    dateArchived: "",
    retrievedAt: new Date().toISOString(),
    status: record.status === "Archived" ? "Active" : record.status || "Active"
  };
}

function mergeUniqueRecords(records) {
  const uniqueRecords = [];
  const usedIds = new Set();

  records.forEach(function (record) {
    const id = String(record.id || "");

    if (!id) return;

    if (!usedIds.has(id)) {
      usedIds.add(id);
      uniqueRecords.push(record);
    }
  });

  return uniqueRecords;
}

function sortActiveRecordsLifo(records) {
  return [...records].sort(function (a, b) {
    return getActiveRecordSortTime(b) - getActiveRecordSortTime(a);
  });
}

function sortArchivedRecordsLifo(records) {
  return [...records].sort(function (a, b) {
    return getArchivedRecordSortTime(b) - getArchivedRecordSortTime(a);
  });
}

function getActiveRecordSortTime(record) {
  const rawDate =
    record.retrievedAt ||
    record.createdAt ||
    record.dateCreated ||
    record.registeredAt ||
    "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  return Number(record.id) || 0;
}

function getArchivedRecordSortTime(record) {
  const rawDate =
    record.archivedAt ||
    record.appointmentArchivedAt ||
    record.dateArchived ||
    record.createdAt ||
    "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  return Number(record.id) || 0;
}

/* ================= HELPERS ================= */

function formatSchedule(date, time) {
  if (!date) return "-";

  const dateText = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  if (!time) return dateText;

  return `${dateText} ${formatTime(time)}`;
}

function formatTime(time) {
  if (!time) return "-";

  if (String(time).includes(",")) {
    const times = String(time)
      .split(",")
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);

    if (times.length === 0) return "-";
    if (times.length === 1) return formatSingleTime(times[0]);

    return `${formatSingleTime(times[0])} - ${formatSingleTime(times[times.length - 1])}`;
  }

  return formatSingleTime(time);
}

function formatSingleTime(time) {
  if (!time || !String(time).includes(":")) return "-";

  let [hour, minute] = String(time).split(":");
  hour = parseInt(hour, 10);

  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;

  return `${hour}:${minute} ${ampm}`;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatFullDateUpper(dateValue) {
  if (!dateValue) return "-";

  return new Date(dateValue).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).toUpperCase();
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
  }, 2000);

  setTimeout(function () {
    notif.remove();
  }, 2500);
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function closeAllPatientSettingsSections() {
  const passwordForm = document.getElementById("settingsPasswordForm");
  const ownerForm = document.getElementById("settingsOwnerForm");
  const petForm = document.getElementById("settingsPetForm");

  passwordForm?.classList.add("hidden");
  ownerForm?.classList.add("hidden");
  petForm?.classList.add("hidden");
}

function openPatientSettingsSection(section) {
  closeAllPatientSettingsSections();

  if (section === "password") {
    document.getElementById("settingsPasswordForm")?.classList.remove("hidden");
  }

  if (section === "owner") {
    document.getElementById("settingsOwnerForm")?.classList.remove("hidden");
  }

  if (section === "pet") {
    document.getElementById("settingsPetForm")?.classList.remove("hidden");
  }
}