document.addEventListener("DOMContentLoaded", function () {
  loadPatientRecords();
  renderPatientIdList();
  initializeAppointmentCalendar();
  initializeAppointmentEvents();
});

let patientRecords = [];
let selectedSlots = [];
let selectedPatient = null;
let currentCalendarDate = new Date();

/* NOTIFICATION */
function showNotification(message, type = "success") {
  const container = document.getElementById("notificationContainer");
  if (!container) return;

  const notif = document.createElement("div");
  notif.className = `notif ${type}`;
  notif.innerHTML = `
    <span>${message}</span>
  `;

  container.appendChild(notif);

  setTimeout(() => {
    notif.classList.add("show");
  }, 10);

  setTimeout(() => {
    notif.classList.remove("show");
    setTimeout(() => notif.remove(), 300);
  }, 3000);

  notif.querySelector(".notif-close")?.addEventListener("click", function () {
    notif.remove();
  });
}

/* TEMP DATA ONLY - no localStorage */
function loadPatientRecords() {
  patientRecords = [
    {
      id: 1,
      ownerName: "Sample Owner",
      contactNumber: "09123456789",
      email: "sample@gmail.com",
      petName: "Sample Pet",
      petSpecies: "Dog",
      breed: "Asp aspin",
      age: "2 Years",
      gender: "Male",
      weight: "10",
      appointmentArchived: false
    }
  ];
}

/* FORMATTERS */
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

/* SLOTS */
function getClinicTimeSlots() {
  const slots = [];
  let hour = 9;
  let minute = 0;

  while (hour < 17 || (hour === 17 && minute === 0)) {
    slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);

    minute += 30;

    if (minute === 60) {
      minute = 0;
      hour++;
    }
  }

  return slots;
}

function getServiceDurationSlots(serviceType) {
  switch (serviceType) {
    case "Grooming":
      return 3;
    case "Deworming":
      return 1;
    case "Vaccination":
      return 1;
    case "Surgery":
      return 0;
    default:
      return 1;
  }
}

function isAppointmentSlotTaken(appointmentDate, appointmentTime) {
  return patientRecords.some((record) => {
    if (record.appointmentDate !== appointmentDate) return false;

    const takenSlots = String(record.appointmentTime || "")
      .split(",")
      .map(time => time.trim())
      .filter(Boolean);

    return takenSlots.includes(appointmentTime);
  });
}

function canAutoSelectSlots(date, startIndex, neededSlots, clinicSlots) {
  for (let i = 0; i < neededSlots; i++) {
    const slot = clinicSlots[startIndex + i];

    if (!slot) return false;
    if (isAppointmentSlotTaken(date, slot)) return false;
  }

  return true;
}

/* PATIENT SELECT */
function renderPatientIdList() {
  const select = document.getElementById("patientSelect");
  if (!select) return;

  select.innerHTML = `<option value="">Select Patient ID</option>`;

  patientRecords.forEach((record) => {
    const option = document.createElement("option");
    option.value = record.id;
    option.textContent = `ID ${record.id}`;
    select.appendChild(option);
  });

  select.addEventListener("change", function () {
    const record = patientRecords.find(r => String(r.id) === String(select.value));

    if (!record) {
      selectedPatient = null;
      document.getElementById("selectedPatientInfo")?.classList.add("hidden");
      return;
    }

    selectPatient(record);
  });
}

function selectPatient(record) {
  selectedPatient = record;

  document.getElementById("selectedPatientId").value = record.id;
  document.getElementById("viewPatientId").textContent = record.id || "-";
  document.getElementById("viewPetName").textContent = record.petName || "-";
  document.getElementById("viewOwnerName").textContent = record.ownerName || "-";
  document.getElementById("viewPetSpecies").textContent = record.petSpecies || "-";
  document.getElementById("viewBreed").textContent = record.breed || "-";
  document.getElementById("viewContactNumber").textContent = record.contactNumber || "-";

  document.getElementById("selectedPatientInfo")?.classList.remove("hidden");
}

/* CALENDAR */
function initializeAppointmentCalendar() {
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();

  document.getElementById("prevCalendarMonth")?.addEventListener("click", function () {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderAppointmentCalendar();
  });

  document.getElementById("nextCalendarMonth")?.addEventListener("click", function () {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderAppointmentCalendar();
  });
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

  const totalSlots = getClinicTimeSlots().length;

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateKey = formatDateKey(date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    const takenSlots = getClinicTimeSlots().filter(slot =>
      isAppointmentSlotTaken(dateKey, slot)
    ).length;

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

      selectedSlots = [];
      selectedDateInput.value = dateKey;

      selectedDateText.textContent = date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      }).toUpperCase();

      document.getElementById("appointmentTime").value = "";

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
  const appointmentType = document.getElementById("appointmentType")?.value;

  if (!appointmentDateInput || !appointmentTimeInput || !appointmentTimeSlots) return;

  appointmentTimeSlots.innerHTML = "";

  if (!appointmentDateInput.value) {
    appointmentTimeSlots.innerHTML = `<p class="text-muted mb-0">Please select a date first.</p>`;
    return;
  }

  const clinicSlots = getClinicTimeSlots();
  const neededSlots = getServiceDurationSlots(appointmentType);

  clinicSlots.forEach((timeValue, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-slot-btn";
    button.textContent = formatSlotLabel(timeValue);

    const isTaken = isAppointmentSlotTaken(appointmentDateInput.value, timeValue);

    if (isTaken) {
      button.disabled = true;
      button.classList.add("booked");
    }

    if (selectedSlots.includes(timeValue)) {
      button.classList.add("active");
    }

    button.addEventListener("click", function () {
      if (isTaken) return;

      if (appointmentType === "Surgery") {
        if (selectedSlots.includes(timeValue)) {
          selectedSlots = selectedSlots.filter(slot => slot !== timeValue);
        } else {
          selectedSlots.push(timeValue);
        }

        appointmentTimeInput.value = selectedSlots.join(",");
        renderAppointmentTimeSlots();
        return;
      }

      if (!canAutoSelectSlots(appointmentDateInput.value, index, neededSlots, clinicSlots)) {
        showNotification("Not enough available slots.", "warning");
        selectedSlots = [];
        appointmentTimeInput.value = "";
        renderAppointmentTimeSlots();
        return;
      }

      selectedSlots = clinicSlots.slice(index, index + neededSlots);
      appointmentTimeInput.value = selectedSlots.join(",");

      renderAppointmentTimeSlots();
    });

    appointmentTimeSlots.appendChild(button);
  });
}

/* EVENTS */
function initializeAppointmentEvents() {
  const appointmentType = document.getElementById("appointmentType");
  const scheduleSection = document.getElementById("appointmentScheduleSection");
  const setAppointmentBtn = document.getElementById("setAppointmentBtn");

  appointmentType?.addEventListener("change", function () {
    selectedSlots = [];
    document.getElementById("appointmentTime").value = "";

    if (appointmentType.value) {
      scheduleSection.classList.remove("hidden");
    } else {
      scheduleSection.classList.add("hidden");
    }

    renderAppointmentTimeSlots();
  });

  setAppointmentBtn?.addEventListener("click", setAppointment);
}

function setAppointment() {
  if (!selectedPatient) {
    showNotification("Please select a patient ID first.", "error");
    return;
  }

  const appointmentType = document.getElementById("appointmentType").value;
  const appointmentDate = document.getElementById("appointmentDate").value;
  const appointmentTime = document.getElementById("appointmentTime").value;

  if (!appointmentType || !appointmentDate || !appointmentTime) {
    showNotification("Please select service, date, and time.", "error");
    return;
  }

  const index = patientRecords.findIndex(r => String(r.id) === String(selectedPatient.id));

  if (index === -1) {
    showNotification("Patient record not found.", "error");
    return;
  }

  patientRecords[index] = {
    ...patientRecords[index],
    appointmentDate,
    appointmentTime,
    appointmentType,
    appointmentStatus: "Waiting",
    appointmentArchived: false
  };

  showNotification("Appointment set successfully!", "success");

  selectedSlots = [];
  selectedPatient = null;

  document.getElementById("appointmentForm").reset();
  document.getElementById("selectedPatientInfo")?.classList.add("hidden");
  document.getElementById("appointmentScheduleSection")?.classList.add("hidden");

  renderPatientIdList();
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();
}