let registerClicked = false;

document.addEventListener("DOMContentLoaded", function () {
  updateRecordIdField();
  initializeCustomDropdowns();
  initializeRegistrationEvents();
});

function getNextRecordId() {
  return Math.floor(Math.random() * 100000);
}

function updateRecordIdField() {
  const recordIdInput = document.getElementById("recordId");
  if (recordIdInput) {
    recordIdInput.value = getNextRecordId();
    recordIdInput.readOnly = true;
  }
}

/* NOTIFICATION */
function showNotification(message, type = "error") {
  const container = document.getElementById("notificationContainer");
  if (!container) return;

  container.innerHTML = "";

  const notif = document.createElement("div");
  notif.className = `notif ${type}`;
  notif.textContent = message;

  container.appendChild(notif);

  setTimeout(() => {
    notif.remove();
  }, 3000);
}

/* DROPDOWNS */
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

  selected.addEventListener("click", () => {
    dropdown.classList.toggle("active");
  });

  options.forEach(option => {
    option.addEventListener("click", () => {
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

/* DATA */
function getFormData() {
  return {
    id: document.getElementById("recordId")?.value,
    petName: document.getElementById("petName")?.value.trim(),
    petSpecies: document.getElementById("petSpecies")?.value.trim(),
    breed: document.getElementById("breed")?.value.trim(),
    age: document.getElementById("age")?.value.trim(),
    ageUnit: document.getElementById("ageUnit")?.value.trim(),
    gender: document.getElementById("gender")?.value.trim(),
    weight: document.getElementById("weight")?.value.trim(),
    ownerName: document.getElementById("ownerName")?.value.trim(),
    contactNumber: document.getElementById("contactNumber")?.value.trim(),
    email: document.getElementById("email")?.value.trim()
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

  if (state === "error") el.classList.add("field-error");
}

function clearFieldStates() {
  Object.keys(fieldMap).forEach(key => setFieldState(key, "clear"));
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

/* VALIDATION */
function validateForm(data) {
  clearFieldStates();

  let hasMissing = false;
  let hasInvalid = false;
  let firstErrorKey = null;

  Object.keys(fieldMap).forEach(key => {
    const value = data[key];

    if (isBlank(key, value)) {
      setFieldState(key, "error");
      hasMissing = true;
      if (!firstErrorKey) firstErrorKey = key;
      return;
    }

    if (!isValidField(key, value)) {
      setFieldState(key, "error");
      hasInvalid = true;
      if (!firstErrorKey) firstErrorKey = key;
      return;
    }

    setFieldState(key, "clear");
  });

  if (firstErrorKey) {
    focusFirstError(firstErrorKey);
  }

  if (hasMissing) {
    showNotification("Please input the missing fields.");
    return false;
  }

  if (hasInvalid) {
    showNotification("Please check the highlighted fields.");
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
    setTimeout(() => el.focus(), 300);
  }
}

/* REGISTER */
function registerPatient() {
  registerClicked = true;

  const data = getFormData();

  if (!validateForm(data)) return;

  const newRecord = {
    ...data,
    age: `${data.age} ${data.ageUnit}`,
    appointmentDate: "",
    appointmentTime: "",
    appointmentType: "",
    appointmentStatus: ""
  };

  console.log("READY FOR FIREBASE:", newRecord);

  showNotification("Registered successfully!", "success");
  resetForm();
}

/* RESET */
function resetForm() {
  document.getElementById("registerForm")?.reset();

  document.getElementById("petSpecies").value = "";
  document.getElementById("gender").value = "";

  document.querySelector("#petSpeciesDropdown .dropdown-selected").innerHTML =
    `Select Pet Species <span class="arrow">▼</span>`;

  document.querySelector("#genderDropdown .dropdown-selected").innerHTML =
    `Select Gender <span class="arrow">▼</span>`;

  registerClicked = false;
  clearFieldStates();
  updateRecordIdField();
}

/* EVENTS */
function initializeRegistrationEvents() {
  const registerBtn = document.getElementById("setAppointmentBtn");

  if (registerBtn) {
    registerBtn.addEventListener("click", registerPatient);
  }

  ["petName", "breed", "ownerName"].forEach(id => {
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
      if (!this.value) this.value = "+63";
    });

    contactInput.addEventListener("keydown", function (e) {
      if (this.value === "+63" && e.key === "Backspace") {
        e.preventDefault();
      }
    });

    contactInput.addEventListener("input", function () {
      let raw = this.value.replace(/\D/g, "");

      if (raw.startsWith("63")) raw = raw.slice(2);
      raw = raw.slice(0, 10);

      this.value = "+63" + raw;
      validateSingleField("contactNumber");
    });
  }
}