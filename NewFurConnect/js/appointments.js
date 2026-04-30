document.addEventListener("DOMContentLoaded", function () {
  updateRecordIdField();
  initializeCustomDropdowns();
  initializeAppointmentCalendar();
  initializeAppointmentEvents();
});

/* TEMP DATA ONLY — papalitan later ng Firebase */
let patientRecords = [];
let selectedSlots = [];

let currentCalendarDate = new Date();

/* ================= HELPERS ================= */

function getNextRecordId() {
  if (patientRecords.length === 0) return 1;

  return patientRecords.reduce((max, record) => {
    return Math.max(max, parseInt(record.id, 10) || 0);
  }, 0) + 1;
}

function updateRecordIdField() {
  const recordIdInput = document.getElementById("recordId");

  if (recordIdInput) {
    recordIdInput.value = getNextRecordId();
  }
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatSlotLabel(timeValue) {
  let [hours, minutes] = timeValue.split(":");
  hours = parseInt(hours, 10);

  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;

  return `${displayHour}:${minutes} ${ampm}`;
}

function getClinicTimeSlots() {
  const slots = [];
  let hour = 9;
  let minute = 0;

  while (hour < 17 || (hour === 17 && minute === 0)) {
    const formattedHour = String(hour).padStart(2, "0");
    const formattedMinute = String(minute).padStart(2, "0");

    slots.push(`${formattedHour}:${formattedMinute}`);

    minute += 30;

    if (minute === 60) {
      minute = 0;
      hour++;
    }
  }

  return slots;
}

function isAppointmentSlotTaken(appointmentDate, appointmentTime) {
  if (!appointmentDate || !appointmentTime) return false;

  return patientRecords.some((record) => {
    if (record.appointmentDate !== appointmentDate) return false;

    const takenSlots = String(record.appointmentTime || "")
      .split(",")
      .map((time) => time.trim());

    return takenSlots.includes(appointmentTime);
  });
}

/* ================= CUSTOM DROPDOWNS ================= */

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

  selected.addEventListener("click", function () {
    dropdown.classList.toggle("active");
  });

  options.forEach((option) => {
    option.addEventListener("click", function () {
      const value = option.dataset.value;

      hiddenInput.value = value;
      selected.innerHTML = `${value} <span class="arrow">▼</span>`;

      dropdown.classList.remove("active");
      dropdown.classList.remove("invalid");
      dropdown.classList.add("valid");
    });
  });

  document.addEventListener("click", function (event) {
    if (!dropdown.contains(event.target)) {
      dropdown.classList.remove("active");
    }
  });
}

/* ================= CALENDAR ================= */

function initializeAppointmentCalendar() {
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();

  const prevBtn = document.getElementById("prevCalendarMonth");
  const nextBtn = document.getElementById("nextCalendarMonth");

  if (prevBtn) {
    prevBtn.addEventListener("click", function () {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
      renderAppointmentCalendar();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
      renderAppointmentCalendar();
    });
  }
}

function renderAppointmentCalendar() {
  const monthLabel = document.getElementById("calendarMonthLabel");
  const daysContainer = document.getElementById("appointmentCalendarDays");
  const selectedDateInput = document.getElementById("appointmentDate");
  const selectedDateText = document.getElementById("appointmentSelectedDateText");

  if (!monthLabel || !daysContainer) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  monthLabel.textContent = currentCalendarDate.toLocaleDateString("en-US", {
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

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateKey = formatDateKey(date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    const totalSlots = getClinicTimeSlots().length;
    const takenSlots = getClinicTimeSlots().filter((slot) =>
      isAppointmentSlotTaken(dateKey, slot)
    ).length;

    const availableSlots = totalSlots - takenSlots;

    if (availableSlots <= 0) {
      button.classList.add("red");
    } else if (availableSlots <= 5) {
      button.classList.add("yellow");
    } else {
      button.classList.add("green");
    }

    if (date < today) {
      button.classList.add("disabled");
      button.disabled = true;
    }

    if (selectedDateInput?.value === dateKey) {
      button.classList.add("selected");
    }

    button.innerHTML = `
      <strong>${day}</strong>
      <small>${availableSlots} slots</small>
    `;

    button.addEventListener("click", function () {
      if (button.disabled) return;

      selectedSlots = [];

      if (selectedDateInput) selectedDateInput.value = dateKey;

      if (selectedDateText) {
        selectedDateText.textContent = date.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric"
        });
      }

      const appointmentTimeInput = document.getElementById("appointmentTime");
      if (appointmentTimeInput) appointmentTimeInput.value = "";

      renderAppointmentCalendar();
      renderAppointmentTimeSlots();
    });

    daysContainer.appendChild(button);
  }
}

function renderAppointmentTimeSlots() {
  const appointmentDateInput = document.getElementById("appointmentDate");
  const appointmentTimeInput = document.getElementById("appointmentTime");
  const appointmentTimeSlots = document.getElementById("appointmentTimeSlots");

  if (!appointmentDateInput || !appointmentTimeInput || !appointmentTimeSlots) return;

  const selectedDate = appointmentDateInput.value;

  appointmentTimeSlots.innerHTML = "";

  if (!selectedDate) {
    appointmentTimeSlots.innerHTML = `
      <p class="text-muted mb-0">Please select a date first.</p>
    `;
    return;
  }

  getClinicTimeSlots().forEach((timeValue) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-slot-btn";
    button.textContent = formatSlotLabel(timeValue);

    const isTaken = isAppointmentSlotTaken(selectedDate, timeValue);

    if (isTaken) {
      button.disabled = true;
      button.classList.add("booked");
    }

    if (selectedSlots.includes(timeValue)) {
      button.classList.add("active");
    }

    button.addEventListener("click", function () {
      if (isTaken) return;

      if (selectedSlots.includes(timeValue)) {
        selectedSlots = selectedSlots.filter((slot) => slot !== timeValue);
        button.classList.remove("active");
      } else {
        selectedSlots.push(timeValue);
        button.classList.add("active");
      }

      appointmentTimeInput.value = selectedSlots.join(",");
    });

    appointmentTimeSlots.appendChild(button);
  });
}

/* ================= VALIDATION ================= */

function validateAppointmentForm(data) {
  const lettersOnly = /^[A-Za-z\s]+$/;
  const gmailOnly = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;

  if (
    !data.id ||
    !data.ownerName ||
    !data.contactNumber ||
    !data.email ||
    !data.petName ||
    !data.petSpecies ||
    !data.breed ||
    !data.age ||
    !data.ageUnit ||
    !data.gender ||
    !data.weight ||
    !data.appointmentDate ||
    !data.appointmentTime ||
    !data.appointmentType
  ) {
    alert("Please fill in all fields and select appointment slot.");
    return false;
  }

  if (
    !lettersOnly.test(data.petName) ||
    !lettersOnly.test(data.breed) ||
    !lettersOnly.test(data.ownerName)
  ) {
    alert("Pet name, breed, and owner name must contain letters only.");
    return false;
  }

  if (!/^\d+$/.test(data.contactNumber)) {
    alert("Contact number must contain numbers only.");
    return false;
  }

  if (!/^\d+$/.test(data.age)) {
    alert("Age must contain numbers only.");
    return false;
  }

  if (!/^\d+(\.\d+)?$/.test(data.weight)) {
    alert("Weight must be a valid number.");
    return false;
  }

  if (!gmailOnly.test(data.email)) {
    alert("Only @gmail.com emails are allowed.");
    return false;
  }

  return true;
}

/* ================= SUBMIT ================= */

function getAppointmentFormData() {
  return {
    id: parseInt(document.getElementById("recordId")?.value, 10),
    ownerName: document.getElementById("ownerName")?.value.trim(),
    contactNumber: document.getElementById("contactNumber")?.value.trim(),
    email: document.getElementById("email")?.value.trim(),
    petName: document.getElementById("petName")?.value.trim(),
    petSpecies: document.getElementById("petSpecies")?.value.trim(),
    breed: document.getElementById("breed")?.value.trim(),
    age: document.getElementById("age")?.value.trim(),
    ageUnit: document.getElementById("ageUnit")?.value.trim(),
    gender: document.getElementById("gender")?.value.trim(),
    weight: document.getElementById("weight")?.value.trim(),
    appointmentDate: document.getElementById("appointmentDate")?.value,
    appointmentTime:
      selectedSlots.length > 0
        ? selectedSlots.join(",")
        : document.getElementById("appointmentTime")?.value,
    appointmentType: document.getElementById("appointmentType")?.value.trim()
  };
}

function setAppointment() {
  const data = getAppointmentFormData();

  if (!validateAppointmentForm(data)) return;

  const selectedTimeList = data.appointmentTime
    .split(",")
    .map((time) => time.trim());

  const hasTakenSlot = selectedTimeList.some((time) =>
    isAppointmentSlotTaken(data.appointmentDate, time)
  );

  if (hasTakenSlot) {
    alert("One of the selected appointment slots is already taken.");
    return;
  }

  const newRecord = {
    id: data.id,
    recordUid: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ownerName: data.ownerName,
    contactNumber: data.contactNumber,
    email: data.email,
    petName: data.petName,
    petSpecies: data.petSpecies,
    breed: data.breed,
    age: `${data.age} ${data.ageUnit}`,
    gender: data.gender,
    weight: data.weight,
    appointmentDate: data.appointmentDate,
    appointmentTime: data.appointmentTime,
    nextAppointmentDate: "",
    nextAppointmentTime: "",
    appointmentType: data.appointmentType,
    appointmentStatus: "Waiting",
    inventoryDeducted: false,
    totalVisits: "",
    internalNotes: "",
    petImage: "",
    medicalHistory: [],
    appointmentArchived: false
  };

  patientRecords.push(newRecord);

  alert("Appointment set successfully!");

  selectedSlots = [];

  const registerForm = document.getElementById("registerForm");
  if (registerForm) registerForm.reset();

  const appointmentTimeInput = document.getElementById("appointmentTime");
  if (appointmentTimeInput) appointmentTimeInput.value = "";

  updateRecordIdField();
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();
}

/* ================= EVENTS ================= */

function initializeAppointmentEvents() {
  const setAppointmentBtn = document.getElementById("setAppointmentBtn");

  if (setAppointmentBtn) {
    setAppointmentBtn.addEventListener("click", setAppointment);
  }

  ["petName", "breed", "ownerName"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener("input", function () {
      this.value = this.value.replace(/[^A-Za-z\s]/g, "");
    });
  });

  ["age", "weight", "contactNumber"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener("input", function () {
      this.value = this.value.replace(/[^0-9.]/g, "");
    });
  });

  const emailInput = document.getElementById("email");

  if (emailInput) {
    emailInput.addEventListener("blur", function () {
      if (this.value && !this.value.endsWith("@gmail.com")) {
        alert("Only @gmail.com emails are allowed.");
        this.value = "";
      }
    });
  }
}