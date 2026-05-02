document.addEventListener("DOMContentLoaded", function () {
  initializeExportQr();
  initializeQrModal();
  initializePrintQr();
  initializeRecordsPage();
  initializePublicPatientQrMobileView();
  initializePatientLoginFormOnly();
});

const RECORDS_PER_PAGE = 8;

let currentRecordsPage = 1;
let filteredActiveRecords = [];
let currentEditIndex = null;
let editCalendarDate = new Date();

/* ================= DATA ================= */

let patientRecords = [];
let onlineAppointmentRequests = [];

function savePatientRecords() {
  // Database save/update will be added later.
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

  const activeRecords = records || patientRecords.filter(record => !record.appointmentArchived);
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

  pageRecords.forEach(record => {
    const actualIndex = patientRecords.findIndex(item => String(item.id) === String(record.id));

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="record-checkbox" data-index="${actualIndex}"></td>
      <td>${record.id || ""}</td>
      <td>${record.petName || ""}</td>
      <td>${record.petSpecies || ""}</td>
      <td>${record.breed || ""}</td>
      <td>${record.ownerName || ""}</td>
      <td>${record.appointmentType || ""}</td>
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

  if (search) {
    search.addEventListener("input", function () {
      const keyword = this.value.toLowerCase().trim();

      const filtered = patientRecords.filter(record =>
        !record.appointmentArchived &&
        (
          String(record.id || "").toLowerCase().includes(keyword) ||
          String(record.petName || "").toLowerCase().includes(keyword) ||
          String(record.petSpecies || "").toLowerCase().includes(keyword) ||
          String(record.breed || "").toLowerCase().includes(keyword) ||
          String(record.ownerName || "").toLowerCase().includes(keyword) ||
          String(record.appointmentType || "").toLowerCase().includes(keyword)
        )
      );

      currentRecordsPage = 1;
      renderActiveRecords(filtered);
    });
  }

  if (selectAll) {
    selectAll.addEventListener("change", function () {
      document.querySelectorAll(".record-checkbox").forEach(checkbox => {
        checkbox.checked = this.checked;
      });
    });
  }

  document.addEventListener("click", function (event) {
    const row = event.target.closest("#recordsTableBody tr");
    if (!row) return;

    if (
      event.target.closest("button") ||
      event.target.closest("input[type='checkbox']")
    ) return;

    const checkbox = row.querySelector(".record-checkbox");
    if (!checkbox) return;

    checkbox.checked = !checkbox.checked;
  });
}

/* ================= ARCHIVED RECORDS ================= */

function renderArchivedRecords(records = null) {
  const body = document.getElementById("archivedRecordsTableBody");
  if (!body) return;

  body.innerHTML = "";

  const archivedRecords = records || patientRecords.filter(record => record.appointmentArchived);
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

  archivedRecords.forEach(record => {
    const actualIndex = patientRecords.findIndex(item => String(item.id) === String(record.id));

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="archived-checkbox" data-index="${actualIndex}"></td>
      <td>${record.id || ""}</td>
      <td>${record.petName || ""}</td>
      <td>${record.petSpecies || ""}</td>
      <td>${record.breed || ""}</td>
      <td>${record.ownerName || ""}</td>
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

      const filtered = patientRecords.filter(record =>
        record.appointmentArchived &&
        (
          String(record.id || "").toLowerCase().includes(keyword) ||
          String(record.petName || "").toLowerCase().includes(keyword) ||
          String(record.petSpecies || "").toLowerCase().includes(keyword) ||
          String(record.breed || "").toLowerCase().includes(keyword) ||
          String(record.ownerName || "").toLowerCase().includes(keyword)
        )
      );

      renderArchivedRecords(filtered);
    });
  }

  if (selectAll) {
    selectAll.addEventListener("change", function () {
      document.querySelectorAll(".archived-checkbox").forEach(checkbox => {
        checkbox.checked = this.checked;
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
  setText("editHeaderPatientId", `P-${record.id || "1001"}`);
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
    petImage: getValue("editPetImageData")
  };

  savePatientRecords();
  renderActiveRecords();
  closeEditModal();
  showNotification("Record updated successfully");
}

function archiveCurrentRecord() {
  if (currentEditIndex === null || !patientRecords[currentEditIndex]) return;

  patientRecords[currentEditIndex].appointmentArchived = true;

  savePatientRecords();
  renderActiveRecords();
  closeEditModal();
  showNotification("Record archived successfully");
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
    .map(time => time.trim())
    .filter(Boolean);

  selectedTimes.forEach(timeValue => {
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
          <h2>${name}</h2>
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

  selected.forEach(checkbox => {
    const index = Number(checkbox.dataset.index);

    if (patientRecords[index]) {
      patientRecords[index].appointmentArchived = false;
    }
  });

  savePatientRecords();
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

  const patient = patientRecords.find(record => String(record.id) === String(patientId));

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
  document.querySelectorAll("[data-public-target]").forEach(button => {
    button.onclick = function () {
      const target = this.dataset.publicTarget;

      document.querySelectorAll("[data-public-target]").forEach(item => {
        item.classList.remove("active");
      });

      this.classList.add("active");

      document.querySelectorAll(".fc-info-card").forEach(card => {
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

function showPatientQrNotFoundPage(message = "This QR code does not match any patient record.") {
  document.getElementById("mainSystem")?.classList.add("hidden");

  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#c9f4f6;font-family:Inter, Arial, sans-serif;padding:20px;">
      <div style="max-width:390px;width:100%;background:white;border-radius:28px;padding:28px;text-align:center;box-shadow:0 20px 50px rgba(15,23,42,.15);">
        <h2 style="margin:0 0 10px;color:#173f46;">Patient not found</h2>
        <p style="margin:0;color:#53737a;">${message}</p>
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

      setTimeout(() => passwordInput?.focus(), 100);
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
  if (window.__currentPatientFromQR) {
    return window.__currentPatientFromQR;
  }

  const params = new URLSearchParams(window.location.search);
  const patientId = params.get("id");

  if (!patientId) return null;

  const patient = patientRecords.find(record =>
    String(record.id) === String(patientId)
  );

  if (patient) {
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
  const correctPassword = String(patient.patientPassword || "").trim();

  if (!enteredPassword) {
    if (errorBox) {
      errorBox.textContent = "Please enter your password.";
      errorBox.classList.remove("hidden");
    }

    passwordInput?.focus();
    return;
  }

  if (!correctPassword) {
    if (errorBox) {
      errorBox.textContent = "Patient password is not set.";
      errorBox.classList.remove("hidden");
    }

    return;
  }

  if (enteredId !== correctId || enteredPassword !== correctPassword) {
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
  setText("accountPatientName", patient.petName || "Patient Name");
  setText("accountPatientId", `Patient ID: P-${patient.id || "-"}`);
  setText("settingsPatientId", `P-${patient.id || "-"}`);

  setText("accountOwnerName", patient.ownerName || "-");
  setText("accountOwnerContact", patient.contactNumber || "-");
  setText("accountOwnerEmail", patient.email || "-");

  setText("accountPetName", patient.petName || "-");
  setText("accountPetSpecies", patient.petSpecies || "-");
  setText("accountPetBreed", patient.breed || "-");
  setText("accountPetAge", patient.age || "-");
  setText("accountPetGender", patient.gender || "-");
  setText("accountPetWeight", patient.weight || "-");

  setText("accountMedicalNotes", patient.notes || patient.internalNotes || "No medical notes yet.");

  setText("accountCurrentSchedule", formatSchedule(patient.appointmentDate, patient.appointmentTime));
  setText("accountNextSchedule", patient.nextAppointmentDate ? formatSchedule(patient.nextAppointmentDate, patient.nextAppointmentTime) : "-");
  setText("accountAppointmentType", patient.appointmentType || "-");
  setText("accountAppointmentStatus", patient.appointmentStatus || "Waiting");

  setPatientAccountAvatar(patient.petImage, patient.petName);
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
  document.querySelectorAll(".patient-account-page").forEach(page => {
    page.classList.add("hidden");
  });

  const targetId = pageName === "home"
    ? "patientAccountHome"
    : `patientAccountPage-${pageName}`;

  document.getElementById(targetId)?.classList.remove("hidden");
}

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

  onlineAppointmentRequests.push({
    requestId: Date.now(),
    patientId: patient.id,
    petName: patient.petName || "",
    ownerName: patient.ownerName || "",
    contactNumber: patient.contactNumber || "",
    email: patient.email || "",
    service,
    appointmentDate: date,
    appointmentTime: time,
    status: "Pending",
    createdAt: new Date().toISOString()
  });

  if (messageBox) {
    messageBox.textContent = "Appointment request submitted successfully.";
    messageBox.classList.remove("hidden");
  }

  if (serviceInput) serviceInput.value = "";
  if (dateInput) dateInput.value = "";
  if (timeInput) timeInput.value = "";
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
      .map(t => t.trim())
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
  const container = document.getElementById("notificationContainer");

  if (!container) {
    alert(message);
    return;
  }

  container.innerHTML = "";

  const notif = document.createElement("div");
  notif.className = `notif ${type}`;
  notif.textContent = message;

  container.appendChild(notif);

  setTimeout(() => {
    notif.classList.add("hide");
  }, 2000);

  setTimeout(() => {
    notif.remove();
  }, 2500);
}