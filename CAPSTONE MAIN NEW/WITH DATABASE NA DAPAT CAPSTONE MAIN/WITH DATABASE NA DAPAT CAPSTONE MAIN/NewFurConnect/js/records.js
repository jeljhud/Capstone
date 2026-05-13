document.addEventListener("DOMContentLoaded", async function () {
  await syncRecordsFromFirebaseToLocalStorage();
  await syncOnlineAppointmentRequestsFromFirebaseToLocalStorage();

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
let unsubscribePatientQrListener = null;

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

function getRecordsFirestoreDb() {
  if (window.db) {
    return window.db;
  }

  if (
    window.firebase &&
    firebase.apps &&
    firebase.apps.length > 0 &&
    typeof firebase.firestore === "function"
  ) {
    window.db = firebase.firestore();
    return window.db;
  }

  return null;
}

function cleanRecordsFirebaseData(data) {
  const cleaned = {};

  Object.keys(data || {}).forEach(function (key) {
    if (data[key] !== undefined) {
      cleaned[key] = data[key];
    }
  });

  return cleaned;
}

async function saveOnlineAppointmentRequestToFirebase(request) {
  const db = getRecordsFirestoreDb();

  if (!db) {
    return {
      saved: false,
      firebaseDocId: ""
    };
  }

  const firebaseDocId = String(request.requestId || `REQ-${Date.now()}`);

  const docRef = db
    .collection("onlineAppointmentRequests")
    .doc(firebaseDocId);

  await docRef.set(
    cleanRecordsFirebaseData({
      ...request,
      firebaseDocId,
      updatedAt: request.updatedAt || new Date().toISOString(),
      firebaseCreatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      firebaseUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }),
    { merge: true }
  );

  return {
    saved: true,
    firebaseDocId
  };
}

async function syncOnlineAppointmentRequestsFromFirebaseToLocalStorage() {
  const db = getRecordsFirestoreDb();

  if (!db) {
    console.warn("Firestore is not ready. Online appointment requests will use localStorage only.");
    return;
  }

  try {
    const snapshot = await db.collection("onlineAppointmentRequests").get();

    const firebaseRequests = snapshot.docs
      .map(function (doc) {
        const data = doc.data();

        return {
          firebaseDocId: doc.id,
          ...data,
          createdAt: normalizeFirebaseDate(data.createdAt),
          requestedAt: normalizeFirebaseDate(data.requestedAt),
          updatedAt: normalizeFirebaseDate(data.updatedAt)
        };
      })
      .filter(function (request) {
        const status = String(request.status || "Pending").toLowerCase();

        return !["approved", "declined", "cancelled", "canceled", "completed"].includes(status);
      });

    setLocalStorageArray(
      RECORDS_STORAGE_KEYS.onlineAppointmentRequests,
      firebaseRequests.sort(function (a, b) {
        return new Date(b.requestedAt || b.createdAt || 0) - new Date(a.requestedAt || a.createdAt || 0);
      })
    );

    console.log("Firebase online appointment requests loaded:", firebaseRequests.length);
  } catch (error) {
    console.error("Firestore online appointment requests load error:", error);
  }
}

async function syncRecordsFromFirebaseToLocalStorage() {
  if (!window.db) {
    console.warn("Firestore is not ready. Using localStorage only.");
    return;
  }

  try {
    const snapshot = await window.db.collection("patientRecords").get();

    const firebaseRecords = snapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt),
        updatedAt: normalizeFirebaseDate(data.updatedAt),
        archivedAt: normalizeFirebaseDate(data.archivedAt),
        appointmentArchivedAt: normalizeFirebaseDate(data.appointmentArchivedAt)
      };
    });

    const activeRecords = [];
    const archivedRecords = [];

    firebaseRecords.forEach(function (record) {
      if (isPatientRecordArchived(record)) {
        archivedRecords.push(createArchivedPatientRecord(record));
      } else {
        activeRecords.push(createActivePatientRecord(record));
      }
    });

    setLocalStorageArray(
      RECORDS_STORAGE_KEYS.patientRecords,
      sortActiveRecordsLifo(activeRecords)
    );

    setLocalStorageArray(
      RECORDS_STORAGE_KEYS.archivedPatientRecords,
      sortArchivedRecordsLifo(archivedRecords)
    );

    console.log("Firebase records loaded:", firebaseRecords.length);
  } catch (error) {
    console.error("Firestore records load error:", error);
    showNotification("Failed to load Firebase records. Using local records.", "warning");
  }
}

function normalizeFirebaseDate(value) {
  if (!value) return "";

  if (value.toDate) {
    return value.toDate().toISOString();
  }

  return value;
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

async function saveEditedRecord(event) {
  event.preventDefault();

  if (currentEditIndex === null || !patientRecords[currentEditIndex]) return;

  const oldRecord = patientRecords[currentEditIndex];
  const appointmentType = getValue("editAppointmentType").trim();

  if (!appointmentType) {
    showNotification("Please select visit type.", "error");
    return;
  }

  const updatedRecord = {
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
    archived: false,
    isArchived: false,
    status: "active",
    archivedAt: "",
    appointmentArchivedAt: "",
    updatedAt: new Date().toISOString()
  };

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Patient Records",
    action: "Edited Record",
    details: `${updatedRecord.petName || "Patient"} record updated`
  };

  try {
    await updatePatientRecordInFirebase(oldRecord, {
      id: updatedRecord.id,
      petName: updatedRecord.petName,
      petSpecies: updatedRecord.petSpecies,
      breed: updatedRecord.breed,
      ownerName: updatedRecord.ownerName,
      appointmentType: updatedRecord.appointmentType,
      gender: updatedRecord.gender,
      weight: updatedRecord.weight,
      age: updatedRecord.age,
      contactNumber: updatedRecord.contactNumber,
      email: updatedRecord.email,
      notes: updatedRecord.notes,
      internalNotes: updatedRecord.internalNotes,
      petImage: updatedRecord.petImage,
      appointmentArchived: false,
      archived: false,
      isArchived: false,
      status: "active",
      archivedAt: "",
      appointmentArchivedAt: ""
    });

    await saveRecentActivityToFirebase(activity);

    patientRecords[currentEditIndex] = updatedRecord;

    savePatientRecords();
    saveRecentActivity(activity);

    renderActiveRecords();
    closeEditModal();
    showNotification("Record updated successfully");
  } catch (error) {
    console.error("Firebase edit record error:", error);
    showNotification("Failed to update record in Firebase.", "error");
  }
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

async function archiveRecordsByIds(recordIds) {
  if (!Array.isArray(recordIds) || recordIds.length === 0) return;

  loadRecordsLocalStorage();

  const idsToArchive = recordIds.map(function (id) {
    return String(id);
  });

  const archivedNow = [];
  const remainingActiveRecords = [];

  patientRecords.forEach(function (record) {
    if (idsToArchive.includes(String(record.id))) {
      const archivedRecord = {
        ...createArchivedPatientRecord(record),
        appointmentArchived: true,
        archived: true,
        isArchived: true,
        status: "archived",
        archivedAt: new Date().toISOString(),
        appointmentArchivedAt: new Date().toISOString()
      };

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

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Patient Records",
    action: "Archived Record",
    details:
      archivedNow.length === 1
        ? `${archivedNow[0].petName || "Patient"} record archived`
        : `${archivedNow.length} patient record(s) archived`
  };

  try {
    for (const record of archivedNow) {
      await updatePatientRecordInFirebase(record, {
        appointmentArchived: true,
        archived: true,
        isArchived: true,
        status: "archived",
        archivedAt: record.archivedAt,
        appointmentArchivedAt: record.appointmentArchivedAt
      });
    }

    await saveRecentActivityToFirebase(activity);

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
    saveRecentActivity(activity);

    renderActiveRecords();

    showNotification(
      archivedNow.length === 1
        ? "Record archived successfully"
        : "Selected records archived successfully"
    );
  } catch (error) {
    console.error("Firebase archive record error:", error);
    showNotification("Failed to archive record in Firebase.", "error");
  }
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
async function retrieveSelectedArchivedRecords() {
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
    return {
      ...createRetrievedPatientRecord(record),
      appointmentArchived: false,
      archived: false,
      isArchived: false,
      archivedAt: "",
      appointmentArchivedAt: "",
      dateArchived: "",
      status: "active",
      retrievedAt: new Date().toISOString()
    };
  });

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Patient Records",
    action: "Retrieved Archived Record",
    details: `${restoredRecords.length} archived record(s) retrieved`
  };

  try {
    for (const record of restoredRecords) {
      await updatePatientRecordInFirebase(record, {
        appointmentArchived: false,
        archived: false,
        isArchived: false,
        archivedAt: "",
        appointmentArchivedAt: "",
        dateArchived: "",
        status: "active",
        retrievedAt: record.retrievedAt
      });
    }

    await saveRecentActivityToFirebase(activity);

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
    saveRecentActivity(activity);

    renderArchivedRecords();
    showNotification("Selected record(s) retrieved successfully");
  } catch (error) {
    console.error("Firebase retrieve record error:", error);
    showNotification("Failed to retrieve record in Firebase.", "error");
  }
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
async function initializePublicPatientQrMobileView() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const patientId = params.get("id");

  if (view !== "patient" || !patientId) return;

  let patient = null;

  try {
    patient = await fetchPatientRecordFromFirebase(patientId);
  } catch (error) {
    console.error("Firebase QR patient fetch error:", error);
  }

  if (!patient) {
    loadRecordsLocalStorage();

    patient = patientRecords.find(function (record) {
      return String(record.id) === String(patientId);
    });
  }

  if (!patient) {
    showPatientQrNotFoundPage();
    return;
  }

  upsertPatientRecordToLocal(patient);
  showPatientQrMobilePage(patient);
  startPatientQrFirebaseListener(patientId);
}

async function fetchPatientRecordFromFirebase(patientId) {
  if (!window.db) return null;

  const snapshot = await window.db
    .collection("patientRecords")
    .where("id", "==", String(patientId))
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  return {
    firebaseDocId: doc.id,
    ...data,
    createdAt: normalizeFirebaseDate(data.createdAt),
    updatedAt: normalizeFirebaseDate(data.updatedAt),
    archivedAt: normalizeFirebaseDate(data.archivedAt),
    appointmentArchivedAt: normalizeFirebaseDate(data.appointmentArchivedAt),
    appointmentCreatedAt: normalizeFirebaseDate(data.appointmentCreatedAt),
    appointmentUpdatedAt: normalizeFirebaseDate(data.appointmentUpdatedAt),
    appointmentLoggedAt: normalizeFirebaseDate(data.appointmentLoggedAt)
  };
}

function startPatientQrFirebaseListener(patientId) {
  if (!window.db) {
    console.warn("Firestore is not ready. QR patient live sync skipped.");
    return;
  }

  if (unsubscribePatientQrListener) {
    unsubscribePatientQrListener();
    unsubscribePatientQrListener = null;
  }

  unsubscribePatientQrListener = window.db
    .collection("patientRecords")
    .where("id", "==", String(patientId))
    .limit(1)
    .onSnapshot(
      function (snapshot) {
        if (snapshot.empty) {
          showPatientQrNotFoundPage("This patient record no longer exists.");
          return;
        }

        const doc = snapshot.docs[0];
        const data = doc.data();

        const patient = {
          firebaseDocId: doc.id,
          ...data,
          createdAt: normalizeFirebaseDate(data.createdAt),
          updatedAt: normalizeFirebaseDate(data.updatedAt),
          archivedAt: normalizeFirebaseDate(data.archivedAt),
          appointmentArchivedAt: normalizeFirebaseDate(data.appointmentArchivedAt),
          appointmentCreatedAt: normalizeFirebaseDate(data.appointmentCreatedAt),
          appointmentUpdatedAt: normalizeFirebaseDate(data.appointmentUpdatedAt),
          appointmentLoggedAt: normalizeFirebaseDate(data.appointmentLoggedAt)
        };

        if (isPatientRecordArchived(patient)) {
          showPatientQrNotFoundPage("This patient record is archived.");
          return;
        }

        upsertPatientRecordToLocal(patient);

        window.__currentPatientId = patient.id;
        window.__currentPatientFromQR = patient;

        renderPublicPatientSnapshot(patient);

        const accountView = document.getElementById("patientAccountView");

        if (accountView && !accountView.classList.contains("hidden")) {
          renderPatientAccountView(patient);
        }
      },
      function (error) {
        console.error("QR patient live sync error:", error);
      }
    );
}

function upsertPatientRecordToLocal(updatedPatient) {
  if (!updatedPatient || !updatedPatient.id) return;

  patientRecords = patientRecords.filter(function (record) {
    return String(record.id) !== String(updatedPatient.id);
  });

  if (!isPatientRecordArchived(updatedPatient)) {
    patientRecords.unshift(createActivePatientRecord(updatedPatient));
  }

  savePatientRecords();

  window.__currentPatientId = updatedPatient.id;
  window.__currentPatientFromQR = updatedPatient;
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

const bookingService = document.getElementById("accountBookingService");
const bookingDate = document.getElementById("accountBookingDate");

if (bookingService) {
  bookingService.addEventListener("change", populatePatientBookingTimeOptions);
}

if (bookingDate) {
  bookingDate.addEventListener("change", populatePatientBookingTimeOptions);
}

function getCurrentPatientForLogin() {
  const params = new URLSearchParams(window.location.search);

  const patientId =
    params.get("id") ||
    window.__currentPatientId ||
    window.__currentPatientFromQR?.id;

  if (!patientId) return null;

  if (
    window.__currentPatientFromQR &&
    String(window.__currentPatientFromQR.id) === String(patientId)
  ) {
    return window.__currentPatientFromQR;
  }

  loadRecordsLocalStorage();

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
  const settingsModal = document.getElementById("patientSettingsModal");

  if (openChangePasswordBtn && openChangePasswordBtn.dataset.bound !== "true") {
    openChangePasswordBtn.addEventListener("click", function () {
      openPatientSettingsModal("password");
    });
    openChangePasswordBtn.dataset.bound = "true";
  }

  if (openChangeOwnerBtn && openChangeOwnerBtn.dataset.bound !== "true") {
    openChangeOwnerBtn.addEventListener("click", function () {
      openPatientSettingsModal("owner");
    });
    openChangeOwnerBtn.dataset.bound = "true";
  }

  if (openChangePetBtn && openChangePetBtn.dataset.bound !== "true") {
    openChangePetBtn.addEventListener("click", function () {
      openPatientSettingsModal("pet");
    });
    openChangePetBtn.dataset.bound = "true";
  }

  if (settingsModal && settingsModal.dataset.bound !== "true") {
    settingsModal.addEventListener("click", function (event) {
      if (event.target === settingsModal) {
        closePatientSettingsModal();
      }
    });

    settingsModal.dataset.bound = "true";
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

function closePatientSettingsModal() {
  const modal = document.getElementById("patientSettingsModal");
  const passwordForm = document.getElementById("settingsPasswordForm");
  const ownerForm = document.getElementById("settingsOwnerForm");
  const petForm = document.getElementById("settingsPetForm");

  modal?.classList.add("hidden");

  passwordForm?.classList.add("hidden");
  ownerForm?.classList.add("hidden");
  petForm?.classList.add("hidden");
}

function openPatientSettingsModal(section) {
  const modal = document.getElementById("patientSettingsModal");
  const passwordForm = document.getElementById("settingsPasswordForm");
  const ownerForm = document.getElementById("settingsOwnerForm");
  const petForm = document.getElementById("settingsPetForm");

  if (!modal) return;

  passwordForm?.classList.add("hidden");
  ownerForm?.classList.add("hidden");
  petForm?.classList.add("hidden");

  if (section === "password") {
    passwordForm?.classList.remove("hidden");
  }

  if (section === "owner") {
    ownerForm?.classList.remove("hidden");
  }

  if (section === "pet") {
    petForm?.classList.remove("hidden");
  }

  modal.classList.remove("hidden");
}

function injectPatientSettingsModalStyles() {
  if (document.getElementById("patientSettingsModalStyles")) return;

  const style = document.createElement("style");
  style.id = "patientSettingsModalStyles";

  style.textContent = `
    .fc-settings-subtext {
      margin: 8px 0 0;
      color: #5f747b;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.5;
    }

    .fc-settings-button-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 18px;
    }

    .fc-settings-action-btn {
      width: 100%;
      min-height: 78px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 14px;
      border: 1px solid #9ce1eb;
      border-radius: 22px;
      background: #ffffff;
      color: #073f48;
      text-align: left;
      cursor: pointer;
      box-shadow: 0 10px 22px rgba(15, 109, 122, 0.08);
    }

    .fc-settings-action-btn:hover {
      background: #eefbfc;
      transform: translateY(-1px);
    }

    .fc-settings-icon {
      width: 48px;
      height: 48px;
      min-width: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 16px;
      background: #0f7f8c;
      color: #ffffff;
      font-size: 22px;
    }

    .fc-settings-action-btn strong {
      display: block;
      color: #073f48;
      font-size: 14px;
      font-weight: 900;
      line-height: 1.2;
    }

    .fc-settings-action-btn small {
      display: block;
      margin-top: 4px;
      color: #5f747b;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.3;
    }

    .fc-settings-modal {
      position: fixed;
      inset: 0;
      z-index: 99999;
      padding: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(7, 31, 36, 0.45);
      backdrop-filter: blur(5px);
    }

    .fc-settings-modal.hidden {
      display: none !important;
    }

    .fc-settings-modal-box {
      position: relative;
      width: 100%;
      max-width: 390px;
      max-height: 85vh;
      overflow-y: auto;
      padding: 24px 20px 20px;
      border: 1px solid #9ce1eb;
      border-radius: 28px;
      background: #ffffff;
      box-shadow: 0 24px 55px rgba(15, 23, 42, 0.22);
    }

    .fc-settings-modal-close {
      position: absolute;
      top: 14px;
      right: 14px;
      width: 34px;
      height: 34px;
      border: none;
      border-radius: 50%;
      background: #eefbfc;
      color: #073f48;
      font-size: 24px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
    }

    .fc-settings-form h2 {
      margin: 0;
      padding-right: 38px;
      color: #086273;
      font-size: 21px;
      font-weight: 900;
      line-height: 1.2;
    }

    .fc-settings-form label {
      margin-top: 14px;
      margin-bottom: 6px;
      color: #5f747b;
      font-size: 12px;
      font-weight: 800;
    }

    .fc-settings-form .fc-submit-btn {
      width: 100%;
      margin-top: 18px;
    }

    .fc-settings-form .fc-success,
    .fc-settings-form .fc-error {
      margin-top: 12px;
      font-size: 13px;
      text-align: center;
    }
  `;

  document.head.appendChild(style);
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

async function submitPatientBookingRequest() {
  const patient = getCurrentPatientForLogin();

  if (!patient) {
    showPatientBookingMessage(
      "accountBookingMessage",
      "Patient record not found.",
      "error"
    );
    return;
  }

  const serviceInput = document.getElementById("accountBookingService");
  const dateInput = document.getElementById("accountBookingDate");
  const timeInput = document.getElementById("accountBookingTime");
  const submitBtn = document.getElementById("accountSubmitBookingBtn");

  const service = serviceInput?.value || "";
  const date = dateInput?.value || "";
  const time = timeInput?.value || "";

  if (!service || !date || !time) {
    showPatientBookingMessage(
      "accountBookingMessage",
      "Please complete service, date, and time.",
      "error"
    );
    return;
  }

  if (isRecordsDateClosedByCutoff(date)) {
  showPatientBookingMessage(
    "accountBookingMessage",
    "Today is no longer available because the 7:00 PM cutoff has passed. Please choose another date.",
    "error"
  );
  return;
}

  if (!isPatientBookingTimeWithinClinicHours(service, time)) {
    showPatientBookingMessage(
      "accountBookingMessage",
      "Selected time is not allowed because the appointment will go beyond 5:00 PM.",
      "error"
    );
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
  }

  const now = new Date().toISOString();
  const requestId = `REQ-${String(patient.id || "PATIENT").replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}`;

  const request = {
    requestId,
    firebaseDocId: requestId,

    id: patient.id || "",
    patientId: patient.id || "",

    petName: patient.petName || "",
    petSpecies: patient.petSpecies || "",
    breed: patient.breed || patient.petBreed || "",

    ownerName: patient.ownerName || "",
    contactNumber: patient.contactNumber || patient.ownerContact || "",
    ownerContact: patient.contactNumber || patient.ownerContact || "",
    email: patient.email || "",

    service,
    requestedDate: date,
    requestedTime: time,

    appointmentDate: date,
    appointmentTime: time,
    appointmentType: service,
    appointmentStatus: "Waiting",

    status: "Pending",
    source: "Patient Portal",
    createdAt: now,
    requestedAt: now,
    updatedAt: now
  };

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Patient Portal",
    action: "Submitted Booking Request",
    details: `${patient.petName || "Patient"} requested ${service}`
  };

  try {
    // Save locally first so it still works on localserver/offline fallback.
    onlineAppointmentRequests = getLocalStorageArray(
      RECORDS_STORAGE_KEYS.onlineAppointmentRequests
    );

    onlineAppointmentRequests = onlineAppointmentRequests.filter(function (item) {
      return String(item.requestId || item.firebaseDocId || "") !== String(requestId);
    });

    onlineAppointmentRequests.unshift(request);
    saveOnlineAppointmentRequests();
    saveRecentActivity(activity);

    // Then save to Firebase.
    const firebaseResult = await saveOnlineAppointmentRequestToFirebase(request);

    if (firebaseResult.saved) {
      await saveRecentActivityToFirebase(activity);

      onlineAppointmentRequests = onlineAppointmentRequests.map(function (item) {
        if (String(item.requestId) !== String(requestId)) return item;

        return {
          ...item,
          firebaseDocId: firebaseResult.firebaseDocId
        };
      });

      saveOnlineAppointmentRequests();

      showPatientBookingMessage(
        "accountBookingMessage",
        "Appointment request submitted successfully.",
        "success"
      );
    } else {
      showPatientBookingMessage(
        "accountBookingMessage",
        "Appointment request saved locally. Firebase is not connected on this page.",
        "error"
      );
    }

    if (serviceInput) serviceInput.value = "";
    if (dateInput) dateInput.value = "";
    if (timeInput) timeInput.innerHTML = `<option value="">Select Time</option>`;

    populatePatientBookingTimeOptions();
  } catch (error) {
    console.error("Booking request save error:", error);

    showPatientBookingMessage(
      "accountBookingMessage",
      "Appointment request was saved locally, but Firebase save failed. Please check the console.",
      "error"
    );
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Appointment Request";
    }
  }
}

function normalizePatientBookingService(service) {
  return String(service || "").trim().toLowerCase();
}

function getPatientBookingDurationMinutes(service) {
  const normalizedService = normalizePatientBookingService(service);

  if (normalizedService === "grooming") {
    return 90;
  }

  if (
    normalizedService === "checkup" ||
    normalizedService === "check-up" ||
    normalizedService === "consultation" ||
    normalizedService === "vaccination" ||
    normalizedService === "deworming"
  ) {
    return 30;
  }

  if (normalizedService === "surgery") {
    return 30;
  }

  return 30;
}

function timeToMinutes(timeValue) {
  if (!timeValue || !String(timeValue).includes(":")) return null;

  const [hours, minutes] = String(timeValue).split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  return hours * 60 + minutes;
}

function getRecordsManilaNowInfo() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const getPart = function (type) {
    return parts.find(function (part) {
      return part.type === type;
    })?.value || "";
  };

  return {
    dateKey: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
    minutes: Number(getPart("hour")) * 60 + Number(getPart("minute"))
  };
}

function isRecordsDateClosedByCutoff(dateKey) {
  const now = getRecordsManilaNowInfo();
  const cutoffMinutes = timeToMinutes("19:00");

  return String(dateKey) === String(now.dateKey) && now.minutes >= cutoffMinutes;
}

function minutesToTimeValue(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatPatientBookingTime(timeValue) {
  const totalMinutes = timeToMinutes(timeValue);

  if (totalMinutes === null) return "-";

  let hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${hours}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

function isPatientBookingTimeWithinClinicHours(service, timeValue) {
  const startMinutes = timeToMinutes(timeValue);

  if (startMinutes === null) return false;

  const clinicOpeningMinutes = 9 * 60;
  const clinicClosingMinutes = 17 * 60;

  const durationMinutes = getPatientBookingDurationMinutes(service);
  const endMinutes = startMinutes + durationMinutes;

  return startMinutes >= clinicOpeningMinutes && endMinutes <= clinicClosingMinutes;
}

function getPatientBookingTimeSlots(service) {
  const slots = [];
  const clinicOpeningMinutes = 9 * 60;
  const clinicClosingMinutes = 17 * 60;
  const durationMinutes = getPatientBookingDurationMinutes(service);

  for (
    let currentMinutes = clinicOpeningMinutes;
    currentMinutes + durationMinutes <= clinicClosingMinutes;
    currentMinutes += 30
  ) {
    slots.push(minutesToTimeValue(currentMinutes));
  }

  return slots;
}

function populatePatientBookingTimeOptions() {
  const serviceInput = document.getElementById("accountBookingService");
  const dateInput = document.getElementById("accountBookingDate");
  const timeInput = document.getElementById("accountBookingTime");

  if (!serviceInput || !dateInput || !timeInput) return;

  const service = serviceInput.value || "";
  const date = dateInput.value || "";

  timeInput.innerHTML = `<option value="">Select Time</option>`;

  if (!service) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Select service first";
    option.disabled = true;
    timeInput.appendChild(option);
    return;
  }

  if (!date) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Select date first";
    option.disabled = true;
    timeInput.appendChild(option);
    return;
  }

  if (isRecordsDateClosedByCutoff(date)) {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Today is no longer available after 7:00 PM";
  option.disabled = true;
  timeInput.appendChild(option);
  return;
}

  const slots = getPatientBookingTimeSlots(service);

  slots.forEach(function (slot) {
    const option = document.createElement("option");
    option.value = slot;

    if (normalizePatientBookingService(service) === "grooming") {
      const startMinutes = timeToMinutes(slot);
      const endTime = minutesToTimeValue(startMinutes + 90);

      option.textContent = `${formatPatientBookingTime(slot)} - ${formatPatientBookingTime(endTime)}`;
    } else {
      option.textContent = formatPatientBookingTime(slot);
    }

    timeInput.appendChild(option);
  });
}

function showPatientBookingMessage(elementId, message, type = "success") {
  const messageBox = document.getElementById(elementId);
  if (!messageBox) return;

  messageBox.textContent = message;
  messageBox.classList.remove("hidden", "fc-success", "fc-error");

  if (type === "error") {
    messageBox.classList.add("fc-error");
    messageBox.style.color = "#dc3545";
    messageBox.style.fontWeight = "800";
    return;
  }

  messageBox.classList.add("fc-success");
  messageBox.style.color = "#198754";
  messageBox.style.fontWeight = "800";
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

/* =========================================================
   EMERGENCY REPAIR ONLY: EXPORT QR BUTTON
   Paste at VERY BOTTOM of records.js
========================================================= */

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    repairExportQrButtonOnly();
  });

  function repairExportQrButtonOnly() {
    const exportQrBtn = document.getElementById("exportQrBtn");

    if (!exportQrBtn) return;
    if (exportQrBtn.dataset.repairQrBound === "true") return;

exportQrBtn.addEventListener(
  "click",
  async function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (typeof syncRecordsFromFirebaseToLocalStorage === "function") {
      await syncRecordsFromFirebaseToLocalStorage();
    }

    if (typeof loadRecordsLocalStorage === "function") {
      loadRecordsLocalStorage();
    }

    const selectedCheckboxes = Array.from(
      document.querySelectorAll(".record-checkbox:checked")
    );

    if (selectedCheckboxes.length === 0) {
      safeQrNotify("Please select 1 record", "error");
      return;
    }

    if (selectedCheckboxes.length > 1) {
      safeQrNotify("Please select only one record to generate QR", "error");
      return;
    }

    const selectedCheckbox = selectedCheckboxes[0];
    const selectedId = selectedCheckbox.dataset.id;
    const selectedIndex = Number(selectedCheckbox.dataset.index);

    const records = Array.isArray(patientRecords) ? patientRecords : [];

    const record =
      records.find(function (item) {
        return String(item.id) === String(selectedId);
      }) || records[selectedIndex];

    if (!record) {
      safeQrNotify("Selected record not found. Please refresh and try again.", "error");
      return;
    }

    openQrModalRepair(record);
  },
  true
);

    exportQrBtn.dataset.repairQrBound = "true";
  }

  function openQrModalRepair(record) {
    const modal = document.getElementById("qrModal");
    const qrBox = document.getElementById("qrCodeBox");

    if (!modal || !qrBox) {
      safeQrNotify("QR modal HTML is missing.", "error");
      return;
    }

    if (typeof QRCode === "undefined") {
      safeQrNotify("QR library not loaded.", "error");
      return;
    }

    document.querySelectorAll(".fc-login-modal").forEach(function (item) {
      item.classList.add("hidden");
      item.style.display = "";
    });

    qrBox.innerHTML = "";

    const baseUrl = window.location.origin + window.location.pathname;
    const qrUrl =
      baseUrl +
      "?view=patient&id=" +
      encodeURIComponent(record.id || "");

    new QRCode(qrBox, {
      text: qrUrl,
      width: 200,
      height: 200,
      correctLevel: QRCode.CorrectLevel.H
    });

    const qrPatientName = document.getElementById("qrPatientName");
    const qrPatientDetails = document.getElementById("qrPatientDetails");

    if (qrPatientName) {
      qrPatientName.textContent = record.petName || "Patient Record";
    }

    if (qrPatientDetails) {
      qrPatientDetails.textContent =
        (record.ownerName || "-") + " • " + (record.appointmentType || "-");
    }

    modal.classList.remove("hidden");
    modal.style.display = "flex";
  }

  function safeQrNotify(message, type) {
    if (typeof showNotification === "function") {
      showNotification(message, type || "success");
      return;
    }

    alert(message);
  }
})();

/* =========================================================
   EMERGENCY REPAIR: KEEP APPOINTMENT DETAILS IN PET RECORDS
   Paste at VERY BOTTOM of records.js
========================================================= */

function isEmptyAppointmentValue(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function getRecordAppointmentDate(record) {
  if (!record) return "";
  return !isEmptyAppointmentValue(record.appointmentDate)
    ? record.appointmentDate
    : record.lastAppointmentDate || "";
}

function getRecordAppointmentTime(record) {
  if (!record) return "";
  return !isEmptyAppointmentValue(record.appointmentTime)
    ? record.appointmentTime
    : record.lastAppointmentTime || "";
}

function getRecordAppointmentType(record) {
  if (!record) return "";
  return !isEmptyAppointmentValue(record.appointmentType)
    ? record.appointmentType
    : record.lastAppointmentType || record.service || "";
}

function getRecordAppointmentStatus(record) {
  if (!record) return "Waiting";
  return !isEmptyAppointmentValue(record.appointmentStatus)
    ? record.appointmentStatus
    : record.lastAppointmentStatus || "Waiting";
}

/* Override original createActivePatientRecord */
function createActivePatientRecord(record) {
  const appointmentDate = getRecordAppointmentDate(record);
  const appointmentTime = getRecordAppointmentTime(record);
  const appointmentType = getRecordAppointmentType(record);
  const appointmentStatus = getRecordAppointmentStatus(record);

  return {
    ...record,

    appointmentDate,
    appointmentTime,
    appointmentType,
    appointmentStatus,

    lastAppointmentDate: record.lastAppointmentDate || appointmentDate,
    lastAppointmentTime: record.lastAppointmentTime || appointmentTime,
    lastAppointmentType: record.lastAppointmentType || appointmentType,
    lastAppointmentStatus: record.lastAppointmentStatus || appointmentStatus,

    appointmentArchived: false,
    archived: false,
    isArchived: false
  };
}

/* Override original createArchivedPatientRecord */
function createArchivedPatientRecord(record) {
  const archivedAt =
    record.archivedAt ||
    record.appointmentArchivedAt ||
    record.dateArchived ||
    new Date().toISOString();

  const appointmentDate = getRecordAppointmentDate(record);
  const appointmentTime = getRecordAppointmentTime(record);
  const appointmentType = getRecordAppointmentType(record);
  const appointmentStatus = getRecordAppointmentStatus(record);

  return {
    ...record,

    appointmentDate,
    appointmentTime,
    appointmentType,
    appointmentStatus,

    lastAppointmentDate: record.lastAppointmentDate || appointmentDate,
    lastAppointmentTime: record.lastAppointmentTime || appointmentTime,
    lastAppointmentType: record.lastAppointmentType || appointmentType,
    lastAppointmentStatus: record.lastAppointmentStatus || appointmentStatus,

    appointmentArchived: true,
    archived: true,
    isArchived: true,
    archivedAt,
    appointmentArchivedAt: archivedAt,
    dateArchived: archivedAt,
    status: record.status || "Archived"
  };
}

/* Override original saveArchivedAppointmentLog */
function saveArchivedAppointmentLog(record) {
  const archivedAppointments = getLocalStorageArray(RECORDS_STORAGE_KEYS.archivedAppointments);

  const archivedLog = {
    id: record.id || "",
    petName: record.petName || "",
    petBreed: record.petBreed || record.breed || "",
    ownerName: record.ownerName || "",
    ownerContact: record.ownerContact || record.contactNumber || "",
    appointmentDate: getRecordAppointmentDate(record),
    appointmentTime: getRecordAppointmentTime(record),
    appointmentType: getRecordAppointmentType(record),
    appointmentStatus: getRecordAppointmentStatus(record) || "Finished",
    notes: record.notes || record.internalNotes || "",
    archivedAt: record.archivedAt || record.appointmentArchivedAt || new Date().toISOString()
  };

  const duplicate = archivedAppointments.some(function (item) {
    return (
      String(item.id) === String(archivedLog.id) &&
      String(item.appointmentDate || "") === String(archivedLog.appointmentDate || "") &&
      String(item.appointmentTime || "") === String(archivedLog.appointmentTime || "") &&
      String(item.appointmentType || "") === String(archivedLog.appointmentType || "")
    );
  });

  if (!duplicate) {
    archivedAppointments.unshift(archivedLog);
    setLocalStorageArray(RECORDS_STORAGE_KEYS.archivedAppointments, archivedAppointments);
  }
}

/* Repair already affected records in localStorage */
function repairPatientRecordAppointmentFallbacks() {
  const records = getLocalStorageArray(RECORDS_STORAGE_KEYS.patientRecords);

  let changed = false;

  const repairedRecords = records.map(function (record) {
    const appointmentDate = getRecordAppointmentDate(record);
    const appointmentTime = getRecordAppointmentTime(record);
    const appointmentType = getRecordAppointmentType(record);
    const appointmentStatus = getRecordAppointmentStatus(record);

    const needsRepair =
      (isEmptyAppointmentValue(record.appointmentDate) && !isEmptyAppointmentValue(appointmentDate)) ||
      (isEmptyAppointmentValue(record.appointmentTime) && !isEmptyAppointmentValue(appointmentTime)) ||
      (isEmptyAppointmentValue(record.appointmentType) && !isEmptyAppointmentValue(appointmentType));

    if (!needsRepair) {
      return record;
    }

    changed = true;

    return {
      ...record,

      appointmentDate,
      appointmentTime,
      appointmentType,
      appointmentStatus,

      lastAppointmentDate: record.lastAppointmentDate || appointmentDate,
      lastAppointmentTime: record.lastAppointmentTime || appointmentTime,
      lastAppointmentType: record.lastAppointmentType || appointmentType,
      lastAppointmentStatus: record.lastAppointmentStatus || appointmentStatus,

      appointmentRepairAt: new Date().toISOString()
    };
  });

  if (changed) {
    setLocalStorageArray(RECORDS_STORAGE_KEYS.patientRecords, repairedRecords);
  }
}

/* Run repair after page load */
document.addEventListener("DOMContentLoaded", function () {
  repairPatientRecordAppointmentFallbacks();

  if (document.getElementById("recordsTableBody")) {
    loadRecordsLocalStorage();
    renderActiveRecords();
  }
});

/* =========================================================
   REPAIR: EXPORT EXCEL BUTTON FOR PET RECORDS
   Paste at VERY BOTTOM of records.js
========================================================= */

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    repairExportExcelButton();
  });

  function repairExportExcelButton() {
    const exportExcelBtn =
      document.getElementById("exportExcelBtn") ||
      document.getElementById("exportRecordsExcelBtn") ||
      Array.from(document.querySelectorAll("button, a")).find(function (btn) {
        return String(btn.textContent || "").trim().toUpperCase().includes("EXPORT EXCEL");
      });

    if (!exportExcelBtn) return;
    if (exportExcelBtn.dataset.excelBound === "true") return;

    exportExcelBtn.addEventListener("click", async function (event) {
      event.preventDefault();
      event.stopPropagation();

      await exportPetRecordsToExcel();
    });

    exportExcelBtn.dataset.excelBound = "true";
  }

async function exportPetRecordsToExcel() {
  if (typeof syncRecordsFromFirebaseToLocalStorage === "function") {
    await syncRecordsFromFirebaseToLocalStorage();
  }

  if (typeof loadRecordsLocalStorage === "function") {
    loadRecordsLocalStorage();
  }

  const records = Array.isArray(patientRecords)
    ? patientRecords.filter(function (record) {
        return typeof isPatientRecordArchived === "function"
          ? !isPatientRecordArchived(record)
          : true;
      })
    : [];

  if (records.length === 0) {
    if (typeof showNotification === "function") {
      showNotification("No pet records to export.", "error");
    } else {
      alert("No pet records to export.");
    }

    return;
  }

  const rows = records.map(function (record) {
    return {
      ID: record.id || "",
      "Pet Name": record.petName || "",
      "Pet Species": record.petSpecies || "",
      Breed: record.breed || record.petBreed || "",
      "Owner Name": record.ownerName || "",
      "Contact Number": record.contactNumber || record.ownerContact || "",
      Email: record.email || "",
      Appointment: record.appointmentType || record.lastAppointmentType || "",
      "Appointment Date": record.appointmentDate || record.lastAppointmentDate || "",
      "Appointment Time": formatExcelAppointmentTime(
        record.appointmentTime || record.lastAppointmentTime || ""
      ),
      Status: record.appointmentStatus || record.lastAppointmentStatus || "Waiting",
      Gender: record.gender || "",
      Age: record.age || "",
      Weight: record.weight || "",
      Notes: record.notes || record.internalNotes || ""
    };
  });

  if (typeof XLSX !== "undefined") {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Pet Records");
    XLSX.writeFile(workbook, "pet-records.xlsx");

    if (typeof showNotification === "function") {
      showNotification("Pet records exported successfully.");
    }

    return;
  }

  exportPetRecordsToCSV(rows);
}

  function exportPetRecordsToCSV(rows) {
    const headers = Object.keys(rows[0]);

    const csvRows = [
      headers.join(","),
      ...rows.map(function (row) {
        return headers
          .map(function (header) {
            return `"${String(row[header] || "").replaceAll('"', '""')}"`
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
    link.download = `pet-records-${dateKey}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(link.href);

    if (typeof showNotification === "function") {
      showNotification("Pet records exported as CSV.");
    }
  }

  function formatExcelAppointmentTime(time) {
    if (!time) return "";

    if (typeof formatTime === "function") {
      return formatTime(time);
    }

    return String(time);
  }
})();

/* =========================================================
   PATIENT PORTAL PATCH
   - Edit profile picture
   - Functional notification bell for QR / patient portal
   Paste at VERY BOTTOM of records.js
========================================================= */

(function () {
  const PORTAL_NOTIF_STORAGE_KEY = "patientPortalNotificationSeenMap";

  const originalRenderPatientAccountView = window.renderPatientAccountView;

  if (typeof originalRenderPatientAccountView === "function") {
    window.renderPatientAccountView = function (patient) {
      originalRenderPatientAccountView(patient);

      injectPatientPortalEnhancements();
      bindPatientPortalEnhancements();
      renderPatientPortalNotifications(patient);
    };
  }

  document.addEventListener("DOMContentLoaded", function () {
    injectPatientPortalEnhancements();
    bindPatientPortalEnhancements();

    const patient = getCurrentPatientForLogin?.();
    if (patient) {
      renderPatientPortalNotifications(patient);
    }
  });

  function injectPatientPortalEnhancements() {
    const accountView = document.getElementById("patientAccountView");
    if (!accountView) return;

    injectPatientPortalBell(accountView);
    injectPatientPortalNotificationPanel(accountView);
    injectPatientAvatarEditButton(accountView);
  }

  function injectPatientPortalBell(accountView) {
    const topbar = accountView.querySelector(".fc-topbar");
    if (!topbar) return;

    const existingBell = document.getElementById("patientPortalNotifBtn");
    if (existingBell) return;

    const rightTarget =
      topbar.querySelector(".fc-soft-plus") ||
      topbar.querySelector(".fc-bell-btn") ||
      topbar.querySelector(".fc-notif-btn");

    const bellHTML = `
      <button type="button" id="patientPortalNotifBtn" class="fc-bell-btn" aria-label="Notifications">
        <i class="bi bi-bell-fill"></i>
        <span id="patientPortalNotifBadge" class="fc-notif-badge hidden">0</span>
      </button>
    `;

    if (rightTarget) {
      rightTarget.outerHTML = bellHTML;
    } else {
      topbar.insertAdjacentHTML("beforeend", bellHTML);
    }
  }

  function injectPatientPortalNotificationPanel(accountView) {
    if (document.getElementById("patientPortalNotifPanel")) return;

    accountView.insertAdjacentHTML(
      "beforeend",
      `
      <div id="patientPortalNotifPanel" class="fc-notif-panel hidden">
        <div class="fc-notif-panel-header">
          <div>
            <h3>Notifications</h3>
            <p>Appointment and rebooking updates</p>
          </div>

          <button type="button" id="patientPortalNotifClose" class="fc-notif-close-btn">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div id="patientPortalNotifList" class="fc-notif-list"></div>

        <div id="patientPortalNotifEmpty" class="fc-notif-empty hidden">
          No updates yet.
        </div>
      </div>
      `
    );
  }

  function injectPatientAvatarEditButton(accountView) {
    const avatarWrap =
      document.getElementById("accountPatientAvatarWrap") ||
      accountView.querySelector(".fc-avatar") ||
      accountView.querySelector(".account-avatar");

    if (!avatarWrap) return;

    if (!document.getElementById("accountAvatarEditBtn")) {
      avatarWrap.insertAdjacentHTML(
        "beforeend",
        `
        <button type="button" id="accountAvatarEditBtn" class="fc-avatar-edit-btn" aria-label="Edit Picture">
          <i class="bi bi-camera-fill"></i>
        </button>
        `
      );
    }

    if (!document.getElementById("accountAvatarFileInput")) {
      avatarWrap.insertAdjacentHTML(
        "afterend",
        `
        <input
          type="file"
          id="accountAvatarFileInput"
          accept="image/*"
          class="hidden"
        >
        `
      );
    }
  }

  function bindPatientPortalEnhancements() {
    const notifBtn = document.getElementById("patientPortalNotifBtn");
    const notifPanel = document.getElementById("patientPortalNotifPanel");
    const notifClose = document.getElementById("patientPortalNotifClose");
    const avatarEditBtn = document.getElementById("accountAvatarEditBtn");
    const avatarFileInput = document.getElementById("accountAvatarFileInput");

    if (notifBtn && notifBtn.dataset.bound !== "true") {
      notifBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();

        const patient = getCurrentPatientForLogin?.();
        if (!patient) return;

        renderPatientPortalNotifications(patient);

        notifPanel?.classList.toggle("hidden");

        if (!notifPanel?.classList.contains("hidden")) {
          markPatientNotificationsAsSeen(String(patient.id || ""));
          updatePatientPortalNotificationBadge(patient);
        }
      });

      notifBtn.dataset.bound = "true";
    }

    if (notifClose && notifClose.dataset.bound !== "true") {
      notifClose.addEventListener("click", function () {
        notifPanel?.classList.add("hidden");
      });

      notifClose.dataset.bound = "true";
    }

    if (avatarEditBtn && avatarEditBtn.dataset.bound !== "true") {
      avatarEditBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        avatarFileInput?.click();
      });

      avatarEditBtn.dataset.bound = "true";
    }

    if (avatarFileInput && avatarFileInput.dataset.bound !== "true") {
      avatarFileInput.addEventListener("change", handlePatientAvatarEditUpload);
      avatarFileInput.dataset.bound = "true";
    }

    if (!document.body.dataset.portalNotifOutsideBound) {
      document.addEventListener("click", function (event) {
        const panel = document.getElementById("patientPortalNotifPanel");
        const btn = document.getElementById("patientPortalNotifBtn");

        if (!panel || panel.classList.contains("hidden")) return;

        if (
          panel.contains(event.target) ||
          (btn && btn.contains(event.target))
        ) {
          return;
        }

        panel.classList.add("hidden");
      });

      document.body.dataset.portalNotifOutsideBound = "true";
    }
  }

  function handlePatientAvatarEditUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showNotification?.("Please select a valid image file.", "error");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = function (loadEvent) {
      const imageData = loadEvent.target.result;
      const patient = getCurrentPatientForLogin?.();

      if (!patient) {
        showNotification?.("Patient record not found.", "error");
        return;
      }

      const updatedPatient = updateCurrentPatientRecord?.(
        {
          petImage: imageData
        },
        "Updated Profile Photo",
        `${patient.petName || "Patient"} updated profile photo`
      );

      if (updatedPatient) {
        const publicImg = document.getElementById("publicPatientAvatarImg");
        const publicLetter = document.getElementById("publicPatientAvatarLetter");
        const accountImg = document.getElementById("accountPatientAvatarImg");
        const accountLetter = document.getElementById("accountPatientAvatarLetter");

        if (publicImg && publicLetter) {
          publicImg.src = imageData;
          publicImg.classList.remove("hidden");
          publicLetter.classList.add("hidden");
        }

        if (accountImg && accountLetter) {
          accountImg.src = imageData;
          accountImg.classList.remove("hidden");
          accountLetter.classList.add("hidden");
        }

        showNotification?.("Profile picture updated successfully.");
      }
    };

    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function renderPatientPortalNotifications(patient) {
    const list = document.getElementById("patientPortalNotifList");
    const empty = document.getElementById("patientPortalNotifEmpty");

    if (!list || !empty || !patient) return;

    const notifications = getPatientPortalNotifications(patient);

    list.innerHTML = "";

    if (notifications.length === 0) {
      empty.classList.remove("hidden");
    } else {
      empty.classList.add("hidden");

      notifications.forEach(function (item) {
        const card = document.createElement("div");
        card.className = `fc-notif-item fc-notif-${item.type || "info"}`;

        card.innerHTML = `
          <div class="fc-notif-item-icon">
            <i class="${escapeHTML(getPatientPortalNotificationIcon(item.type))}"></i>
          </div>

          <div class="fc-notif-item-body">
            <strong>${escapeHTML(item.title || "Update")}</strong>
            <p>${escapeHTML(item.message || "")}</p>
            <small>${escapeHTML(formatPatientPortalNotificationDate(item.date))}</small>
          </div>
        `;

        list.appendChild(card);
      });
    }

    updatePatientPortalNotificationBadge(patient, notifications);
  }

  function getPatientPortalNotifications(patient) {
    loadRecordsLocalStorage?.();

    const patientId = String(patient.id || "");
    const notifications = [];

    if (patient.appointmentDate) {
      notifications.push({
        key: `current-${patientId}-${patient.appointmentDate}-${patient.appointmentTime || ""}`,
        type: normalizeAppointmentStatusType(patient.appointmentStatus),
        title: "Current Appointment",
        message: `${patient.appointmentType || "Appointment"} • ${formatScheduleSafe(
          patient.appointmentDate,
          patient.appointmentTime
        )} • Status: ${patient.appointmentStatus || "Waiting"}`,
        date:
          patient.appointmentUpdatedAt ||
          patient.updatedAt ||
          patient.createdAt ||
          new Date().toISOString()
      });
    }

    const patientRequests = (onlineAppointmentRequests || [])
      .filter(function (request) {
        return String(request.patientId || request.id || "") === patientId;
      })
      .sort(function (a, b) {
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      });

    patientRequests.forEach(function (request) {
      const status = String(request.status || "Pending");
      const requestService = request.service || request.appointmentType || "Appointment";
      const requestSchedule = formatScheduleSafe(
        request.requestedDate || request.appointmentDate,
        request.requestedTime || request.appointmentTime
      );

      notifications.push({
        key: `request-${request.requestId || request.id}-${status}-${requestSchedule}`,
        type: normalizeRequestStatusType(status),
        title: `Rebooking Request • ${status}`,
        message: `${requestService} • ${requestSchedule}`,
        date: request.updatedAt || request.createdAt || new Date().toISOString()
      });
    });

    const archivedAppointments = getLocalStorageArray?.(RECORDS_STORAGE_KEYS.archivedAppointments) || [];

    archivedAppointments
      .filter(function (item) {
        return String(item.id || item.patientId || "") === patientId;
      })
      .sort(function (a, b) {
        return new Date(b.archivedAt || b.updatedAt || 0) - new Date(a.archivedAt || a.updatedAt || 0);
      })
      .slice(0, 3)
      .forEach(function (item) {
        notifications.push({
          key: `archived-${item.id}-${item.appointmentDate}-${item.appointmentTime}`,
          type: "success",
          title: "Completed Appointment",
          message: `${item.appointmentType || "Appointment"} • ${formatScheduleSafe(
            item.appointmentDate,
            item.appointmentTime
          )}`,
          date: item.archivedAt || item.updatedAt || new Date().toISOString()
        });
      });

    return notifications.sort(function (a, b) {
      return new Date(b.date || 0) - new Date(a.date || 0);
    });
  }

  function updatePatientPortalNotificationBadge(patient, notifications = null) {
    const badge = document.getElementById("patientPortalNotifBadge");
    if (!badge || !patient) return;

    const patientId = String(patient.id || "");
    const notificationItems = Array.isArray(notifications)
      ? notifications
      : getPatientPortalNotifications(patient);

    const seenMap = getPatientPortalSeenMap();
    const seenTime = new Date(seenMap[patientId] || 0).getTime();

    const unreadCount = notificationItems.filter(function (item) {
      return new Date(item.date || 0).getTime() > seenTime;
    }).length;

    if (unreadCount > 0) {
      badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "0";
      badge.classList.add("hidden");
    }
  }

  function markPatientNotificationsAsSeen(patientId) {
    if (!patientId) return;

    const seenMap = getPatientPortalSeenMap();
    seenMap[patientId] = new Date().toISOString();
    localStorage.setItem(PORTAL_NOTIF_STORAGE_KEY, JSON.stringify(seenMap));
  }

  function getPatientPortalSeenMap() {
    try {
      const raw = localStorage.getItem(PORTAL_NOTIF_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function normalizeRequestStatusType(status) {
    const text = String(status || "").toLowerCase();

    if (text.includes("approved")) return "success";
    if (text.includes("reject") || text.includes("decline")) return "danger";
    if (text.includes("pending")) return "warning";

    return "info";
  }

  function normalizeAppointmentStatusType(status) {
    const text = String(status || "").toLowerCase();

    if (text.includes("finished")) return "success";
    if (text.includes("ongoing")) return "info";
    if (text.includes("waiting")) return "warning";

    return "info";
  }

  function getPatientPortalNotificationIcon(type) {
    if (type === "success") return "bi bi-check-circle-fill";
    if (type === "danger") return "bi bi-x-circle-fill";
    if (type === "warning") return "bi bi-hourglass-split";
    return "bi bi-bell-fill";
  }

  function formatScheduleSafe(date, time) {
    if (typeof formatSchedule === "function") {
      return formatSchedule(date, time);
    }

    return [date || "", time || ""].filter(Boolean).join(" ");
  }

  function formatPatientPortalNotificationDate(dateValue) {
    if (!dateValue) return "Just now";

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "Just now";

    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }
})();

/* =========================================================
   FINAL AVATAR CLEAN FIX
   Removes all circles/badges inside avatar
   Adds clean Edit Picture button outside avatar
========================================================= */

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(fixPatientAccountAvatarClean, 300);
    setTimeout(fixPatientAccountAvatarClean, 1000);
  });

  const oldRenderPatientAccountView = window.renderPatientAccountView;

  if (typeof oldRenderPatientAccountView === "function") {
    window.renderPatientAccountView = function (patient) {
      oldRenderPatientAccountView(patient);

      setTimeout(fixPatientAccountAvatarClean, 100);
      setTimeout(fixPatientAccountAvatarClean, 500);
    };
  }

  function fixPatientAccountAvatarClean() {
    const avatarWrap =
      document.getElementById("accountPatientAvatarWrap") ||
      document.querySelector("#patientAccountView .fc-avatar");

    if (!avatarWrap) return;

    const avatarImg = document.getElementById("accountPatientAvatarImg");
    const avatarLetter = document.getElementById("accountPatientAvatarLetter");

    /*
      Remove every extra badge/circle/button inside avatar.
      Keep only image and letter.
    */
    Array.from(avatarWrap.children).forEach(function (child) {
      if (child === avatarImg || child === avatarLetter) return;
      child.remove();
    });

    /*
      Add clean external edit picture button outside the avatar,
      not overlapping the image.
    */
    if (!document.getElementById("cleanAccountEditPhotoBtn")) {
      avatarWrap.insertAdjacentHTML(
        "afterend",
        `
        <button type="button" id="cleanAccountEditPhotoBtn" class="clean-account-edit-photo-btn">
          <i class="bi bi-camera-fill"></i>
          Edit Picture
        </button>
        `
      );
    }

    if (!document.getElementById("cleanAccountEditPhotoInput")) {
      avatarWrap.insertAdjacentHTML(
        "afterend",
        `
        <input type="file" id="cleanAccountEditPhotoInput" accept="image/*" class="hidden">
        `
      );
    }

    const editBtn = document.getElementById("cleanAccountEditPhotoBtn");
    const fileInput = document.getElementById("cleanAccountEditPhotoInput");

    if (editBtn && editBtn.dataset.bound !== "true") {
      editBtn.addEventListener("click", function () {
        fileInput?.click();
      });

      editBtn.dataset.bound = "true";
    }

    if (fileInput && fileInput.dataset.bound !== "true") {
      fileInput.addEventListener("change", function (event) {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
          showNotification?.("Please select a valid image file.", "error");
          event.target.value = "";
          return;
        }

        const reader = new FileReader();

        reader.onload = function (loadEvent) {
          const imageData = loadEvent.target.result;
          const patient = getCurrentPatientForLogin?.();

          if (!patient) {
            showNotification?.("Patient record not found.", "error");
            return;
          }

          const updatedPatient = updateCurrentPatientRecord?.(
            { petImage: imageData },
            "Updated Profile Photo",
            `${patient.petName || "Patient"} updated profile photo`
          );

          if (updatedPatient) {
            const img = document.getElementById("accountPatientAvatarImg");
            const letter = document.getElementById("accountPatientAvatarLetter");

            if (img && letter) {
              img.src = imageData;
              img.classList.remove("hidden");
              letter.classList.add("hidden");
            }

            showNotification?.("Profile picture updated successfully.");
          }
        };

        reader.readAsDataURL(file);
        event.target.value = "";
      });

      fileInput.dataset.bound = "true";
    }
  }
})();

/* =========================================================
   ACCOUNT SETTINGS MENU / FORM SWITCH
========================================================= */

function openSettingsForm(type) {
  const menuCard = document.getElementById("settingsMenuCard");
  const passwordForm = document.getElementById("settingsPasswordForm");
  const ownerForm = document.getElementById("settingsOwnerForm");
  const petForm = document.getElementById("settingsPetForm");

  if (menuCard) menuCard.classList.add("hidden");
  if (passwordForm) passwordForm.classList.add("hidden");
  if (ownerForm) ownerForm.classList.add("hidden");
  if (petForm) petForm.classList.add("hidden");

  if (type === "password" && passwordForm) {
    passwordForm.classList.remove("hidden");
  }

  if (type === "owner" && ownerForm) {
    ownerForm.classList.remove("hidden");
  }

  if (type === "pet" && petForm) {
    petForm.classList.remove("hidden");
  }
}

function closeSettingsForms() {
  const menuCard = document.getElementById("settingsMenuCard");
  const passwordForm = document.getElementById("settingsPasswordForm");
  const ownerForm = document.getElementById("settingsOwnerForm");
  const petForm = document.getElementById("settingsPetForm");

  if (menuCard) menuCard.classList.remove("hidden");
  if (passwordForm) passwordForm.classList.add("hidden");
  if (ownerForm) ownerForm.classList.add("hidden");
  if (petForm) petForm.classList.add("hidden");
}

function updateCurrentPatientRecord(updates, activityAction = "Updated Patient Account", activityDetails = "") {
  const patient = getCurrentPatientForLogin();

  if (!patient) {
    showNotification("Patient record not found.", "error");
    return null;
  }

  const now = new Date().toISOString();

  const cleanUpdates = {
    ...updates,
    updatedAt: now
  };

  const updatedPatient = {
    ...patient,
    ...cleanUpdates
  };

  upsertPatientRecordToLocal(updatedPatient);
  renderPublicPatientSnapshot(updatedPatient);

  const accountView = document.getElementById("patientAccountView");

  if (accountView && !accountView.classList.contains("hidden")) {
    renderPatientAccountView(updatedPatient);
  }

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Patient Account",
    action: activityAction,
    details: activityDetails || `${updatedPatient.petName || "Patient"} updated account information`
  };

  saveRecentActivity(activity);

  if (window.db) {
    updatePatientRecordInFirebase(updatedPatient, cleanUpdates)
      .then(function () {
        return saveRecentActivityToFirebase(activity);
      })
      .catch(function (error) {
        console.error("Firebase patient account update error:", error);
        showNotification("Failed to sync patient update to Firebase.", "error");
      });
  }

  return updatedPatient;
}

/* =========================================================
   ADMIN PET RECORDS SCHEDULE EDIT
   Based on dashboard calendar/time-slot logic
   Admin: editable schedule
   Staff: locked/read-only schedule
   Paste at VERY BOTTOM of records.js
========================================================= */

let editSelectedSlots = [];

/* ================= ROLE CHECK ================= */
function isRecordsAdminPage() {
  const role = String(document.body?.dataset?.userRole || "").toLowerCase();

  if (role === "admin") return true;
  if (role === "staff") return false;

  // fallback kapag wala pang data-user-role sa HTML
  return !window.location.pathname.toLowerCase().includes("staff-");
}

/* ================= SAFE HELPERS ================= */
function recordsGetValue(id) {
  if (typeof getValue === "function") return getValue(id);

  return document.getElementById(id)?.value || "";
}

function recordsSetValue(id, value) {
  if (typeof setValue === "function") {
    setValue(id, value);
    return;
  }

  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

function recordsSetText(id, value) {
  if (typeof setText === "function") {
    setText(id, value);
    return;
  }

  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function recordsNotify(message, type = "success") {
  if (typeof showNotification === "function") {
    showNotification(message, type);
    return;
  }

  alert(message);
}

function recordsFormatDateKey(date) {
  if (typeof formatDateKey === "function") return formatDateKey(date);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function recordsFormatSingleTime(time) {
  if (typeof formatSingleTime === "function") return formatSingleTime(time);

  if (!time || !String(time).includes(":")) return "-";

  let [h, m] = String(time).split(":");
  h = parseInt(h, 10);

  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;

  return `${h}:${m} ${ampm}`;
}

function recordsFormatFullDateUpper(dateKey) {
  if (typeof formatFullDateUpper === "function") {
    return formatFullDateUpper(dateKey);
  }

  const date = new Date(`${dateKey}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return String(dateKey || "").toUpperCase();
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).toUpperCase();
}

/* ================= CLINIC SLOT SETTINGS ================= */
const RECORDS_CLINIC_START_TIME = "09:00";
const RECORDS_CLINIC_LAST_VISIBLE_TIME = "19:00";
const RECORDS_LUNCH_START_TIME = "12:00";
const RECORDS_LUNCH_END_TIME = "13:00";
const RECORDS_CUTOFF_TIME = "19:00";

function recordsTimeToMinutes(timeValue) {
  const [hour, minute] = String(timeValue).split(":").map(Number);
  return hour * 60 + minute;
}

function recordsIsLunchSlot(timeValue) {
  const slotMinutes = recordsTimeToMinutes(timeValue);
  const lunchStart = recordsTimeToMinutes(RECORDS_LUNCH_START_TIME);
  const lunchEnd = recordsTimeToMinutes(RECORDS_LUNCH_END_TIME);

  return slotMinutes >= lunchStart && slotMinutes < lunchEnd;
}

function recordsIsCutoffSlot(timeValue) {
  return recordsTimeToMinutes(timeValue) >= recordsTimeToMinutes(RECORDS_CUTOFF_TIME);
}

function recordsIsBookableClinicSlot(timeValue) {
  return !recordsIsLunchSlot(timeValue) && !recordsIsCutoffSlot(timeValue);
}

function recordsGetClinicTimeSlots() {
  const slots = [];

  let currentMinutes = recordsTimeToMinutes(RECORDS_CLINIC_START_TIME);
  const lastVisibleMinutes = recordsTimeToMinutes(RECORDS_CLINIC_LAST_VISIBLE_TIME);

  while (currentMinutes <= lastVisibleMinutes) {
    const hour = Math.floor(currentMinutes / 60);
    const minute = currentMinutes % 60;

    slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);

    currentMinutes += 30;
  }

  return slots;
}

/* Same as dashboard logic */
function getServiceDurationSlots(serviceType) {
  switch (serviceType) {
    case "Grooming":
      return 4;

    case "Vaccination":
      return 2;

    case "Checkup":
    case "Check-up":
    case "Consultation":
      return 2;

    case "Deworming":
      return 2;

    case "Surgery":
      return 0;

    default:
      return 1;
  }
}

function recordsGetAppointmentSlots(record) {
  return String(record?.appointmentTime || "")
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

function recordsIsArchived(record) {
  if (typeof isPatientRecordArchived === "function") {
    return isPatientRecordArchived(record);
  }

  return (
    record?.appointmentArchived === true ||
    record?.archived === true ||
    record?.isArchived === true ||
    String(record?.status || "").toLowerCase() === "archived"
  );
}

function recordsCurrentEditId() {
  if (currentEditIndex === null || !patientRecords[currentEditIndex]) return "";

  return patientRecords[currentEditIndex].id || "";
}

function recordsIsActiveAppointmentForSlotCheck(record) {
  if (!record) return false;
  if (recordsIsArchived(record)) return false;
  if (!record.appointmentDate) return false;
  if (!record.appointmentTime) return false;

  return true;
}

function recordsIsSlotTaken(date, time, currentId = null) {
  return patientRecords.some(function (record) {
    if (String(record.id) === String(currentId)) return false;
    if (!recordsIsActiveAppointmentForSlotCheck(record)) return false;
    if (String(record.appointmentDate || "") !== String(date)) return false;

    return recordsGetAppointmentSlots(record).includes(time);
  });
}

function recordsCanAutoSelectSlots(date, startIndex, neededSlots, clinicSlots) {
  if (!neededSlots || neededSlots <= 0) return false;

  const startSlot = clinicSlots[startIndex];
  if (!startSlot) return false;

  const appointmentEndMinutes =
    recordsTimeToMinutes(startSlot) + neededSlots * 30;

  const cutoffMinutes = recordsTimeToMinutes(RECORDS_CUTOFF_TIME);

  if (appointmentEndMinutes > cutoffMinutes) {
    return false;
  }

  for (let i = 0; i < neededSlots; i++) {
    const slot = clinicSlots[startIndex + i];

    if (!slot) return false;
    if (!recordsIsBookableClinicSlot(slot)) return false;
    if (recordsIsSlotTaken(date, slot, recordsCurrentEditId())) return false;
  }

  return true;
}

function recordsSyncSelectedSlotsFromInput() {
  editSelectedSlots = String(recordsGetValue("editAppointmentTime") || "")
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

/* ================= OVERRIDE OLD LOCKED FUNCTIONS ================= */
function renderLockedEditCalendar() {
  if (isRecordsAdminPage()) {
    renderRecordsAdminEditCalendar();
    return;
  }

  renderRecordsStaffLockedCalendar();
}

function renderLockedEditTimeSlots() {
  if (isRecordsAdminPage()) {
    renderRecordsAdminEditTimeSlots();
    return;
  }

  renderRecordsStaffLockedTimeSlots();
}

/* ================= STAFF LOCKED VIEW ================= */
function renderRecordsStaffLockedCalendar() {
  const monthLabel = document.getElementById("editCalendarMonthLabel");
  const daysContainer = document.getElementById("editCalendarDays");
  const selectedDateInput = document.getElementById("editAppointmentDate");
  const prevBtn = document.getElementById("editPrevCalendarMonth");
  const nextBtn = document.getElementById("editNextCalendarMonth");

  if (!monthLabel || !daysContainer || !selectedDateInput) return;

  if (prevBtn) prevBtn.disabled = true;
  if (nextBtn) nextBtn.disabled = true;

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
    const dateKey = recordsFormatDateKey(date);

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

function renderRecordsStaffLockedTimeSlots() {
  const slotsContainer = document.getElementById("editAppointmentTimeSlots");
  const appointmentTime = recordsGetValue("editAppointmentTime");

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
    button.textContent = recordsFormatSingleTime(timeValue);

    slotsContainer.appendChild(button);
  });
}

/* ================= ADMIN EDITABLE CALENDAR ================= */
function renderRecordsAdminEditCalendar() {
  const monthLabel = document.getElementById("editCalendarMonthLabel");
  const daysContainer = document.getElementById("editCalendarDays");
  const selectedDateInput = document.getElementById("editAppointmentDate");
  const selectedDateText = document.getElementById("editAppointmentSelectedDateText");
  const prevBtn = document.getElementById("editPrevCalendarMonth");
  const nextBtn = document.getElementById("editNextCalendarMonth");

  if (!monthLabel || !daysContainer) return;

  if (prevBtn) prevBtn.disabled = false;
  if (nextBtn) nextBtn.disabled = false;

  const year = editCalendarDate.getFullYear();
  const month = editCalendarDate.getMonth();

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
    blank.className = "calendar-day disabled";
    daysContainer.appendChild(blank);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const bookableClinicSlots = recordsGetClinicTimeSlots().filter(recordsIsBookableClinicSlot);
  const totalSlots = bookableClinicSlots.length;

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateKey = recordsFormatDateKey(date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    const takenSlots = bookableClinicSlots.filter(function (slot) {
      return recordsIsSlotTaken(dateKey, slot, recordsCurrentEditId());
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

      editSelectedSlots = [];

      recordsSetValue("editAppointmentDate", dateKey);
      recordsSetValue("editAppointmentTime", "");

      if (selectedDateText) {
        selectedDateText.textContent = recordsFormatFullDateUpper(dateKey);
      }

      renderRecordsAdminEditCalendar();
      renderRecordsAdminEditTimeSlots();
    });

    daysContainer.appendChild(button);
  }
}

/* ================= ADMIN EDITABLE TIME SLOTS ================= */
function renderRecordsAdminEditTimeSlots() {
  const dateInput = document.getElementById("editAppointmentDate");
  const timeInput = document.getElementById("editAppointmentTime");
  const slotsContainer = document.getElementById("editAppointmentTimeSlots");
  const serviceType = document.getElementById("editAppointmentType")?.value;

  if (!dateInput || !timeInput || !slotsContainer) return;

  recordsSyncSelectedSlotsFromInput();

  slotsContainer.innerHTML = "";

  if (!serviceType) {
    slotsContainer.innerHTML = `<p class="text-muted mb-0">Please select a service first.</p>`;
    return;
  }

  if (!dateInput.value) {
    slotsContainer.innerHTML = `<p class="text-muted mb-0">Please select a date first.</p>`;
    return;
  }

  const clinicSlots = recordsGetClinicTimeSlots();
  const neededSlots = getServiceDurationSlots(serviceType);

  clinicSlots.forEach(function (timeValue, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-slot-btn";

    const isLunchSlot = recordsIsLunchSlot(timeValue);
    const isCutoffSlot = recordsIsCutoffSlot(timeValue);
    const isTaken = recordsIsSlotTaken(dateInput.value, timeValue, recordsCurrentEditId());
    const isUnavailable = isLunchSlot || isCutoffSlot || isTaken;

    if (isLunchSlot) {
      button.classList.add("lunch-break");
      button.disabled = true;
      button.innerHTML = `${recordsFormatSingleTime(timeValue)}<small>Lunch Break</small>`;
      button.title = "Lunch break: 12:00 PM to 1:00 PM";
    } else if (isCutoffSlot) {
      button.classList.add("cutoff-break");
      button.disabled = true;
      button.innerHTML = `${recordsFormatSingleTime(timeValue)}<small>Cutoff</small>`;
      button.title = "Clinic cutoff time";
    } else if (isTaken) {
      button.classList.add("booked");
      button.disabled = true;
      button.textContent = recordsFormatSingleTime(timeValue);
      button.title = "This slot is already booked";
    } else {
      button.textContent = recordsFormatSingleTime(timeValue);
    }

    if (!isUnavailable && editSelectedSlots.includes(timeValue)) {
      button.classList.add("active");
    }

    button.addEventListener("click", function () {
      if (isUnavailable) return;

      if (serviceType === "Surgery") {
        if (editSelectedSlots.includes(timeValue)) {
          editSelectedSlots = editSelectedSlots.filter(function (slot) {
            return slot !== timeValue;
          });
        } else {
          editSelectedSlots.push(timeValue);
        }

        timeInput.value = editSelectedSlots.join(",");
        renderRecordsAdminEditTimeSlots();
        return;
      }

      if (!recordsCanAutoSelectSlots(dateInput.value, index, neededSlots, clinicSlots)) {
        recordsNotify(
          "This schedule is not available because it overlaps with lunch break, booked slots, or clinic cutoff.",
          "error"
        );

        editSelectedSlots = [];
        timeInput.value = "";
        renderRecordsAdminEditTimeSlots();
        return;
      }

      editSelectedSlots = clinicSlots.slice(index, index + neededSlots);
      timeInput.value = editSelectedSlots.join(",");

      renderRecordsAdminEditTimeSlots();
    });

    slotsContainer.appendChild(button);
  });
}

/* ================= ADMIN EVENTS ================= */
function initializeRecordsAdminScheduleEvents() {
  const prevBtn = document.getElementById("editPrevCalendarMonth");
  const nextBtn = document.getElementById("editNextCalendarMonth");
  const appointmentType = document.getElementById("editAppointmentType");

  if (prevBtn && prevBtn.dataset.recordsAdminBound !== "true") {
    prevBtn.addEventListener("click", function () {
      if (!isRecordsAdminPage()) return;

      editCalendarDate.setMonth(editCalendarDate.getMonth() - 1);
      renderRecordsAdminEditCalendar();
    });

    prevBtn.dataset.recordsAdminBound = "true";
  }

  if (nextBtn && nextBtn.dataset.recordsAdminBound !== "true") {
    nextBtn.addEventListener("click", function () {
      if (!isRecordsAdminPage()) return;

      editCalendarDate.setMonth(editCalendarDate.getMonth() + 1);
      renderRecordsAdminEditCalendar();
    });

    nextBtn.dataset.recordsAdminBound = "true";
  }

  if (appointmentType && appointmentType.dataset.recordsAdminBound !== "true") {
    appointmentType.addEventListener("change", function () {
      if (!isRecordsAdminPage()) return;

      editSelectedSlots = [];
      recordsSetValue("editAppointmentTime", "");

      renderRecordsAdminEditCalendar();
      renderRecordsAdminEditTimeSlots();
    });

    appointmentType.dataset.recordsAdminBound = "true";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeRecordsAdminScheduleEvents);
} else {
  initializeRecordsAdminScheduleEvents();
}

/* ================= SAVE OVERRIDE ================= */
async function saveEditedRecord(event) {
  event.preventDefault();

  if (currentEditIndex === null || !patientRecords[currentEditIndex]) return;

  const oldRecord = patientRecords[currentEditIndex];
  const appointmentType = recordsGetValue("editAppointmentType").trim();

  if (!appointmentType) {
    recordsNotify("Please select visit type.", "error");
    return;
  }

  const canEditSchedule = isRecordsAdminPage();

  const appointmentDate = canEditSchedule
    ? recordsGetValue("editAppointmentDate")
    : oldRecord.appointmentDate;

  const appointmentTime = canEditSchedule
    ? recordsGetValue("editAppointmentTime")
    : oldRecord.appointmentTime;

  if (canEditSchedule && (!appointmentDate || !appointmentTime)) {
    recordsNotify("Please select appointment date and time.", "error");
    return;
  }

  const updatedRecord = {
    ...oldRecord,
    id: recordsGetValue("editId"),
    petName: recordsGetValue("editPetName").trim(),
    petSpecies: recordsGetValue("editPetSpecies").trim(),
    breed: recordsGetValue("editBreed").trim(),
    ownerName: recordsGetValue("editOwnerName").trim(),

    appointmentDate,
    appointmentTime,
    appointmentType,

    lastAppointmentDate: appointmentDate,
    lastAppointmentTime: appointmentTime,
    lastAppointmentType: appointmentType,

    gender: recordsGetValue("editGender").trim(),
    weight: recordsGetValue("editWeight").trim(),
    age: recordsGetValue("editAge").trim(),
    contactNumber: recordsGetValue("editContactNumber").trim(),
    email: recordsGetValue("editEmail").trim(),
    notes: recordsGetValue("editInternalNotes").trim(),
    internalNotes: recordsGetValue("editInternalNotes").trim(),
    petImage: recordsGetValue("editPetImageData"),

    appointmentArchived: false,
    archived: false,
    isArchived: false,
    status: "active",
    archivedAt: "",
    appointmentArchivedAt: "",
    updatedAt: new Date().toISOString()
  };

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Patient Records",
    action: canEditSchedule ? "Edited Record and Schedule" : "Edited Record",
    details: `${updatedRecord.petName || "Patient"} record updated`
  };

  try {
    await updatePatientRecordInFirebase(oldRecord, {
      id: updatedRecord.id,
      petName: updatedRecord.petName,
      petSpecies: updatedRecord.petSpecies,
      breed: updatedRecord.breed,
      ownerName: updatedRecord.ownerName,

      appointmentDate: updatedRecord.appointmentDate,
      appointmentTime: updatedRecord.appointmentTime,
      appointmentType: updatedRecord.appointmentType,

      lastAppointmentDate: updatedRecord.lastAppointmentDate,
      lastAppointmentTime: updatedRecord.lastAppointmentTime,
      lastAppointmentType: updatedRecord.lastAppointmentType,

      gender: updatedRecord.gender,
      weight: updatedRecord.weight,
      age: updatedRecord.age,
      contactNumber: updatedRecord.contactNumber,
      email: updatedRecord.email,
      notes: updatedRecord.notes,
      internalNotes: updatedRecord.internalNotes,
      petImage: updatedRecord.petImage,

      appointmentArchived: false,
      archived: false,
      isArchived: false,
      status: "active",
      archivedAt: "",
      appointmentArchivedAt: ""
    });

    await saveRecentActivityToFirebase(activity);

    patientRecords[currentEditIndex] = updatedRecord;

    savePatientRecords();
    saveRecentActivity(activity);

    renderActiveRecords();
    closeEditModal();

    recordsNotify(
      canEditSchedule
        ? "Record and schedule updated successfully."
        : "Record updated successfully.",
      "success"
    );
  } catch (error) {
    console.error("Firebase edit record error:", error);
    recordsNotify("Failed to update record in Firebase.", "error");
  }
}