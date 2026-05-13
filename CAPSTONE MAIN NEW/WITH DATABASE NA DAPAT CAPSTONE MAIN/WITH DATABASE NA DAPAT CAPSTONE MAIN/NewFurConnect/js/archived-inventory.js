document.addEventListener("DOMContentLoaded", async function () {
  await initializeArchivedInventory();
});

/* =========================================================
   ARCHIVED INVENTORY
   FIREBASE + LOCALSTORAGE FALLBACK
   ROW CLICK SELECT ENABLED
========================================================= */

let archivedInventoryRecords = [];
let selectedArchivedInventoryIds = [];
let selectAllArchivedInventoryActive = false;

/* =========================================================
   LOCAL STORAGE
========================================================= */

const ARCHIVED_INVENTORY_STORAGE_KEYS = {
  inventoryRecords: "inventoryRecords",
  archivedInventoryRecords: "archivedInventoryRecords",
  lowStockItems: "lowStockItems",
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

function saveArchivedInventoryRecentActivity(activity) {
  const recentActivities = getLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.recentActivities
  );

  recentActivities.unshift(activity);

  setLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.recentActivities,
    recentActivities
  );
}

/* =========================================================
   FIREBASE
========================================================= */

async function syncArchivedInventoryFromFirebaseToLocalStorage() {
  if (!window.db) {
    console.warn("Firestore is not ready. Using localStorage only.");
    return;
  }

  try {
    const snapshot = await window.db.collection("inventoryRecords").get();

    const firebaseInventoryRecords = snapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt),
        updatedAt: normalizeFirebaseDate(data.updatedAt),
        archivedAt: normalizeFirebaseDate(data.archivedAt),
        archivedDate: normalizeFirebaseDate(data.archivedDate),
        dateArchived: normalizeFirebaseDate(data.dateArchived),
        retrievedAt: normalizeFirebaseDate(data.retrievedAt)
      };
    });

    const activeRecords = firebaseInventoryRecords.filter(function (item) {
      return !isArchivedInventoryItem(item);
    });

    const archivedRecords = firebaseInventoryRecords.filter(function (item) {
      return isArchivedInventoryItem(item);
    });

    setLocalStorageArray(
      ARCHIVED_INVENTORY_STORAGE_KEYS.inventoryRecords,
      activeRecords
    );

    setLocalStorageArray(
      ARCHIVED_INVENTORY_STORAGE_KEYS.archivedInventoryRecords,
      archivedRecords
    );

    syncArchivedInventoryLowStockItems();

    console.log("Firebase archived inventory loaded:", archivedRecords.length);
  } catch (error) {
    console.error("Firebase archived inventory load error:", error);
    showArchivedInventoryNotification("Failed to load archived inventory from Firebase.", "error");
  }
}

function normalizeFirebaseDate(value) {
  if (!value) return "";

  if (value.toDate) {
    return value.toDate().toISOString();
  }

  return value;
}

async function getArchivedInventoryFirebaseDocRef(itemOrId) {
  if (!window.db) {
    throw new Error("Firestore is not initialized.");
  }

  const firebaseDocId =
    typeof itemOrId === "object"
      ? itemOrId.firebaseDocId || itemOrId.originalRecord?.firebaseDocId
      : "";

  const itemId =
    typeof itemOrId === "object"
      ? itemOrId.id || itemOrId.originalRecord?.id
      : itemOrId;

  if (firebaseDocId) {
    return window.db.collection("inventoryRecords").doc(firebaseDocId);
  }

  const numberSnapshot = await window.db
    .collection("inventoryRecords")
    .where("id", "==", Number(itemId))
    .limit(1)
    .get();

  if (!numberSnapshot.empty) {
    return numberSnapshot.docs[0].ref;
  }

  const stringSnapshot = await window.db
    .collection("inventoryRecords")
    .where("id", "==", String(itemId))
    .limit(1)
    .get();

  if (stringSnapshot.empty) {
    throw new Error("Inventory document not found in Firebase.");
  }

  return stringSnapshot.docs[0].ref;
}

async function updateArchivedInventoryItemInFirebase(itemOrId, updates) {
  const docRef = await getArchivedInventoryFirebaseDocRef(itemOrId);

  await docRef.update({
    ...updates,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function saveArchivedInventoryRecentActivityToFirebase(activity) {
  if (!window.db) return;

  await window.db.collection("recentActivities").add({
    ...activity,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function syncArchivedInventoryLowStockItemsToFirebase() {
  if (!window.db) return;

  const lowStockItems = getLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.lowStockItems
  );

  const snapshot = await window.db.collection("lowStockItems").get();
  const batch = window.db.batch();

  snapshot.docs.forEach(function (doc) {
    batch.delete(doc.ref);
  });

  lowStockItems.forEach(function (item) {
    const ref = window.db.collection("lowStockItems").doc(String(item.id));

    batch.set(ref, {
      ...item,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
}

/* =========================================================
   LOW STOCK
========================================================= */

function syncArchivedInventoryLowStockItems() {
  const inventoryRecords = getLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.inventoryRecords
  );

  const lowStockItems = inventoryRecords
    .filter(function (item) {
      const quantity = Number(item.quantity ?? item.stock ?? item.qty ?? 0) || 0;

      return !isArchivedInventoryItem(item) && quantity <= 5;
    })
    .map(function (item) {
      const quantity = Number(item.quantity ?? item.stock ?? item.qty ?? 0) || 0;

      return {
        id: item.id,
        itemName: item.itemName || item.name || item.productName || "Unnamed Item",
        itemDescription: item.itemDescription || "",
        category: item.category || item.itemCategory || "Uncategorized",
        quantity,
        unit: item.unit || "",
        expirationDate: item.expirationDate || item.expiration || item.expiryDate || "",
        status: getInventoryStatus(quantity)
      };
    });

  setLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.lowStockItems,
    lowStockItems
  );
}

/* =========================================================
   INITIALIZE
========================================================= */

async function initializeArchivedInventory() {
  const archivedInventoryPage = document.getElementById("archivedInventoryPage");
  if (!archivedInventoryPage) return;

  await syncArchivedInventoryFromFirebaseToLocalStorage();

  loadArchivedInventoryRecords();
  renderArchivedInventory();
  initializeArchivedInventoryEvents();
}

/* =========================================================
   LOAD DATA
========================================================= */

function loadArchivedInventoryRecords() {
  const savedArchivedInventory = getLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.archivedInventoryRecords
  );

  const inventoryRecords = getLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.inventoryRecords
  );

  const archivedFromInventoryRecords = inventoryRecords
    .filter(function (item) {
      return isArchivedInventoryItem(item);
    })
    .map(function (item, index) {
      return normalizeArchivedInventoryItem(item, index);
    });

  const directArchivedInventory = savedArchivedInventory.map(function (item, index) {
    return normalizeArchivedInventoryItem(item, index);
  });

  const combinedRecords = [
    ...directArchivedInventory,
    ...archivedFromInventoryRecords
  ];

  const uniqueRecords = [];
  const usedIds = new Set();

  combinedRecords.forEach(function (item) {
    const itemId = String(item.id);

    if (!usedIds.has(itemId)) {
      usedIds.add(itemId);
      uniqueRecords.push(item);
    }
  });

  archivedInventoryRecords = uniqueRecords.sort(function (a, b) {
    const dateA = new Date(a.archivedDate).getTime();
    const dateB = new Date(b.archivedDate).getTime();

    const safeDateA = Number.isNaN(dateA) ? 0 : dateA;
    const safeDateB = Number.isNaN(dateB) ? 0 : dateB;

    return safeDateB - safeDateA;
  });
}

function normalizeArchivedInventoryItem(item, index) {
  const id =
    item.id ||
    item.itemId ||
    item.inventoryId ||
    item.code ||
    `ARCH-${index + 1}`;

  const itemName =
    item.itemName ||
    item.name ||
    item.productName ||
    item.item ||
    "Unnamed Item";

  const category =
    item.category ||
    item.itemCategory ||
    "Uncategorized";

  const quantity =
    Number(item.quantity ?? item.stock ?? item.qty ?? item.itemQuantity ?? 0) || 0;

  const unit =
    item.unit ||
    item.itemUnit ||
    "";

  const itemDescription =
    item.itemDescription ||
    item.description ||
    "";

  const expiration =
    item.expiration ||
    item.expirationDate ||
    item.expiryDate ||
    "-";

  const archivedDate =
    item.archivedDate ||
    item.dateArchived ||
    item.archivedAt ||
    item.updatedAt ||
    item.createdAt ||
    "-";

  return {
    id: String(id),
    itemName: String(itemName),
    itemDescription: String(itemDescription),
    category: String(category),
    quantity,
    unit: String(unit),
    expiration: String(expiration),
    expirationDate: item.expirationDate || item.expiration || item.expiryDate || "",
    archivedDate: String(archivedDate),
    originalRecord: {
      ...item
    }
  };
}

function saveArchivedInventoryRecords() {
  setLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.archivedInventoryRecords,
    archivedInventoryRecords.map(function (item) {
      return item.originalRecord || item;
    })
  );
}

/* =========================================================
   RENDER
========================================================= */

function renderArchivedInventory() {
  loadArchivedInventoryRecords();

  const filteredRecords = getFilteredArchivedInventoryRecords();

  renderArchivedInventoryTable(filteredRecords);
  renderArchivedInventoryCount(filteredRecords);
  syncSelectAllArchivedInventory(filteredRecords);
}

function renderArchivedInventoryTable(records) {
  const tableBody = document.getElementById("archivedInventoryTableBody");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (records.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4">
          No archived inventory records
        </td>
      </tr>
    `;
    return;
  }

  records.forEach(function (item) {
    const row = document.createElement("tr");
    const isChecked = selectedArchivedInventoryIds.includes(item.id);

    if (isChecked) {
      row.classList.add("selected-record");
    }

    row.innerHTML = `
      <td class="checkbox-col">
        <input
          type="checkbox"
          class="archived-inventory-checkbox"
          data-id="${escapeArchivedInventoryHtml(item.id)}"
          ${isChecked ? "checked" : ""}
        >
      </td>
      <td>${escapeArchivedInventoryHtml(item.id)}</td>
      <td>${escapeArchivedInventoryHtml(item.itemName)}</td>
      <td>${escapeArchivedInventoryHtml(item.category)}</td>
      <td>${escapeArchivedInventoryHtml(item.quantity)} ${escapeArchivedInventoryHtml(item.unit)}</td>
      <td>${escapeArchivedInventoryHtml(formatArchivedInventoryExpiration(item.expiration))}</td>
      <td>${escapeArchivedInventoryHtml(formatArchivedInventoryDate(item.archivedDate))}</td>
    `;

    tableBody.appendChild(row);
  });
}

function renderArchivedInventoryCount(records) {
  const countText = document.getElementById("archivedInventoryCountText");
  if (!countText) return;

  const count = records.length;

  if (count === 0) {
    countText.textContent = "No records";
    return;
  }

  countText.textContent =
    count === 1
      ? "Showing 1 archived inventory record"
      : `Showing ${count} archived inventory records`;
}

/* =========================================================
   FILTER
========================================================= */

function getFilteredArchivedInventoryRecords() {
  const searchValue =
    document.getElementById("archivedInventorySearch")?.value.toLowerCase().trim() || "";

  return archivedInventoryRecords.filter(function (item) {
    const searchableText = [
      item.id,
      item.itemName,
      item.category,
      item.quantity,
      item.unit,
      item.expiration,
      item.archivedDate
    ]
      .join(" ")
      .toLowerCase();

    return searchValue === "" || searchableText.includes(searchValue);
  });
}

/* =========================================================
   EVENTS
========================================================= */

function initializeArchivedInventoryEvents() {
  const searchInput = document.getElementById("archivedInventorySearch");
  const selectAllCheckbox = document.getElementById("selectAllArchivedInventory");
  const retrieveBtn = document.getElementById("retrieveInventoryBtn");
  const tableBody = document.getElementById("archivedInventoryTableBody");

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      selectAllArchivedInventoryActive = false;
      renderArchivedInventory();
    });
  }

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", function () {
      handleSelectAllArchivedInventory();
    });
  }

  if (tableBody) {
    tableBody.addEventListener("click", function (event) {
      const checkboxClicked = event.target.closest(".archived-inventory-checkbox");

      if (checkboxClicked) {
        return;
      }

      const row = event.target.closest("tr");
      if (!row) return;

      const checkbox = row.querySelector(".archived-inventory-checkbox");
      if (!checkbox) return;

      checkbox.checked = !checkbox.checked;
      handleArchivedInventorySelection(checkbox, false);
    });

    tableBody.addEventListener("change", function (event) {
      const checkbox = event.target.closest(".archived-inventory-checkbox");
      if (!checkbox) return;

      handleArchivedInventorySelection(checkbox, false);
    });
  }

  if (retrieveBtn) {
    retrieveBtn.addEventListener("click", function () {
      retrieveSelectedArchivedInventory();
    });
  }
}

/* =========================================================
   SELECTION
========================================================= */

function handleArchivedInventorySelection(checkbox, fromSelectAll) {
  const itemId = checkbox.dataset.id;
  if (!itemId) return;

  if (!fromSelectAll) {
    selectAllArchivedInventoryActive = false;
  }

  if (checkbox.checked) {
    if (!selectedArchivedInventoryIds.includes(itemId)) {
      selectedArchivedInventoryIds.push(itemId);
    }
  } else {
    selectedArchivedInventoryIds = selectedArchivedInventoryIds.filter(function (id) {
      return id !== itemId;
    });
  }

  updateArchivedInventoryRowState(checkbox);
  syncSelectAllArchivedInventory(getFilteredArchivedInventoryRecords());
}

function updateArchivedInventoryRowState(checkbox) {
  const row = checkbox.closest("tr");
  if (!row) return;

  if (checkbox.checked) {
    row.classList.add("selected-record");
  } else {
    row.classList.remove("selected-record");
  }
}

function handleSelectAllArchivedInventory() {
  const selectAllCheckbox = document.getElementById("selectAllArchivedInventory");
  if (!selectAllCheckbox) return;

  const filteredRecords = getFilteredArchivedInventoryRecords();

  selectAllArchivedInventoryActive = selectAllCheckbox.checked;

  if (selectAllCheckbox.checked) {
    filteredRecords.forEach(function (item) {
      if (!selectedArchivedInventoryIds.includes(item.id)) {
        selectedArchivedInventoryIds.push(item.id);
      }
    });
  } else {
    const filteredIds = filteredRecords.map(function (item) {
      return item.id;
    });

    selectedArchivedInventoryIds = selectedArchivedInventoryIds.filter(function (id) {
      return !filteredIds.includes(id);
    });
  }

  renderArchivedInventoryTable(filteredRecords);
  syncSelectAllArchivedInventory(filteredRecords);
}

function syncSelectAllArchivedInventory(records) {
  const selectAllCheckbox = document.getElementById("selectAllArchivedInventory");
  if (!selectAllCheckbox) return;

  if (records.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    selectAllCheckbox.disabled = true;
    return;
  }

  selectAllCheckbox.disabled = false;

  const recordIds = records.map(function (item) {
    return item.id;
  });

  const selectedCount = recordIds.filter(function (id) {
    return selectedArchivedInventoryIds.includes(id);
  }).length;

  selectAllCheckbox.checked = selectedCount === records.length;
  selectAllCheckbox.indeterminate =
    selectedCount > 0 && selectedCount < records.length;
}

/* =========================================================
   RETRIEVE
========================================================= */

async function retrieveSelectedArchivedInventory() {
  if (selectedArchivedInventoryIds.length === 0) {
    showArchivedInventoryNotification("Please select an archived item to retrieve.", "error");
    return;
  }

  const inventoryRecords = getLocalStorageArray(
    ARCHIVED_INVENTORY_STORAGE_KEYS.inventoryRecords
  );

  const selectedItems = archivedInventoryRecords.filter(function (item) {
    return selectedArchivedInventoryIds.includes(item.id);
  });

  if (selectedItems.length === 0) {
    showArchivedInventoryNotification("Selected archived item not found.", "error");
    return;
  }

  const selectedCount = selectedItems.length;
  const restoredItems = selectedItems.map(createRestoredInventoryItem);

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Archived Inventory",
    action: "Retrieved Inventory",
    details: `${selectedCount} archived inventory item(s) retrieved`
  };

  try {
    for (let i = 0; i < selectedItems.length; i++) {
      const archivedItem = selectedItems[i];
      const restoredItem = restoredItems[i];

      await updateArchivedInventoryItemInFirebase(archivedItem, {
        itemName: restoredItem.itemName,
        itemDescription: restoredItem.itemDescription,
        category: restoredItem.category,
        quantity: restoredItem.quantity,
        stock: restoredItem.stock,
        qty: restoredItem.qty,
        itemQuantity: restoredItem.itemQuantity,
        unit: restoredItem.unit,
        expirationDate: restoredItem.expirationDate,

        archived: false,
        isArchived: false,
        inventoryArchived: false,
        archivedDate: "",
        dateArchived: "",
        archivedAt: "",

        status: restoredItem.status,
        retrievedAt: restoredItem.retrievedAt
      });
    }

    await saveArchivedInventoryRecentActivityToFirebase(activity);

    restoredItems.forEach(function (restoredItem) {
      const existingIndex = inventoryRecords.findIndex(function (item) {
        return String(item.id) === String(restoredItem.id);
      });

      if (existingIndex !== -1) {
        inventoryRecords[existingIndex] = {
          ...inventoryRecords[existingIndex],
          ...restoredItem
        };
      } else {
        inventoryRecords.push(restoredItem);
      }
    });

    archivedInventoryRecords = archivedInventoryRecords.filter(function (item) {
      return !selectedArchivedInventoryIds.includes(item.id);
    });

    selectedArchivedInventoryIds = [];
    selectAllArchivedInventoryActive = false;

    setLocalStorageArray(
      ARCHIVED_INVENTORY_STORAGE_KEYS.inventoryRecords,
      inventoryRecords
    );

    saveArchivedInventoryRecords();
    syncArchivedInventoryLowStockItems();
    await syncArchivedInventoryLowStockItemsToFirebase();

    saveArchivedInventoryRecentActivity(activity);

    await syncArchivedInventoryFromFirebaseToLocalStorage();

    renderArchivedInventory();

    showArchivedInventoryNotification("Selected archived inventory retrieved.", "success");
  } catch (error) {
    console.error("Firebase retrieve archived inventory error:", error);
    showArchivedInventoryNotification("Failed to retrieve archived inventory in Firebase.", "error");
  }
}

function createRestoredInventoryItem(archivedItem) {
  const original = archivedItem.originalRecord || {};
  const quantity = Number(archivedItem.quantity ?? original.quantity ?? 0) || 0;

  return {
    ...original,

    id: archivedItem.id,
    itemName: archivedItem.itemName,
    itemDescription: archivedItem.itemDescription || original.itemDescription || "",
    category: archivedItem.category,
    quantity,
    stock: quantity,
    qty: quantity,
    itemQuantity: quantity,
    unit: archivedItem.unit || original.unit || "",
    expirationDate:
      archivedItem.expirationDate ||
      original.expirationDate ||
      original.expiration ||
      original.expiryDate ||
      "",

    archived: false,
    isArchived: false,
    inventoryArchived: false,
    archivedDate: "",
    dateArchived: "",
    archivedAt: "",

    status: getInventoryStatus(quantity),
    retrievedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/* =========================================================
   HELPERS
========================================================= */

function isArchivedInventoryItem(item) {
  return (
    item?.archived === true ||
    item?.isArchived === true ||
    item?.inventoryArchived === true ||
    String(item?.status || "").toLowerCase() === "archived"
  );
}

function getInventoryStatus(quantity) {
  const qty = Number(quantity) || 0;
  return qty <= 5 ? "Low Stock" : "In Stock";
}

function formatArchivedInventoryExpiration(value) {
  if (!value || value === "-") return "-";

  if (String(value).includes("-")) {
    const parts = String(value).split("-");

    if (parts.length >= 2) {
      const year = parts[0];
      const month = parts[1];

      return `${month}/${String(year).slice(2)}`;
    }
  }

  return value;
}

function formatArchivedInventoryDate(value) {
  if (!value || value === "-") return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

/* =========================================================
   UTILITIES
========================================================= */

function showArchivedInventoryNotification(message, type = "success") {
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

function escapeArchivedInventoryHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}