let registerClicked = false;

document.addEventListener("DOMContentLoaded", function () {
  updateRecordIdField();
  initializeCustomDropdowns();
  initializeRegistrationEvents();
});

/* ================= LOCAL STORAGE ================= */
const REGISTRATION_STORAGE_KEYS = {
  patientRecords: "patientRecords",
  archivedPatientRecords: "archivedPatientRecords",
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

function savePatientRecordToLocalStorage(record) {
  const patientRecords = getLocalStorageArray(
    REGISTRATION_STORAGE_KEYS.patientRecords
  );

  const activeRecords = patientRecords.filter(function (item) {
    return !isArchivedPatientRecord(item);
  });

  activeRecords.unshift(record);

  setLocalStorageArray(
    REGISTRATION_STORAGE_KEYS.patientRecords,
    activeRecords
  );
}

function saveRecentActivityToLocalStorage(activity) {
  const recentActivities = getLocalStorageArray(
    REGISTRATION_STORAGE_KEYS.recentActivities
  );

  recentActivities.unshift(activity);

  setLocalStorageArray(
    REGISTRATION_STORAGE_KEYS.recentActivities,
    recentActivities
  );
}

/* ================= RECORD ID ================= */
function getNextRecordId() {
  const patientRecords = getLocalStorageArray(
    REGISTRATION_STORAGE_KEYS.patientRecords
  );

  const archivedPatientRecords = getLocalStorageArray(
    REGISTRATION_STORAGE_KEYS.archivedPatientRecords
  );

  const allRecords = [
    ...patientRecords,
    ...archivedPatientRecords
  ];

  const ids = allRecords
    .map(function (record) {
      return parseInt(record.id, 10);
    })
    .filter(function (id) {
      return !isNaN(id) && id >= 1001;
    });

  if (ids.length === 0) {
    return "1001";
  }

  return String(Math.max(...ids) + 1);
}

function updateRecordIdField() {
  const recordIdInput = document.getElementById("recordId");

  if (recordIdInput) {
    recordIdInput.value = getNextRecordId();
    recordIdInput.readOnly = true;
  }
}

/* ================= NOTIFICATION ================= */
function showNotification(message, type = "error") {
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

  notif.style.background = colors[type] || colors.error;

  container.appendChild(notif);

  setTimeout(function () {
    notif.classList.add("hide");

    setTimeout(function () {
      notif.remove();
    }, 250);
  }, 2600);
}

/* ================= DROPDOWNS ================= */
function initializeCustomDropdowns() {
  setupCustomDropdown("petSpeciesDropdown", "petSpecies");
  setupCustomDropdown("genderDropdown", "gender");
}

function setupCustomDropdown(dropdownId, hiddenInputId) {
  const dropdown = document.getElementById(dropdownId);
  const hiddenInput = document.getElementById(hiddenInputId);

  if (!dropdown || !hiddenInput) return;

  const selected = dropdown.querySelector(".dropdown-selected");
  const options = dropdown.querySelectorAll(".dropdown-options div");

  if (!selected) return;

  selected.addEventListener("click", function () {
    dropdown.classList.toggle("active");
  });

  options.forEach(function (option) {
    option.addEventListener("click", function () {
      const value = option.dataset.value;

      hiddenInput.value = value;
      selected.innerHTML = `${value} <span class="arrow">▼</span>`;

      dropdown.classList.remove("active");
      validateSingleField(hiddenInputId);
    });
  });

  document.addEventListener("click", function (event) {
    if (!dropdown.contains(event.target)) {
      dropdown.classList.remove("active");
    }
  });
}

/* ================= DATA ================= */
function getFormData() {
  return {
    id: document.getElementById("recordId")?.value || "",
    petName: document.getElementById("petName")?.value.trim() || "",
    petSpecies: document.getElementById("petSpecies")?.value.trim() || "",
    breed: document.getElementById("breed")?.value.trim() || "",
    age: document.getElementById("age")?.value.trim() || "",
    ageUnit: document.getElementById("ageUnit")?.value.trim() || "",
    gender: document.getElementById("gender")?.value.trim() || "",
    weight: document.getElementById("weight")?.value.trim() || "",
    ownerName: document.getElementById("ownerName")?.value.trim() || "",
    contactNumber: document.getElementById("contactNumber")?.value.trim() || "",
    email: document.getElementById("email")?.value.trim() || ""
  };
}

const fieldMap = {
  petName: { id: "petName", type: "letters" },
  petSpecies: { id: "petSpeciesDropdown", type: "required" },
  breed: { id: "breed", type: "letters" },
  age: { id: "age", type: "number" },
  gender: { id: "genderDropdown", type: "required" },
  weight: { id: "weight", type: "decimal" },
  ownerName: { id: "ownerName", type: "letters" },
  contactNumber: { id: "contactNumber", type: "contact" },
  email: { id: "email", type: "email" }
};

function setFieldState(key, state) {
  const field = fieldMap[key];
  if (!field) return;

  const el = document.getElementById(field.id);
  if (!el) return;

  el.classList.remove("field-error", "field-valid");

  if (state === "error") {
    el.classList.add("field-error");
  }
}

function clearFieldStates() {
  Object.keys(fieldMap).forEach(function (key) {
    setFieldState(key, "clear");
  });
}

function isBlank(key, value) {
  if (!value) return true;
  if (key === "contactNumber" && value === "+63") return true;

  return value.toString().trim() === "";
}

function isValidField(key, value) {
  const lettersOnly = /^[A-Za-z\s]+$/;
  const emailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (isBlank(key, value)) return false;

  switch (fieldMap[key].type) {
    case "letters":
      return lettersOnly.test(value);

    case "number":
      return /^\d+$/.test(value);

    case "decimal":
      return /^\d+(\.\d+)?$/.test(value);

    case "email":
      return emailFormat.test(value);

    case "contact":
      return /^\+639\d{9}$/.test(value);

    case "required":
      return !isBlank(key, value);

    default:
      return true;
  }
}

function validateSingleField(key) {
  if (!registerClicked) return;

  const data = getFormData();
  const value = data[key];

  if (isValidField(key, value)) {
    setFieldState(key, "clear");
  } else {
    setFieldState(key, "error");
  }
}

/* ================= VALIDATION ================= */
function validateForm(data) {
  clearFieldStates();

  let hasMissing = false;
  let hasInvalid = false;
  let firstErrorKey = null;

  Object.keys(fieldMap).forEach(function (key) {
    const value = data[key];

    if (isBlank(key, value)) {
      setFieldState(key, "error");
      hasMissing = true;

      if (!firstErrorKey) {
        firstErrorKey = key;
      }

      return;
    }

    if (!isValidField(key, value)) {
      setFieldState(key, "error");
      hasInvalid = true;

      if (!firstErrorKey) {
        firstErrorKey = key;
      }

      return;
    }

    setFieldState(key, "clear");
  });

  if (firstErrorKey) {
    focusFirstError(firstErrorKey);
  }

  if (hasMissing) {
    showNotification("Please input the missing fields.", "error");
    return false;
  }

  if (hasInvalid) {
    showNotification("Please check the highlighted fields.", "error");
    return false;
  }

  return true;
}

function focusFirstError(key) {
  const field = fieldMap[key];
  if (!field) return;

  const el = document.getElementById(field.id);
  if (!el) return;

  el.scrollIntoView({ behavior: "smooth", block: "center" });

  if (el.tagName === "INPUT") {
    setTimeout(function () {
      el.focus();
    }, 300);
  }
}

/* ================= REGISTER ================= */
async function registerPatient() {
  registerClicked = true;

  const data = getFormData();

  if (!validateForm(data)) return;

  const newRecord = {
    id: data.id,
    petName: data.petName,
    petSpecies: data.petSpecies,
    breed: data.breed,
    age: `${data.age} ${data.ageUnit}`,
    ageUnit: data.ageUnit,
    gender: data.gender,
    weight: data.weight,
    ownerName: data.ownerName,
    contactNumber: data.contactNumber,
    email: data.email,

    patientPassword: "1234",

    appointmentDate: "",
    appointmentTime: "",
    appointmentType: "",
    appointmentStatus: "Waiting",
    appointmentArchived: false,

    notes: "",
    registeredAt: new Date().toLocaleString(),
    status: "active"
  };

  const recentActivity = {
    dateTime: new Date().toLocaleString(),
    module: "Registration",
    action: "Registered Patient",
    details: `${newRecord.petName} was registered`
  };

  try {
    await window.db.collection("patientRecords").add({
      ...newRecord,
      ageNumber: Number(data.age),
      weightKg: Number(data.weight),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await window.db.collection("recentActivities").add({
      ...recentActivity,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    savePatientRecordToLocalStorage(newRecord);
    saveRecentActivityToLocalStorage(recentActivity);

    showNotification("Registered successfully!", "success");
    resetForm();
  } catch (error) {
    console.error("Firebase save error:", error);
    showNotification("Failed to save to Firebase. Please try again.", "error");
  }
}

/* ================= RESET ================= */
function resetForm() {
  document.getElementById("registerForm")?.reset();

  const petSpeciesInput = document.getElementById("petSpecies");
  const genderInput = document.getElementById("gender");

  if (petSpeciesInput) {
    petSpeciesInput.value = "";
  }

  if (genderInput) {
    genderInput.value = "";
  }

  const petSpeciesSelected = document.querySelector(
    "#petSpeciesDropdown .dropdown-selected"
  );

  const genderSelected = document.querySelector(
    "#genderDropdown .dropdown-selected"
  );

  if (petSpeciesSelected) {
    petSpeciesSelected.innerHTML = `Select Pet Species <span class="arrow">▼</span>`;
  }

  if (genderSelected) {
    genderSelected.innerHTML = `Select Gender <span class="arrow">▼</span>`;
  }

  registerClicked = false;
  clearFieldStates();
  updateRecordIdField();
}

/* ================= EVENTS ================= */
function initializeRegistrationEvents() {
  const registerBtn = document.getElementById("setAppointmentBtn");

  if (registerBtn) {
    registerBtn.addEventListener("click", registerPatient);
  }

  ["petName", "breed", "ownerName"].forEach(function (id) {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener("input", function () {
      this.value = this.value.replace(/[^A-Za-z\s]/g, "");
      validateSingleField(id);
    });
  });

  const ageInput = document.getElementById("age");

  if (ageInput) {
    ageInput.addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "");
      validateSingleField("age");
    });
  }

  const weightInput = document.getElementById("weight");

  if (weightInput) {
    weightInput.addEventListener("input", function () {
      const oldValue = this.value;
      const oldCursor = this.selectionStart;

      let value = oldValue.replace(/[^0-9.]/g, "");

      const parts = value.split(".");
      if (parts.length > 2) {
        value = parts[0] + "." + parts.slice(1).join("");
      }

      const removedChars = oldValue.length - value.length;

      this.value = value;

      const newCursor = Math.max(0, oldCursor - removedChars);
      this.setSelectionRange(newCursor, newCursor);

      validateSingleField("weight");
    });
  }

  const emailInput = document.getElementById("email");

  if (emailInput) {
    emailInput.addEventListener("input", function () {
      validateSingleField("email");
    });
  }

  const contactInput = document.getElementById("contactNumber");

  if (contactInput) {
    contactInput.addEventListener("focus", function () {
      if (!this.value) {
        this.value = "+63";
      }
    });

    contactInput.addEventListener("keydown", function (event) {
      if (this.value === "+63" && event.key === "Backspace") {
        event.preventDefault();
      }
    });

    contactInput.addEventListener("input", function () {
      let raw = this.value.replace(/\D/g, "");

      if (raw.startsWith("63")) {
        raw = raw.slice(2);
      }

      raw = raw.slice(0, 10);

      this.value = "+63" + raw;
      validateSingleField("contactNumber");
    });
  }
}

/* ================= HELPERS ================= */
function isArchivedPatientRecord(record) {
  return (
    record?.appointmentArchived === true ||
    record?.archived === true ||
    record?.isArchived === true ||
    String(record?.status || "").toLowerCase() === "archived"
  );
}