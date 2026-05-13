document.addEventListener("DOMContentLoaded", async function () {
  await syncPatientRecordsFromFirebaseToLocalStorage();

  loadPatientRecords();
  renderPatientIdList();
initializeAppointmentCalendar();
initializeAppointmentEvents();

setInterval(function () {
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();
}, 60000);
});

let patientRecords = [];
let archivedAppointments = [];
let selectedSlots = [];
let selectedPatient = null;
let currentCalendarDate = new Date();

/* ================= LOCAL STORAGE ================= */
const APPOINTMENT_STORAGE_KEYS = {
  patientRecords: "patientRecords",
  recentActivities: "recentActivities",
  archivedAppointments: "archivedAppointments"
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

function savePatientRecordsToLocalStorage() {
  patientRecords = sortPatientRecordsLifo(
    patientRecords.filter(function (record) {
      return !isPatientArchived(record);
    })
  );

  setLocalStorageArray(APPOINTMENT_STORAGE_KEYS.patientRecords, patientRecords);
}

function saveRecentActivityToLocalStorage(activity) {
  const recentActivities = getLocalStorageArray(
    APPOINTMENT_STORAGE_KEYS.recentActivities
  );

  recentActivities.unshift(activity);

  setLocalStorageArray(
    APPOINTMENT_STORAGE_KEYS.recentActivities,
    recentActivities
  );
}

/* ================= NOTIFICATION ================= */
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

    setTimeout(function () {
      notif.remove();
    }, 250);
  }, 2600);
}

/* ================= DATA ================= */
function loadPatientRecords() {
  const savedRecords = getLocalStorageArray(APPOINTMENT_STORAGE_KEYS.patientRecords);

  patientRecords = sortPatientRecordsLifo(
    savedRecords.filter(function (record) {
      return !isPatientArchived(record);
    })
  );

  archivedAppointments = getLocalStorageArray(
    APPOINTMENT_STORAGE_KEYS.archivedAppointments
  );
}

async function syncPatientRecordsFromFirebaseToLocalStorage() {
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
        appointmentCreatedAt: normalizeFirebaseDate(data.appointmentCreatedAt),
        appointmentUpdatedAt: normalizeFirebaseDate(data.appointmentUpdatedAt),
        appointmentLoggedAt: normalizeFirebaseDate(data.appointmentLoggedAt)
      };
    });

    const activeRecords = firebaseRecords.filter(function (record) {
      return !isPatientArchived(record);
    });

    setLocalStorageArray(
      APPOINTMENT_STORAGE_KEYS.patientRecords,
      sortPatientRecordsLifo(activeRecords)
    );

    const logsSnapshot = await window.db.collection("archivedAppointments").get();

    const firebaseLogs = logsSnapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt),
        archivedAt: normalizeFirebaseDate(data.archivedAt),
        appointmentArchivedAt: normalizeFirebaseDate(data.appointmentArchivedAt),
        loggedAt: normalizeFirebaseDate(data.loggedAt)
      };
    });

    setLocalStorageArray(
      APPOINTMENT_STORAGE_KEYS.archivedAppointments,
      firebaseLogs
    );

    console.log("Firebase appointment patients loaded:", activeRecords.length);
    console.log("Firebase appointment logs loaded:", firebaseLogs.length);
  } catch (error) {
    console.error("Firebase appointment patient load error:", error);
    showNotification("Failed to load Firebase patients.", "warning");
  }
}

function normalizeFirebaseDate(value) {
  if (!value) return "";

  if (value.toDate) {
    return value.toDate().toISOString();
  }

  return value;
}

async function updateAppointmentInFirebase(record) {
  if (!window.db) {
    throw new Error("Firestore is not initialized.");
  }

  const payload = {
    appointmentDate: record.appointmentDate,
    appointmentTime: record.appointmentTime,
    appointmentType: record.appointmentType,
    appointmentStatus: record.appointmentStatus,

    appointmentArchived: false,
    archived: false,
    isArchived: false,

    appointmentCreatedAt: record.appointmentCreatedAt || new Date().toISOString(),
    appointmentUpdatedAt: record.appointmentUpdatedAt || new Date().toISOString(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (record.firebaseDocId) {
    await window.db.collection("patientRecords").doc(record.firebaseDocId).update(payload);
    return;
  }

  const snapshot = await window.db
    .collection("patientRecords")
    .where("id", "==", String(record.id))
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new Error("Patient document not found in Firebase.");
  }

  await snapshot.docs[0].ref.update(payload);
}

async function saveAppointmentActivityToFirebase(activity) {
  if (!window.db) return;

  await window.db.collection("recentActivities").add({
    ...activity,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/* ================= FORMATTERS ================= */
function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatSlotLabel(timeValue) {
  if (!timeValue || !String(timeValue).includes(":")) return "-";

  let [hours, minutes] = String(timeValue).split(":");
  hours = parseInt(hours, 10);

  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;

  return `${displayHour}:${minutes} ${ampm}`;
}

function formatFullDate(dateValue) {
  if (!dateValue) return "-";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

/* ================= SERVICE / ROOM LOGIC ================= */
function normalizeServiceType(serviceType) {
  return String(serviceType || "").trim().toLowerCase();
}

function getServiceRoom(serviceType) {
  const service = normalizeServiceType(serviceType);

  if (service === "grooming") {
    return "grooming-room";
  }

  if (service === "surgery") {
    return "surgery-room";
  }

  /*
    Checkup room:
    - Checkup
    - Vaccination
    - Deworming

    Meaning:
    Vaccination and Deworming cannot overlap with Checkup
    because they share one checkup room.
  */
  if (
    service === "checkup" ||
    service === "check-up" ||
    service === "consultation" ||
    service === "vaccination" ||
    service === "deworming"
  ) {
    return "checkup-room";
  }

  return "checkup-room";
}

function getServiceDurationSlots(serviceType) {
  const service = normalizeServiceType(serviceType);

  /*
    1 slot = 30 minutes

    Grooming = 3 slots = 1 hr and 30 mins
    Checkup = 1 slot = 30 minutes
    Deworming = 1 slot = 30 minutes
    Vaccination = 1 slot = 30 minutes
    Surgery = 0 because manual / anytime selection
  */
  switch (service) {
    case "grooming":
      return 4;

    case "checkup":
    case "check-up":
    case "consultation":
      return 2;

    case "deworming":
      return 2;

    case "vaccination":
      return 2;

    case "surgery":
      return 0;

    default:
      return 1;
  }
}

/* ================= SLOTS ================= */
const APPOINTMENT_CLINIC_START_TIME = "09:00";
const APPOINTMENT_CLINIC_LAST_VISIBLE_TIME = "19:00"; // 7:00 PM cutoff display
const APPOINTMENT_LUNCH_START_TIME = "12:00";
const APPOINTMENT_LUNCH_END_TIME = "13:00"; // 1:00 PM pwede na ulit
const APPOINTMENT_CUTOFF_TIME = "19:00";

function appointmentTimeToMinutes(timeValue) {
  const [hour, minute] = String(timeValue).split(":").map(Number);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  return hour * 60 + minute;
}

function getAppointmentManilaNowInfo() {
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

function isAppointmentDateClosedByCutoff(dateKey) {
  const now = getAppointmentManilaNowInfo();
  const cutoffMinutes = appointmentTimeToMinutes(APPOINTMENT_CUTOFF_TIME);

  return String(dateKey) === String(now.dateKey) && now.minutes >= cutoffMinutes;
}

function isAppointmentLunchSlot(timeValue) {
  const slotMinutes = appointmentTimeToMinutes(timeValue);
  const lunchStart = appointmentTimeToMinutes(APPOINTMENT_LUNCH_START_TIME);
  const lunchEnd = appointmentTimeToMinutes(APPOINTMENT_LUNCH_END_TIME);

  if (slotMinutes === null) return false;

  return slotMinutes >= lunchStart && slotMinutes < lunchEnd;
}

function isAppointmentCutoffSlot(timeValue) {
  const slotMinutes = appointmentTimeToMinutes(timeValue);
  const cutoffMinutes = appointmentTimeToMinutes(APPOINTMENT_CUTOFF_TIME);

  if (slotMinutes === null) return false;

  return slotMinutes >= cutoffMinutes;
}

function isAppointmentBookableClinicSlot(timeValue) {
  return !isAppointmentLunchSlot(timeValue) && !isAppointmentCutoffSlot(timeValue);
}

function getClinicTimeSlots() {
  const slots = [];

  let currentMinutes = appointmentTimeToMinutes(APPOINTMENT_CLINIC_START_TIME);
  const lastVisibleMinutes = appointmentTimeToMinutes(APPOINTMENT_CLINIC_LAST_VISIBLE_TIME);

  while (currentMinutes <= lastVisibleMinutes) {
    const hour = Math.floor(currentMinutes / 60);
    const minute = currentMinutes % 60;

    slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);

    currentMinutes += 30;
  }

  return slots;
}

function getAppointmentSlots(record) {
  return String(record.appointmentTime || "")
    .split(",")
    .map(function (time) {
      return time.trim();
    })
    .filter(Boolean);
}

function getExpandedAppointmentSlots(record) {
  const savedSlots = getAppointmentSlots(record);

  if (savedSlots.length === 0) return [];

  const serviceType = record.appointmentType || "";
  const service = normalizeServiceType(serviceType);

  if (service === "surgery") {
    return savedSlots;
  }

  const neededSlots = getServiceDurationSlots(serviceType);

  if (neededSlots <= 1) {
    return savedSlots;
  }

  const clinicSlots = getClinicTimeSlots();
  const firstSavedSlot = savedSlots[0];
  const firstIndex = clinicSlots.indexOf(firstSavedSlot);

  if (firstIndex === -1) {
    return savedSlots;
  }

  /*
    Para sa old records:
    If dating grooming record only saved 1, 2, or 3 slots,
    automatic siyang i-expand based on current duration.
    Current grooming duration = 4 slots.
  */
  if (savedSlots.length < neededSlots) {
    return clinicSlots.slice(firstIndex, firstIndex + neededSlots);
  }

  return savedSlots;
}

function isAppointmentSlotTaken(
  appointmentDate,
  appointmentTime,
  serviceType,
  ignoredPatientId = ""
) {
  const selectedRoom = getServiceRoom(serviceType);

  return patientRecords.some(function (record) {
    if (isPatientArchived(record)) return false;
    if (String(record.id) === String(ignoredPatientId)) return false;
    if (String(record.appointmentDate || "") !== String(appointmentDate)) return false;

    const recordServiceType = record.appointmentType || "";
    const recordRoom = getServiceRoom(recordServiceType);

    /*
      Important:
      Iba-ibang room can use the same time.

      Example:
      Grooming 9:00 AM = allowed
      Surgery 9:00 AM = allowed
      Checkup 9:00 AM = allowed

      But:
      Grooming + Grooming same/overlap = not allowed
      Surgery + Surgery same/overlap = not allowed
      Checkup/Vaccination/Deworming overlap = not allowed
    */
    if (recordRoom !== selectedRoom) {
      return false;
    }

    const takenSlots = getExpandedAppointmentSlots(record);

    return takenSlots.includes(appointmentTime);
  });
}

function canAutoSelectSlots(
  date,
  startIndex,
  neededSlots,
  clinicSlots,
  serviceType,
  ignoredPatientId = ""
) {
  if (!neededSlots || neededSlots <= 0) return false;

  const startSlot = clinicSlots[startIndex];
  if (!startSlot) return false;

  const startMinutes = appointmentTimeToMinutes(startSlot);
  const cutoffMinutes = appointmentTimeToMinutes(APPOINTMENT_CUTOFF_TIME);

  if (startMinutes === null) return false;

  const appointmentEndMinutes = startMinutes + neededSlots * 30;

  if (appointmentEndMinutes > cutoffMinutes) {
    return false;
  }

  for (let i = 0; i < neededSlots; i++) {
    const slot = clinicSlots[startIndex + i];

    if (!slot) return false;
    if (!isAppointmentBookableClinicSlot(slot)) return false;

    if (
      isAppointmentSlotTaken(
        date,
        slot,
        serviceType,
        ignoredPatientId
      )
    ) {
      return false;
    }
  }

  return true;
}

function countTakenSlotsForService(date, serviceType, ignoredPatientId = "") {
  const clinicSlots = getClinicTimeSlots().filter(isAppointmentBookableClinicSlot);

  return clinicSlots.filter(function (slot) {
    return isAppointmentSlotTaken(
      date,
      slot,
      serviceType,
      ignoredPatientId
    );
  }).length;
}

function hasAnyAvailableStartSlot(date, serviceType, ignoredPatientId = "") {
  const clinicSlots = getClinicTimeSlots();
  const service = normalizeServiceType(serviceType);

  if (!serviceType) return true;

  if (service === "surgery") {
    return clinicSlots.some(function (slot) {
      return (
        isAppointmentBookableClinicSlot(slot) &&
        !isAppointmentSlotTaken(date, slot, serviceType, ignoredPatientId)
      );
    });
  }

  const neededSlots = getServiceDurationSlots(serviceType);

  return clinicSlots.some(function (slot, index) {
    return canAutoSelectSlots(
      date,
      index,
      neededSlots,
      clinicSlots,
      serviceType,
      ignoredPatientId
    );
  });
}

/* ================= PATIENT SELECT ================= */
function isPatientAlreadyInAppointmentLogs(record) {
  const patientId = String(record?.id || record?.patientId || "").trim();

  if (!patientId) return false;

  return archivedAppointments.some(function (log) {
    const logPatientId = String(log?.id || log?.patientId || "").trim();

    return logPatientId === patientId;
  });
}

function hasExistingAppointment(record) {
  const appointmentDate = String(record?.appointmentDate || "").trim();
  const appointmentTime = String(record?.appointmentTime || "").trim();
  const appointmentType = String(record?.appointmentType || "").trim();

  const lastAppointmentDate = String(record?.lastAppointmentDate || "").trim();
  const lastAppointmentTime = String(record?.lastAppointmentTime || "").trim();
  const lastAppointmentType = String(record?.lastAppointmentType || "").trim();

  const status = String(record?.appointmentStatus || record?.status || "")
    .trim()
    .toLowerCase();

  const hasCurrentAppointment = Boolean(
    appointmentDate ||
    appointmentTime ||
    appointmentType
  );

  const hasLoggedAppointment = Boolean(
    record?.appointmentLogged === true ||
    record?.appointmentLoggedAt ||
    lastAppointmentDate ||
    lastAppointmentTime ||
    lastAppointmentType ||
    isPatientAlreadyInAppointmentLogs(record)
  );

  const reusableStatuses = [
    "cancelled",
    "canceled",
    "cleared",
    "deleted",
    "no appointment"
  ];

  if (reusableStatuses.includes(status) && !hasLoggedAppointment) {
    return false;
  }

  return hasCurrentAppointment || hasLoggedAppointment;
}

function renderPatientIdList() {
  const select = document.getElementById("patientSelect");
  if (!select) return;

  loadPatientRecords();

  select.innerHTML = `<option value="">Select Patient ID</option>`;

  const availablePatients = patientRecords.filter(function (record) {
    return !isPatientArchived(record) && !hasExistingAppointment(record);
  });

  if (availablePatients.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No available patients";
    option.disabled = true;
    select.appendChild(option);
  }

  availablePatients.forEach(function (record) {
    const option = document.createElement("option");
    option.value = record.id;
    option.textContent = `ID ${record.id} - ${record.petName || "Patient"}`;

    select.appendChild(option);
  });

  select.onchange = function () {
    const record = patientRecords.find(function (item) {
      return String(item.id) === String(select.value);
    });

    if (!record) {
      selectedPatient = null;
      document.getElementById("selectedPatientInfo")?.classList.add("hidden");
      return;
    }

    selectPatient(record);
  };
}

function selectPatient(record) {
  selectedPatient = record;

  const selectedPatientId = document.getElementById("selectedPatientId");
  const viewPatientId = document.getElementById("viewPatientId");
  const viewPetName = document.getElementById("viewPetName");
  const viewOwnerName = document.getElementById("viewOwnerName");
  const viewPetSpecies = document.getElementById("viewPetSpecies");
  const viewBreed = document.getElementById("viewBreed");
  const viewContactNumber = document.getElementById("viewContactNumber");

  if (selectedPatientId) selectedPatientId.value = record.id || "";
  if (viewPatientId) viewPatientId.textContent = record.id || "-";
  if (viewPetName) viewPetName.textContent = record.petName || "-";
  if (viewOwnerName) viewOwnerName.textContent = record.ownerName || "-";
  if (viewPetSpecies) viewPetSpecies.textContent = record.petSpecies || "-";
  if (viewBreed) viewBreed.textContent = record.breed || "-";
  if (viewContactNumber) viewContactNumber.textContent = record.contactNumber || "-";

  document.getElementById("selectedPatientInfo")?.classList.remove("hidden");

  selectedSlots = [];

  const appointmentTime = document.getElementById("appointmentTime");
  if (appointmentTime) {
    appointmentTime.value = "";
  }

  renderAppointmentTimeSlots();
}

/* ================= CALENDAR ================= */
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
  const appointmentType = document.getElementById("appointmentType")?.value || "";

  if (!monthLabel || !daysContainer) return;

  loadPatientRecords();

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

const totalSlots = getClinicTimeSlots().filter(isAppointmentBookableClinicSlot).length;

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateKey = formatDateKey(date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    const ignoredPatientId = selectedPatient ? selectedPatient.id : "";

    const takenSlots = appointmentType
      ? countTakenSlotsForService(dateKey, appointmentType, ignoredPatientId)
      : 0;

const isPastDate = date < today;
const isTodayClosedByCutoff = isAppointmentDateClosedByCutoff(dateKey);

const isFullSlots = appointmentType
  ? !hasAnyAvailableStartSlot(dateKey, appointmentType, ignoredPatientId)
  : false;

if (isPastDate || isTodayClosedByCutoff) {
  button.classList.add("disabled");
  button.disabled = true;
  button.innerHTML = `
    <strong>${day}</strong>
    <small>${isPastDate ? "Past Date" : "Cutoff"}</small>
  `;
  daysContainer.appendChild(button);
  continue;
}

    if (isFullSlots) {
      button.classList.add("red");
    } else if (appointmentType && totalSlots - takenSlots <= 5) {
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

      if (selectedDateInput) {
        selectedDateInput.value = dateKey;
      }

      if (selectedDateText) {
        selectedDateText.textContent = formatFullDate(dateKey).toUpperCase();
      }

      const appointmentTime = document.getElementById("appointmentTime");
      if (appointmentTime) {
        appointmentTime.value = "";
      }

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

  if (!appointmentType) {
    appointmentTimeSlots.innerHTML = `<p class="text-muted mb-0">Please select a service first.</p>`;
    return;
  }

  if (!appointmentDateInput.value) {
    appointmentTimeSlots.innerHTML = `<p class="text-muted mb-0">Please select a date first.</p>`;
    return;
  }

  if (isAppointmentDateClosedByCutoff(appointmentDateInput.value)) {
  selectedSlots = [];
  appointmentTimeInput.value = "";
  appointmentTimeSlots.innerHTML = `<p class="text-muted mb-0">Today is no longer available after 7:00 PM.</p>`;
  return;
}

  const clinicSlots = getClinicTimeSlots();
  const neededSlots = getServiceDurationSlots(appointmentType);
  const service = normalizeServiceType(appointmentType);
  const ignoredPatientId = selectedPatient ? selectedPatient.id : "";

  clinicSlots.forEach(function (timeValue, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-slot-btn";

    const isLunchSlot = isAppointmentLunchSlot(timeValue);
    const isCutoffSlot = isAppointmentCutoffSlot(timeValue);

    const isTaken = isAppointmentSlotTaken(
      appointmentDateInput.value,
      timeValue,
      appointmentType,
      ignoredPatientId
    );

    const hasEnoughSlots =
      service === "surgery"
        ? !isTaken && isAppointmentBookableClinicSlot(timeValue)
        : canAutoSelectSlots(
            appointmentDateInput.value,
            index,
            neededSlots,
            clinicSlots,
            appointmentType,
            ignoredPatientId
          );

    const isSelectedSlot = selectedSlots.includes(timeValue);

    if (isLunchSlot) {
      button.classList.add("lunch-break");
      button.disabled = true;
      button.innerHTML = `${formatSlotLabel(timeValue)}<small>Lunch Break</small>`;
      button.title = "Lunch break: 12:00 PM to 1:00 PM";
    } else if (isCutoffSlot) {
      button.classList.add("cutoff-break");
      button.disabled = true;
      button.innerHTML = `${formatSlotLabel(timeValue)}<small>Cutoff</small>`;
      button.title = "Clinic cutoff time";
    } else {
      button.textContent = formatSlotLabel(timeValue);
    }

    if (isSelectedSlot && !isLunchSlot && !isCutoffSlot) {
      button.classList.add("active");
      button.disabled = false;
    } else if (!isLunchSlot && !isCutoffSlot && (isTaken || !hasEnoughSlots)) {
      button.disabled = true;
      button.classList.add("booked");
    }

    button.addEventListener("click", function () {
      if (button.disabled) return;

      if (!isAppointmentBookableClinicSlot(timeValue)) {
        return;
      }

      /*
        Surgery = anytime/manual.
        User can select any available slot/s.
      */
      if (service === "surgery") {
        if (selectedSlots.includes(timeValue)) {
          selectedSlots = selectedSlots.filter(function (slot) {
            return slot !== timeValue;
          });
        } else {
          selectedSlots.push(timeValue);
        }

        appointmentTimeInput.value = selectedSlots.join(",");
        renderAppointmentTimeSlots();
        return;
      }

      /*
        Automatic multi-slot selection for services.
        Example:
        9:00 AM selected with 4 slots =
        9:00, 9:30, 10:00, 10:30
      */
      if (
        !canAutoSelectSlots(
          appointmentDateInput.value,
          index,
          neededSlots,
          clinicSlots,
          appointmentType,
          ignoredPatientId
        )
      ) {
        showNotification(
          "This schedule is not available because it overlaps with lunch break, booked slots, or clinic cutoff.",
          "warning"
        );

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

/* ================= EVENTS ================= */
function initializeAppointmentEvents() {
  const appointmentType = document.getElementById("appointmentType");
  const scheduleSection = document.getElementById("appointmentScheduleSection");
  const setAppointmentBtn = document.getElementById("setAppointmentBtn");

  appointmentType?.addEventListener("change", function () {
    selectedSlots = [];

    const appointmentTime = document.getElementById("appointmentTime");
    const appointmentDate = document.getElementById("appointmentDate");

    if (appointmentTime) {
      appointmentTime.value = "";
    }

    if (appointmentDate) {
      appointmentDate.value = "";
    }

    const appointmentSelectedDateText = document.getElementById(
      "appointmentSelectedDateText"
    );

    if (appointmentSelectedDateText) {
      appointmentSelectedDateText.textContent = "Select a date to view slots";
    }

    if (appointmentType.value) {
      scheduleSection?.classList.remove("hidden");
    } else {
      scheduleSection?.classList.add("hidden");
    }

    renderAppointmentCalendar();
    renderAppointmentTimeSlots();
  });

  setAppointmentBtn?.addEventListener("click", setAppointment);
}

/* ================= SET APPOINTMENT ================= */
async function setAppointment() {
  loadPatientRecords();

  if (!selectedPatient) {
    showNotification("Please select a patient ID first.", "error");
    return;
  }

  const appointmentType = document.getElementById("appointmentType")?.value || "";
  const appointmentDate = document.getElementById("appointmentDate")?.value || "";
  const appointmentTime = document.getElementById("appointmentTime")?.value || "";

  if (!appointmentType || !appointmentDate || !appointmentTime) {
    showNotification("Please select service, date, and time.", "error");
    return;
  }

  if (isAppointmentDateClosedByCutoff(appointmentDate)) {
  showNotification("Today is no longer available because the 7:00 PM cutoff has passed.", "error");
  selectedSlots = [];
  document.getElementById("appointmentTime").value = "";
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();
  return;
}

  const selectedTimes = String(appointmentTime)
    .split(",")
    .map(function (time) {
      return time.trim();
    })
    .filter(Boolean);
    
    const hasUnavailableTime = selectedTimes.some(function (time) {
  return !isAppointmentBookableClinicSlot(time);
});

if (hasUnavailableTime) {
  showNotification("Selected time cannot include lunch break or clinic cutoff.", "error");
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();
  return;
}

  const hasConflict = selectedTimes.some(function (time) {
    return isAppointmentSlotTaken(
      appointmentDate,
      time,
      appointmentType,
      selectedPatient.id
    );
  });

  if (hasConflict) {
    showNotification("Selected time slot is already taken for this service room.", "error");
    renderAppointmentCalendar();
    renderAppointmentTimeSlots();
    return;
  }

  const service = normalizeServiceType(appointmentType);

  if (service !== "surgery") {
    const clinicSlots = getClinicTimeSlots();
    const neededSlots = getServiceDurationSlots(appointmentType);
    const firstSelectedSlot = selectedTimes[0];
    const startIndex = clinicSlots.indexOf(firstSelectedSlot);

    if (
      startIndex === -1 ||
      selectedTimes.length !== neededSlots ||
      !canAutoSelectSlots(
        appointmentDate,
        startIndex,
        neededSlots,
        clinicSlots,
        appointmentType,
        selectedPatient.id
      )
    ) {
      showNotification("Invalid appointment duration for selected service.", "error");
      renderAppointmentCalendar();
      renderAppointmentTimeSlots();
      return;
    }
  }

  const index = patientRecords.findIndex(function (record) {
    return String(record.id) === String(selectedPatient.id);
  });

  if (index === -1) {
    showNotification("Patient record not found.", "error");
    return;
  }

  const now = new Date();

  const updatedRecord = {
    ...patientRecords[index],

    appointmentDate,
    appointmentTime,
    appointmentType,
    appointmentStatus: "Waiting",

    appointmentArchived: false,
    archived: false,
    isArchived: false,

    appointmentCreatedAt: patientRecords[index].appointmentCreatedAt || now.toISOString(),
    appointmentUpdatedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Appointment",
    action: "Set Appointment",
    details: `${updatedRecord.petName || "Patient"} appointment set for ${formatFullDate(appointmentDate)}`
  };

  try {
    await updateAppointmentInFirebase(updatedRecord);
    await saveAppointmentActivityToFirebase(activity);

    patientRecords[index] = updatedRecord;

    savePatientRecordsToLocalStorage();
    saveRecentActivityToLocalStorage(activity);

    showNotification("Appointment set successfully!", "success");

    resetAppointmentForm();
  } catch (error) {
    console.error("Firebase appointment save error:", error);
    showNotification("Failed to save appointment to Firebase.", "error");
  }
}

/* ================= RESET ================= */
function resetAppointmentForm() {
  selectedSlots = [];
  selectedPatient = null;

  document.getElementById("appointmentForm")?.reset();
  document.getElementById("selectedPatientInfo")?.classList.add("hidden");
  document.getElementById("appointmentScheduleSection")?.classList.add("hidden");

  const appointmentSelectedDateText = document.getElementById(
    "appointmentSelectedDateText"
  );

  if (appointmentSelectedDateText) {
    appointmentSelectedDateText.textContent = "Select a date to view slots";
  }

  const appointmentDate = document.getElementById("appointmentDate");
  const appointmentTime = document.getElementById("appointmentTime");

  if (appointmentDate) {
    appointmentDate.value = "";
  }

  if (appointmentTime) {
    appointmentTime.value = "";
  }

  loadPatientRecords();
  renderPatientIdList();
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();
}

/* ================= SYNC ADMIN / STAFF ================= */
window.addEventListener("storage", function (event) {
  if (event.key !== APPOINTMENT_STORAGE_KEYS.patientRecords) return;

  loadPatientRecords();
  renderPatientIdList();
  renderAppointmentCalendar();
  renderAppointmentTimeSlots();
});

/* ================= HELPERS ================= */
function isPatientArchived(record) {
  return (
    record?.appointmentArchived === true ||
    record?.archived === true ||
    record?.isArchived === true ||
    String(record?.status || "").toLowerCase() === "archived"
  );
}

function sortPatientRecordsLifo(records) {
  return [...records].sort(function (a, b) {
    return getPatientRecordSortTime(b) - getPatientRecordSortTime(a);
  });
}

function getPatientRecordSortTime(record) {
  const rawDate =
    record.appointmentUpdatedAt ||
    record.retrievedAt ||
    record.createdAt ||
    record.registeredAt ||
    record.dateCreated ||
    "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  return Number(record.id) || 0;
}