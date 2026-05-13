document.addEventListener("DOMContentLoaded", async function () {
  await syncInventoryFromFirebaseToLocalStorage();

  loadInventoryLocalStorage();
  renderInventoryRecords();
  initializeInventoryEvents();
});

/* ================= DATA ================= */
let inventoryRecords = [];
let selectedInventoryIds = [];
let editingInventoryIndex = null;

let inventoryCurrentFilter = "all";
let inventoryCurrentSort = "";
let inventorySortDirection = "asc";

/* ================= PAGE ROLE ================= */
function isStaffInventoryPage() {
  return window.location.pathname.toLowerCase().includes("staff-inventory.html");
}

function shouldShowSelectionColumn() {
  return !!document.getElementById("selectAllInventory");
}

function shouldShowActionColumn() {
  return !isStaffInventoryPage();
}

function getInventoryTableColspan() {
  const headerCount = document.querySelectorAll(".custom-table thead th").length;

  if (headerCount > 0) {
    return headerCount;
  }

  if (isStaffInventoryPage()) {
    return shouldShowSelectionColumn() ? 8 : 7;
  }

  return 9;
}

/* ================= LOCAL STORAGE ================= */
const INVENTORY_STORAGE_KEYS = {
  inventoryRecords: "inventoryRecords",
  archivedInventoryRecords: "archivedInventoryRecords",
  lowStockItems: "lowStockItems",
  recentActivities: "recentActivities",
  checkoutItems: "checkoutItems"
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

function loadInventoryLocalStorage() {
  inventoryRecords = getLocalStorageArray(INVENTORY_STORAGE_KEYS.inventoryRecords)
    .filter(function (item) {
      return !isInventoryArchived(item);
    });
}

function saveInventoryLocalStorage() {
  inventoryRecords = inventoryRecords.filter(function (item) {
    return !isInventoryArchived(item);
  });

  setLocalStorageArray(INVENTORY_STORAGE_KEYS.inventoryRecords, inventoryRecords);
  syncLowStockItemsToLocalStorage();
}

function syncLowStockItemsToLocalStorage() {
  const lowStockItems = inventoryRecords
    .filter(function (item) {
      return !isInventoryArchived(item) && getInventoryStatus(item.quantity) === "Low Stock";
    })
    .map(function (item) {
      return {
        id: item.id,
        itemName: item.itemName,
        itemDescription: item.itemDescription,
        category: item.category,
        quantity: item.quantity,
        unit: item.unit,
        expirationDate: item.expirationDate,
        price: item.price || 0,
        status: getInventoryStatus(item.quantity)
      };
    });

  setLocalStorageArray(INVENTORY_STORAGE_KEYS.lowStockItems, lowStockItems);
}

function saveRecentActivity(activity) {
  const recentActivities = getLocalStorageArray(INVENTORY_STORAGE_KEYS.recentActivities);

  recentActivities.unshift(activity);

  setLocalStorageArray(INVENTORY_STORAGE_KEYS.recentActivities, recentActivities);
}

async function syncInventoryFromFirebaseToLocalStorage() {
  if (!window.db) {
    console.warn("Firestore is not ready. Using localStorage only.");
    return;
  }

  try {
    const inventorySnapshot = await window.db.collection("inventoryRecords").get();

    const firebaseInventoryRecords = inventorySnapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt),
        updatedAt: normalizeFirebaseDate(data.updatedAt),
        archivedAt: normalizeFirebaseDate(data.archivedAt),
        archivedDate: normalizeFirebaseDate(data.archivedDate),
        dateArchived: normalizeFirebaseDate(data.dateArchived)
      };
    });

    const activeRecords = firebaseInventoryRecords.filter(function (item) {
      return !isInventoryArchived(item);
    });

    const archivedRecords = firebaseInventoryRecords.filter(function (item) {
      return isInventoryArchived(item);
    });

    setLocalStorageArray(INVENTORY_STORAGE_KEYS.inventoryRecords, activeRecords);
    setLocalStorageArray(INVENTORY_STORAGE_KEYS.archivedInventoryRecords, archivedRecords);

    inventoryRecords = activeRecords;
    syncLowStockItemsToLocalStorage();

    const checkoutSnapshot = await window.db.collection("checkoutItems").get();

    const firebaseCheckoutItems = checkoutSnapshot.docs.map(function (doc) {
      return {
        firebaseDocId: doc.id,
        ...doc.data()
      };
    });

    setLocalStorageArray(INVENTORY_STORAGE_KEYS.checkoutItems, firebaseCheckoutItems);

    console.log("Firebase inventory loaded:", firebaseInventoryRecords.length);
  } catch (error) {
    console.error("Firebase inventory load error:", error);
    showNotification("Failed to load inventory from Firebase.", "warning");
  }
}

function normalizeFirebaseDate(value) {
  if (!value) return "";

  if (value.toDate) {
    return value.toDate().toISOString();
  }

  return value;
}

async function addInventoryItemToFirebase(item) {
  if (!window.db) {
    throw new Error("Firestore is not initialized.");
  }

  const docRef = await window.db.collection("inventoryRecords").add({
    ...item,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  return docRef.id;
}

async function getInventoryFirebaseDocRef(itemOrId) {
  if (!window.db) {
    throw new Error("Firestore is not initialized.");
  }

  const firebaseDocId =
    typeof itemOrId === "object" ? itemOrId.firebaseDocId : "";

  const itemId =
    typeof itemOrId === "object" ? itemOrId.id : itemOrId;

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

async function updateInventoryItemInFirebase(itemOrId, updates) {
  const docRef = await getInventoryFirebaseDocRef(itemOrId);

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

async function syncLowStockItemsToFirebase() {
  if (!window.db) return;

  const lowStockItems = getLocalStorageArray(INVENTORY_STORAGE_KEYS.lowStockItems);

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

async function upsertCheckoutItemToFirebase(item) {
  if (!window.db) {
    throw new Error("Firestore is not initialized.");
  }

  const sourceId = String(item.sourceInventoryId || item.id || "");

  if (!sourceId) {
    throw new Error("Checkout item has no source inventory ID.");
  }

  const payload = {
    ...item,
    id: String(item.id),
    sourceInventoryId: sourceId,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const snapshot = await window.db
    .collection("checkoutItems")
    .where("sourceInventoryId", "==", sourceId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    await window.db.collection("checkoutItems").add({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    return;
  }

  await snapshot.docs[0].ref.update(payload);
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

/* ================= CUSTOM CONFIRM MODAL ================= */
function createInventoryConfirmModal() {
  if (document.getElementById("inventoryConfirmModal")) return;

  const modalWrapper = document.createElement("div");

  modalWrapper.innerHTML = `
    <div class="modal fade" id="inventoryConfirmModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-2">
          <div class="modal-header border-0 pb-0">
            <div>
              <h2 class="modal-title fs-3 fw-bold">Confirm Action</h2>
              <p class="text-muted mb-0" id="inventoryConfirmMessage">
                Are you sure?
              </p>
            </div>

            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>

          <div class="modal-body pt-3">
            <div class="d-flex justify-content-end gap-2 mt-3">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                Cancel
              </button>

              <button type="button" class="btn btn-action" id="inventoryConfirmYesBtn">
                Archive
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalWrapper.firstElementChild);
}

function showInventoryConfirm(message) {
  return new Promise(function (resolve) {
    createInventoryConfirmModal();

    const modalElement = document.getElementById("inventoryConfirmModal");
    const messageElement = document.getElementById("inventoryConfirmMessage");
    const yesButton = document.getElementById("inventoryConfirmYesBtn");

    if (!modalElement || !messageElement || !yesButton || !window.bootstrap) {
      resolve(false);
      return;
    }

    messageElement.textContent = message;
    yesButton.textContent = "Archive";

    const modalInstance =
      bootstrap.Modal.getInstance(modalElement) ||
      new bootstrap.Modal(modalElement);

    let isResolved = false;

    function cleanup(result) {
      if (isResolved) return;

      isResolved = true;

      yesButton.removeEventListener("click", handleConfirm);
      modalElement.removeEventListener("hidden.bs.modal", handleCancel);

      resolve(result);
    }

    function handleConfirm() {
      cleanup(true);
      modalInstance.hide();
    }

    function handleCancel() {
      cleanup(false);
    }

    yesButton.addEventListener("click", handleConfirm);
    modalElement.addEventListener("hidden.bs.modal", handleCancel);

    modalInstance.show();
  });
}

/* ================= HELPERS ================= */
function isInventoryArchived(item) {
  return (
    item?.archived === true ||
    item?.isArchived === true ||
    item?.inventoryArchived === true ||
    String(item?.status || "").toLowerCase() === "archived"
  );
}

function getNextInventoryId() {
  const archivedInventoryRecords = getLocalStorageArray(
    INVENTORY_STORAGE_KEYS.archivedInventoryRecords
  );

  const allRecords = [
    ...inventoryRecords,
    ...archivedInventoryRecords
  ];

  if (allRecords.length === 0) return 1;

  return allRecords.reduce(function (max, item) {
    return Math.max(max, parseInt(item.id, 10) || 0);
  }, 0) + 1;
}

function getInventoryStatus(quantity) {
  const qty = parseFloat(quantity) || 0;
  return qty <= 5 ? "Low Stock" : "In Stock";
}

function formatInventoryQuantity(quantity) {
  const qty = parseFloat(quantity) || 0;

  if (Number.isInteger(qty)) {
    return String(qty);
  }

  return String(qty.toFixed(2)).replace(/\.?0+$/, "");
}

function formatInventoryPrice(price) {
  const amount = parseFloat(price) || 0;
  return `₱${amount.toFixed(2)}`;
}

function formatInventoryExpiration(value) {
  if (!value) return "";

  if (String(value).includes("-")) {
    const [year, month] = String(value).split("-");
    return `${month}/${String(year).slice(2)}`;
  }

  return value;
}

function closeBootstrapModal(modalId) {
  const modalElement = document.getElementById(modalId);
  if (!modalElement || !window.bootstrap) return;

  const modalInstance =
    bootstrap.Modal.getInstance(modalElement) ||
    new bootstrap.Modal(modalElement);

  modalInstance.hide();
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getOptionalInputValue(ids) {
  for (const id of ids) {
    const element = document.getElementById(id);

    if (element) {
      return element.value;
    }
  }

  return "";
}

function getCleanPrice(value) {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }

  const price = parseFloat(value);

  if (Number.isNaN(price) || price < 0) {
    return 0;
  }

  return price;
}

function syncInventorySelection(id, isSelected) {
  const itemId = String(id || "");

  if (!itemId) return;

  if (isSelected) {
    if (!selectedInventoryIds.includes(itemId)) {
      selectedInventoryIds.push(itemId);
    }
  } else {
    selectedInventoryIds = selectedInventoryIds.filter(function (selectedId) {
      return selectedId !== itemId;
    });
  }
}

function updateSelectAllInventoryState(allowSelectAllChecked = false) {
  const selectAll = document.getElementById("selectAllInventory");
  const checkboxes = document.querySelectorAll(".inventory-checkbox");

  if (!selectAll) return;

  if (checkboxes.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  if (!allowSelectAllChecked) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  const checkedBoxes = document.querySelectorAll(".inventory-checkbox:checked");

  selectAll.checked = checkedBoxes.length === checkboxes.length;
  selectAll.indeterminate =
    checkedBoxes.length > 0 && checkedBoxes.length < checkboxes.length;
}

function clearInventorySelection() {
  selectedInventoryIds = [];

  document.querySelectorAll(".inventory-checkbox").forEach(function (checkbox) {
    checkbox.checked = false;
  });

  document.querySelectorAll("#inventoryTableBody tr").forEach(function (row) {
    row.classList.remove("selected-record");
  });

  updateSelectAllInventoryState(false);
}

function isInventoryItemSellable(item) {
  const blockedCategories = [
    "Surgery Supplies",
    "Clinic Supplies",
    "Supply"
  ];

  return !blockedCategories.includes(item.category);
}

/* ================= ADD SELECTED TO CHECKOUT ================= */
async function addSelectedItemsToCheckout() {
  if (selectedInventoryIds.length === 0) {
    showNotification("Please select item/s to add to checkout.", "warning");
    return;
  }

  const selectedItems = inventoryRecords.filter(function (item) {
    return selectedInventoryIds.includes(String(item.id)) && !isInventoryArchived(item);
  });

  if (selectedItems.length === 0) {
    showNotification("Selected item/s were not found.", "warning");
    return;
  }

  const blockedItems = selectedItems.filter(function (item) {
    return !isInventoryItemSellable(item);
  });

  const outOfStockItems = selectedItems.filter(function (item) {
    return isInventoryItemSellable(item) && (parseFloat(item.quantity) || 0) <= 0;
  });

  const sellableItems = selectedItems.filter(function (item) {
    return isInventoryItemSellable(item) && (parseFloat(item.quantity) || 0) > 0;
  });

  if (sellableItems.length === 0) {
    if (blockedItems.length > 0) {
      showNotification("Selected item/s are clinic-use supplies and cannot be added to checkout.", "warning");
    } else {
      showNotification("Selected item/s are out of stock.", "warning");
    }

    return;
  }

  const checkoutItems = getLocalStorageArray(INVENTORY_STORAGE_KEYS.checkoutItems);

  const alreadyAddedItems = [];
  const newlyAddedItems = [];
  const checkoutItemsToSync = [];

  sellableItems.forEach(function (item) {
    const existingCheckoutItem = checkoutItems.find(function (checkoutItem) {
      return String(checkoutItem.sourceInventoryId || checkoutItem.id) === String(item.id);
    });

    if (existingCheckoutItem) {
      alreadyAddedItems.push(item);

      existingCheckoutItem.availableQuantity = parseFloat(item.quantity) || 0;
      existingCheckoutItem.price = parseFloat(item.price) || 0;
      existingCheckoutItem.unit = item.unit;
      existingCheckoutItem.expirationDate = item.expirationDate;
      existingCheckoutItem.updatedAt = new Date().toISOString();

      checkoutItemsToSync.push(existingCheckoutItem);
      return;
    }

    const checkoutItem = {
      id: String(item.id),
      sourceInventoryId: String(item.id),
      itemName: item.itemName,
      itemDescription: item.itemDescription,
      category: item.category,
      availableQuantity: parseFloat(item.quantity) || 0,
      checkoutQuantity: 1,
      unit: item.unit,
      price: parseFloat(item.price) || 0,
      expirationDate: item.expirationDate,
      addedAt: new Date().toISOString()
    };

    checkoutItems.push(checkoutItem);
    checkoutItemsToSync.push(checkoutItem);

    newlyAddedItems.push(item);
  });

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Inventory",
    action: "Added to Checkout",
    details: `${newlyAddedItems.length} item(s) added to checkout`
  };

  try {
    for (const checkoutItem of checkoutItemsToSync) {
      await upsertCheckoutItemToFirebase(checkoutItem);
    }

    setLocalStorageArray(INVENTORY_STORAGE_KEYS.checkoutItems, checkoutItems);

    if (newlyAddedItems.length > 0) {
      await saveRecentActivityToFirebase(activity);
      saveRecentActivity(activity);
    }

    if (blockedItems.length > 0) {
      const blockedNames = blockedItems
        .map(function (item) {
          return item.itemName;
        })
        .join(", ");

      showNotification(`${blockedNames} cannot be added because they are clinic-use supplies.`, "warning");
    }

    if (outOfStockItems.length > 0) {
      const outOfStockNames = outOfStockItems
        .map(function (item) {
          return item.itemName;
        })
        .join(", ");

      showNotification(`${outOfStockNames} cannot be added because they are out of stock.`, "warning");
    }

    clearInventorySelection();
    renderInventoryRecords();

    if (newlyAddedItems.length > 0) {
      if (alreadyAddedItems.length > 0) {
        showNotification("New item/s added. Some selected item/s were already in checkout.", "info");
      } else {
        showNotification("Selected item/s added to checkout.", "success");
      }

      return;
    }

    if (alreadyAddedItems.length > 0) {
      showNotification("Selected item/s are already added to checkout.", "info");
      return;
    }
  } catch (error) {
    console.error("Firebase checkout sync error:", error);
    showNotification("Failed to add selected item/s to checkout in Firebase.", "error");
  }
}

/* ================= FILTER / SORT ================= */
function getFilteredInventory() {
  let data = inventoryRecords.filter(function (item) {
    return !isInventoryArchived(item);
  });

  if (inventoryCurrentFilter !== "all") {
    data = data.filter(function (item) {
      return item.category === inventoryCurrentFilter;
    });
  }

  const searchValue =
    document.getElementById("inventorySearch")?.value.toLowerCase() || "";

  if (searchValue) {
    data = data.filter(function (item) {
      return (
        String(item.itemName || "").toLowerCase().includes(searchValue) ||
        String(item.itemDescription || "").toLowerCase().includes(searchValue) ||
        String(item.category || "").toLowerCase().includes(searchValue) ||
        String(item.status || "").toLowerCase().includes(searchValue) ||
        String(item.price || "").toLowerCase().includes(searchValue)
      );
    });
  }

  if (inventoryCurrentSort === "quantity") {
    data.sort(function (a, b) {
      const result = Number(a.quantity) - Number(b.quantity);
      return inventorySortDirection === "asc" ? result : -result;
    });
  }

  if (inventoryCurrentSort === "expiration") {
    data.sort(function (a, b) {
      const result = String(a.expirationDate || "").localeCompare(
        String(b.expirationDate || "")
      );

      return inventorySortDirection === "asc" ? result : -result;
    });
  }

  if (inventoryCurrentSort === "status") {
    const order = {
      "Low Stock": 1,
      "In Stock": 2
    };

    data.sort(function (a, b) {
      const result = (order[a.status] || 99) - (order[b.status] || 99);
      return inventorySortDirection === "asc" ? result : -result;
    });
  }

  return data;
}

/* ================= RENDER ================= */
function renderInventoryRecords() {
  const tableBody = document.getElementById("inventoryTableBody");
  if (!tableBody) return;

  const displayInventory = getFilteredInventory();
  const showSelection = shouldShowSelectionColumn();
  const showAction = shouldShowActionColumn();

  tableBody.innerHTML = "";

  if (displayInventory.length === 0) {
    tableBody.innerHTML = `
      <tr id="emptyInventoryRow">
        <td colspan="${getInventoryTableColspan()}" class="text-center text-muted py-5">
          No inventory records found.
        </td>
      </tr>
    `;

    updateSelectAllInventoryState(false);
    return;
  }

  displayInventory.forEach(function (item) {
    const originalIndex = inventoryRecords.findIndex(function (record) {
      return String(record.id) === String(item.id);
    });

    const itemId = String(item.id);
    const isSelected = selectedInventoryIds.includes(itemId);

    const row = document.createElement("tr");
    row.dataset.inventoryRowId = itemId;

    if (isSelected && showSelection) {
      row.classList.add("selected-record");
    }

    const checkboxCell = showSelection
      ? `
        <td class="checkbox-col">
          <input 
            type="checkbox" 
            class="inventory-checkbox" 
            data-id="${escapeHTML(item.id)}"
            ${isSelected ? "checked" : ""}
          >
        </td>
      `
      : "";

    const actionCell = showAction
      ? `
        <td>
          <button 
            type="button" 
            class="btn btn-sm btn-primary edit-inventory-btn" 
            data-index="${originalIndex}"
          >
            Edit
          </button>
        </td>
      `
      : "";

    row.innerHTML = `
      ${checkboxCell}

      <td>${escapeHTML(item.id)}</td>
      <td>${escapeHTML(item.itemName)}</td>
      <td>${escapeHTML(item.category)}</td>
      <td>${escapeHTML(formatInventoryQuantity(item.quantity))} ${escapeHTML(item.unit)}</td>
      <td>${escapeHTML(formatInventoryPrice(item.price))}</td>
      <td>${escapeHTML(formatInventoryExpiration(item.expirationDate))}</td>

      <td>
        <span class="status-badge ${
          item.status === "Low Stock" ? "status-low" : "status-active"
        }">
          ${escapeHTML(item.status)}
        </span>
      </td>

      ${actionCell}
    `;

    tableBody.appendChild(row);
  });

  updateSelectAllInventoryState(false);
}

/* ================= ADD ================= */
async function addInventoryItem(event) {
  event.preventDefault();

  const itemName = document.getElementById("itemName")?.value.trim();
  const itemDescription = document
    .getElementById("itemDescription")
    ?.value.trim();
  const category = document.getElementById("category")?.value;
  const quantity = document.getElementById("quantity")?.value;
  const unit = document.getElementById("unit")?.value;
  const expirationDate = document.getElementById("expirationDate")?.value;

  const priceValue = getOptionalInputValue([
    "price",
    "sellingPrice",
    "unitPrice",
    "itemPrice"
  ]);

  const price = getCleanPrice(priceValue);

  if (
    !itemName ||
    !itemDescription ||
    !category ||
    quantity === "" ||
    !unit ||
    !expirationDate
  ) {
    showNotification("Please fill in all inventory fields.", "warning");
    return;
  }

  const newItem = {
    id: getNextInventoryId(),
    itemName,
    itemDescription,
    category,
    quantity,
    unit,
    expirationDate,
    price,
    status: getInventoryStatus(quantity),
    archived: false,
    isArchived: false,
    inventoryArchived: false,
    createdAt: new Date().toISOString()
  };

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Inventory",
    action: "Added Item",
    details: `${newItem.itemName} added to inventory`
  };

  try {
    newItem.firebaseDocId = await addInventoryItemToFirebase(newItem);
    await saveRecentActivityToFirebase(activity);

    inventoryRecords.push(newItem);

    saveInventoryLocalStorage();
    await syncLowStockItemsToFirebase();

    saveRecentActivity(activity);

    document.getElementById("addInventoryForm")?.reset();
    closeBootstrapModal("addInventoryModal");

    renderInventoryRecords();

    showNotification("Item added successfully!", "success");
  } catch (error) {
    console.error("Firebase add inventory error:", error);
    showNotification("Failed to add item to Firebase.", "error");
  }
}

/* ================= EDIT - ADMIN ONLY ================= */
function openEditInventoryModal(index) {
  if (isStaffInventoryPage()) {
    showNotification("Staff accounts cannot edit inventory items.", "warning");
    return;
  }

  const item = inventoryRecords[index];
  if (!item) return;

  editingInventoryIndex = index;

  document.getElementById("editInventoryId").value = item.id || "";
  document.getElementById("editInventoryItemName").value = item.itemName || "";
  document.getElementById("editInventoryItemDescription").value =
    item.itemDescription || "";
  document.getElementById("editInventoryCategory").value = item.category || "";
  document.getElementById("editInventoryQuantity").value = item.quantity || "";
  document.getElementById("editInventoryUnit").value = item.unit || "";
  document.getElementById("editInventoryExpirationDate").value =
    item.expirationDate || "";

  const editPriceInput =
    document.getElementById("editInventoryPrice") ||
    document.getElementById("editPrice") ||
    document.getElementById("editSellingPrice") ||
    document.getElementById("editUnitPrice") ||
    document.getElementById("editItemPrice");

  if (editPriceInput) {
    editPriceInput.value =
      item.price ||
      item.sellingPrice ||
      item.unitPrice ||
      item.itemPrice ||
      "";
  }

  const modalElement = document.getElementById("editInventoryModal");

  if (!modalElement) return;

  const modal = new bootstrap.Modal(modalElement);
  modal.show();
}

async function updateInventoryItem(event) {
  event.preventDefault();

  if (isStaffInventoryPage()) {
    showNotification("Staff accounts cannot edit inventory items.", "warning");
    return;
  }

  if (
    editingInventoryIndex === null ||
    !inventoryRecords[editingInventoryIndex]
  ) {
    return;
  }

  const oldItem = inventoryRecords[editingInventoryIndex];

  const itemName = document
    .getElementById("editInventoryItemName")
    ?.value.trim();
  const itemDescription = document
    .getElementById("editInventoryItemDescription")
    ?.value.trim();
  const category = document.getElementById("editInventoryCategory")?.value;
  const quantity = document.getElementById("editInventoryQuantity")?.value;
  const unit = document.getElementById("editInventoryUnit")?.value;
  const expirationDate = document.getElementById(
    "editInventoryExpirationDate"
  )?.value;

  const priceValue = getOptionalInputValue([
    "editInventoryPrice",
    "editPrice",
    "editSellingPrice",
    "editUnitPrice",
    "editItemPrice"
  ]);

  const price = getCleanPrice(priceValue);

  if (
    !itemName ||
    !itemDescription ||
    !category ||
    quantity === "" ||
    !unit ||
    !expirationDate
  ) {
    showNotification("Please fill in all inventory fields.", "warning");
    return;
  }

  const updatedItem = {
    ...oldItem,
    itemName,
    itemDescription,
    category,
    quantity,
    unit,
    expirationDate,
    price,
    status: getInventoryStatus(quantity),
    archived: false,
    isArchived: false,
    inventoryArchived: false,
    updatedAt: new Date().toISOString()
  };

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Inventory",
    action: "Updated Item",
    details: `${itemName} inventory record updated`
  };

  try {
    await updateInventoryItemInFirebase(oldItem, {
      itemName,
      itemDescription,
      category,
      quantity,
      unit,
      expirationDate,
      price,
      status: getInventoryStatus(quantity),
      archived: false,
      isArchived: false,
      inventoryArchived: false
    });

    await saveRecentActivityToFirebase(activity);

    inventoryRecords[editingInventoryIndex] = updatedItem;

    saveInventoryLocalStorage();
    await syncLowStockItemsToFirebase();

    saveRecentActivity(activity);

    closeBootstrapModal("editInventoryModal");

    editingInventoryIndex = null;

    renderInventoryRecords();

    showNotification("Item updated successfully!", "success");
  } catch (error) {
    console.error("Firebase update inventory error:", error);
    showNotification("Failed to update item in Firebase.", "error");
  }
}

/* ================= ARCHIVE - ADMIN ONLY ================= */
async function archiveSelectedInventoryItems() {
  if (isStaffInventoryPage()) {
    showNotification("Staff accounts cannot archive inventory items.", "warning");
    return;
  }

  const checkedBoxes = document.querySelectorAll(".inventory-checkbox:checked");

  if (checkedBoxes.length === 0 && selectedInventoryIds.length === 0) {
    showNotification("Please select item/s to archive.", "warning");
    return;
  }

  const confirmed = await showInventoryConfirm(
    "Archive selected inventory item/s?"
  );

  if (!confirmed) return;

  const selectedIds =
    selectedInventoryIds.length > 0
      ? [...selectedInventoryIds]
      : Array.from(checkedBoxes).map(function (checkbox) {
          return String(checkbox.dataset.id);
        });

  const now = new Date().toISOString();

  const currentArchivedInventory = getLocalStorageArray(
    INVENTORY_STORAGE_KEYS.archivedInventoryRecords
  );

  const itemsToArchive = inventoryRecords
    .filter(function (item) {
      return selectedIds.includes(String(item.id));
    })
    .map(function (item) {
      return {
        ...item,
        archived: true,
        isArchived: true,
        inventoryArchived: true,
        status: "Archived",
        archivedDate: now,
        dateArchived: now,
        archivedAt: now
      };
    });

  if (itemsToArchive.length === 0) {
    showNotification("Selected item/s were not found.", "warning");
    return;
  }

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Inventory",
    action: "Archived Item",
    details: `${selectedIds.length} inventory item(s) archived`
  };

  try {
    for (const item of itemsToArchive) {
      await updateInventoryItemInFirebase(item, {
        archived: true,
        isArchived: true,
        inventoryArchived: true,
        status: "Archived",
        archivedDate: now,
        dateArchived: now,
        archivedAt: now
      });
    }

    await saveRecentActivityToFirebase(activity);

    const archivedIds = itemsToArchive.map(function (item) {
      return String(item.id);
    });

    const archivedWithoutDuplicates = currentArchivedInventory.filter(function (item) {
      return !archivedIds.includes(String(item.id));
    });

    inventoryRecords = inventoryRecords.filter(function (item) {
      return !selectedIds.includes(String(item.id));
    });

    setLocalStorageArray(
      INVENTORY_STORAGE_KEYS.archivedInventoryRecords,
      [...itemsToArchive, ...archivedWithoutDuplicates]
    );

    selectedInventoryIds = [];

    const selectAll = document.getElementById("selectAllInventory");

    if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }

    saveInventoryLocalStorage();
    await syncLowStockItemsToFirebase();

    saveRecentActivity(activity);

    renderInventoryRecords();

    showNotification("Selected item/s archived successfully.", "success");
  } catch (error) {
    console.error("Firebase archive inventory error:", error);
    showNotification("Failed to archive item/s in Firebase.", "error");
  }
}

function removeSelectedInventoryItems() {
  archiveSelectedInventoryItems();
}

/* ================= EVENTS ================= */
function initializeInventoryEvents() {
  const addInventoryForm = document.getElementById("addInventoryForm");
  const editInventoryForm = document.getElementById("editInventoryForm");
  const removeInventoryBtn = document.getElementById("removeInventoryBtn");
  const archiveInventoryBtn = document.getElementById("archiveInventoryBtn");
  const inventorySearch = document.getElementById("inventorySearch");
  const selectAllInventory = document.getElementById("selectAllInventory");
  const addSelectedToCheckoutBtn = document.getElementById("addSelectedToCheckoutBtn");

  if (addInventoryForm) {
    addInventoryForm.addEventListener("submit", addInventoryItem);
  }

  if (editInventoryForm) {
    editInventoryForm.addEventListener("submit", updateInventoryItem);
  }

  if (removeInventoryBtn) {
    removeInventoryBtn.addEventListener("click", archiveSelectedInventoryItems);
  }

  if (archiveInventoryBtn) {
    archiveInventoryBtn.addEventListener("click", archiveSelectedInventoryItems);
  }

  if (inventorySearch) {
    inventorySearch.addEventListener("input", renderInventoryRecords);
  }

  if (addSelectedToCheckoutBtn) {
    addSelectedToCheckoutBtn.addEventListener("click", addSelectedItemsToCheckout);
  }

  if (selectAllInventory) {
    selectAllInventory.addEventListener("change", function () {
      document.querySelectorAll(".inventory-checkbox").forEach(function (checkbox) {
        checkbox.checked = selectAllInventory.checked;

        syncInventorySelection(checkbox.dataset.id, checkbox.checked);

        const row = checkbox.closest("tr");

        if (row) {
          row.classList.toggle("selected-record", checkbox.checked);
        }
      });

      updateSelectAllInventoryState(true);
    });
  }

  document.querySelectorAll(".inventory-filter-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelectorAll(".inventory-filter-btn").forEach(function (btn) {
        btn.classList.remove("active");
      });

      button.classList.add("active");
      inventoryCurrentFilter = button.dataset.filter || "all";

      renderInventoryRecords();
    });
  });

  document.querySelectorAll(".sortable-th").forEach(function (header) {
    header.addEventListener("click", function () {
      const sortKey = header.dataset.sort;

      if (inventoryCurrentSort === sortKey) {
        inventorySortDirection =
          inventorySortDirection === "asc" ? "desc" : "asc";
      } else {
        inventoryCurrentSort = sortKey;
        inventorySortDirection = "asc";
      }

      document.querySelectorAll(".sortable-th").forEach(function (th) {
        th.classList.remove("active");
      });

      header.classList.add("active");

      renderInventoryRecords();
    });
  });

  document.addEventListener("click", function (event) {
    const editBtn = event.target.closest(".edit-inventory-btn");

    if (!editBtn) return;

    const index = parseInt(editBtn.dataset.index, 10);

    openEditInventoryModal(index);
  });

  document.addEventListener("change", function (event) {
    if (!event.target.classList.contains("inventory-checkbox")) return;

    const checkbox = event.target;
    const row = checkbox.closest("tr");

    syncInventorySelection(checkbox.dataset.id, checkbox.checked);

    if (row) {
      row.classList.toggle("selected-record", checkbox.checked);
    }

    updateSelectAllInventoryState(false);
  });

  document.addEventListener("click", function (event) {
    if (!shouldShowSelectionColumn()) return;

    const row = event.target.closest(
      "#inventoryTableBody tr[data-inventory-row-id]"
    );

    if (!row) return;

    const clickedInteractiveElement = event.target.closest(
      "button, a, input, label, select, textarea"
    );

    if (clickedInteractiveElement) return;

    const checkbox = row.querySelector(".inventory-checkbox");

    if (!checkbox) return;

    checkbox.checked = !checkbox.checked;

    syncInventorySelection(checkbox.dataset.id, checkbox.checked);

    row.classList.toggle("selected-record", checkbox.checked);

    updateSelectAllInventoryState(false);
  });
}