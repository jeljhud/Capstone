document.addEventListener("DOMContentLoaded", async function () {
  await initializePOS();
});

/* =========================================================
   POS / ITEM CHECKOUT
   LOCALSTORAGE ONLY
   ITEMS COME FROM checkoutItems ONLY
========================================================= */

let posInventoryItems = [];
let posInventoryRecordsRaw = [];
let posCheckoutItemsRaw = [];
let posCart = [];
let salesHistory = [];

/* =========================================================
   LOCAL STORAGE
========================================================= */

const POS_STORAGE_KEYS = {
  inventoryRecords: "inventoryRecords",
  checkoutItems: "checkoutItems",
  lowStockItems: "lowStockItems",
  salesHistory: "salesHistory",
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

function loadPOSLocalStorage() {
  posInventoryRecordsRaw = getLocalStorageArray(POS_STORAGE_KEYS.inventoryRecords);
  posCheckoutItemsRaw = getLocalStorageArray(POS_STORAGE_KEYS.checkoutItems);
  salesHistory = getLocalStorageArray(POS_STORAGE_KEYS.salesHistory);
}

function savePOSInventoryLocalStorage() {
  setLocalStorageArray(POS_STORAGE_KEYS.inventoryRecords, posInventoryRecordsRaw);
  syncPOSLowStockItems();
}

function savePOSCheckoutItemsLocalStorage() {
  setLocalStorageArray(POS_STORAGE_KEYS.checkoutItems, posCheckoutItemsRaw);
}

function clearPOSCheckoutItemsLocalStorage() {
  posCheckoutItemsRaw = [];
  setLocalStorageArray(POS_STORAGE_KEYS.checkoutItems, []);
}

function savePOSSalesHistoryLocalStorage() {
  setLocalStorageArray(POS_STORAGE_KEYS.salesHistory, salesHistory);
}

function savePOSRecentActivity(activity) {
  const recentActivities = getLocalStorageArray(POS_STORAGE_KEYS.recentActivities);

  recentActivities.unshift(activity);

  setLocalStorageArray(POS_STORAGE_KEYS.recentActivities, recentActivities);
}

function syncPOSLowStockItems() {
  const lowStockItems = posInventoryRecordsRaw
    .map(function (item, index) {
      return normalizeInventoryRecord(item, index);
    })
    .filter(function (item) {
      return !item.archived && item.stock <= 5;
    })
    .map(function (item) {
      return {
        id: item.id,
        itemName: item.name,
        itemDescription: item.description || "",
        category: item.category,
        quantity: item.stock,
        unit: item.unit || "",
        expirationDate: item.expirationDate || "",
        price: item.price || 0,
        status: getInventoryStatusForPOS(item.stock)
      };
    });

  setLocalStorageArray(POS_STORAGE_KEYS.lowStockItems, lowStockItems);
}

async function syncPOSFromFirebaseToLocalStorage() {
  if (!window.db) {
    console.warn("Firestore is not ready. POS will use localStorage only.");
    return;
  }

  try {
    const inventorySnapshot = await window.db.collection("inventoryRecords").get();

    posInventoryRecordsRaw = inventorySnapshot.docs.map(function (doc) {
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

    const checkoutSnapshot = await window.db.collection("checkoutItems").get();

    posCheckoutItemsRaw = checkoutSnapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt),
        updatedAt: normalizeFirebaseDate(data.updatedAt),
        addedAt: normalizeFirebaseDate(data.addedAt)
      };
    });

    const salesSnapshot = await window.db.collection("salesHistory").get();

    salesHistory = salesSnapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt)
      };
    });

    setLocalStorageArray(POS_STORAGE_KEYS.inventoryRecords, posInventoryRecordsRaw);
    setLocalStorageArray(POS_STORAGE_KEYS.checkoutItems, posCheckoutItemsRaw);
    setLocalStorageArray(POS_STORAGE_KEYS.salesHistory, salesHistory);

    syncPOSLowStockItems();

    console.log("POS Firebase sync complete.");
  } catch (error) {
    console.error("POS Firebase sync error:", error);
    showPOSNotification("Failed to load checkout data from Firebase.", "error");
  }
}

function normalizeFirebaseDate(value) {
  if (!value) return "";

  if (value.toDate) {
    return value.toDate().toISOString();
  }

  return value;
}

async function getPOSInventoryDocRef(itemOrId) {
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
    throw new Error("Inventory item not found in Firebase.");
  }

  return stringSnapshot.docs[0].ref;
}

async function updatePOSInventoryStockInFirebase(inventoryRecord) {
  const docRef = await getPOSInventoryDocRef(inventoryRecord);

  await docRef.update({
    quantity: inventoryRecord.quantity,
    stock: inventoryRecord.stock,
    qty: inventoryRecord.qty,
    itemQuantity: inventoryRecord.itemQuantity,
    status: inventoryRecord.status,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function savePOSSaleToFirebase(saleRecord) {
  if (!window.db) return;

  await window.db.collection("salesHistory").doc(String(saleRecord.salesId)).set({
    ...saleRecord,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function savePOSRecentActivityToFirebase(activity) {
  if (!window.db) return;

  await window.db.collection("recentActivities").add({
    ...activity,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function syncPOSLowStockItemsToFirebase() {
  if (!window.db) return;

  const lowStockItems = getLocalStorageArray(POS_STORAGE_KEYS.lowStockItems);

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

async function updateAllDeductedInventoryInFirebase() {
  const updatedRecords = [];

  posCart.forEach(function (cartItem) {
    const inventoryRecord = posInventoryRecordsRaw.find(function (item) {
      return String(item.id) === String(cartItem.sourceInventoryId);
    });

    if (!inventoryRecord) return;

    const alreadyAdded = updatedRecords.some(function (item) {
      return String(item.id) === String(inventoryRecord.id);
    });

    if (!alreadyAdded) {
      updatedRecords.push(inventoryRecord);
    }
  });

  for (const record of updatedRecords) {
    await updatePOSInventoryStockInFirebase(record);
  }
}

/* =========================================================
   INITIALIZE
========================================================= */

async function initializePOS() {
  const posPage = document.getElementById("posPage");
  if (!posPage) return;

  await syncPOSFromFirebaseToLocalStorage();

  loadPOSLocalStorage();
  loadCheckoutItemsForPOS();
  renderPOSAvailableItems();
  renderPOSCart();
  initializePOSEvents();
  initializePOSReceiptEvents();
}

/* =========================================================
   LOAD ONLY ITEMS ADDED FROM INVENTORY TO CHECKOUT
========================================================= */

function loadCheckoutItemsForPOS() {
  posInventoryItems = [];

  if (posCheckoutItemsRaw.length === 0) {
    return;
  }

  const selectedItems = [];

  posCheckoutItemsRaw.forEach(function (checkoutItem, index) {
    const sourceId =
      checkoutItem.sourceInventoryId ||
      checkoutItem.inventoryId ||
      checkoutItem.id;

    const matchingInventory = posInventoryRecordsRaw.find(function (inventoryItem) {
      return String(inventoryItem.id) === String(sourceId);
    });

    if (!matchingInventory) return;

    const normalizedInventory = normalizeInventoryRecord(matchingInventory, index);

    if (!isItemAvailableForCheckout(normalizedInventory)) return;
    if (!isInventoryItemSellable(normalizedInventory)) return;

    selectedItems.push({
      ...normalizedInventory,
      checkoutQuantity: Number(checkoutItem.checkoutQuantity) || 1,
      addedAt: checkoutItem.addedAt || "",
      key: getPOSItemKey(normalizedInventory)
    });
  });

  posInventoryItems = selectedItems.sort(function (a, b) {
    return b.createdTime - a.createdTime;
  });
}

function normalizeInventoryRecord(item, index) {
  const stock =
    Number(item.quantity ?? item.stock ?? item.qty ?? item.itemQuantity ?? 0) || 0;

  const id =
    item.id ??
    item.itemId ??
    item.inventoryId ??
    item.code ??
    `ITEM-${index + 1}`;

  const name =
    item.itemName ??
    item.name ??
    item.productName ??
    item.item ??
    "Unnamed Item";

  const category =
    item.category ??
    item.itemCategory ??
    "Uncategorized";

  const price = parseMoney(
    item.price ??
    item.sellingPrice ??
    item.unitPrice ??
    item.amount ??
    item.itemPrice ??
    0
  );

  const status =
    item.status ??
    item.itemStatus ??
    getInventoryStatusForPOS(stock);

  const archived =
    item.archived === true ||
    item.isArchived === true ||
    item.inventoryArchived === true ||
    String(status).toLowerCase() === "archived";

  const expired =
    String(status).toLowerCase() === "expired" ||
    isExpiredDate(item.expirationDate ?? item.expiration ?? item.expiryDate);

  const unit = item.unit ?? item.itemUnit ?? "";
  const description = item.itemDescription ?? item.description ?? "";
  const expirationDate =
    item.expirationDate ?? item.expiration ?? item.expiryDate ?? "";

  const normalizedItem = {
    id: String(id),
    originalIndex: index,
    name: String(name),
    category: String(category),
    stock,
    price,
    unit: String(unit),
    description: String(description),
    expirationDate: String(expirationDate),
    status: String(status),
    archived,
    expired,
    createdTime: getInventoryRecordTime(item, index)
  };

  normalizedItem.key = getPOSItemKey(normalizedItem);

  return normalizedItem;
}

function getPOSItemKey(item) {
  return [
    String(item.id || "").trim().toLowerCase(),
    String(item.name || "").trim().toLowerCase(),
    String(item.category || "").trim().toLowerCase(),
    Number(item.price || 0)
  ].join("|");
}

function getInventoryRecordTime(item, fallbackIndex = 0) {
  const rawDate =
    item.createdAt ||
    item.dateAdded ||
    item.addedAt ||
    item.updatedAt ||
    "";

  const parsedTime = new Date(rawDate).getTime();

  if (!Number.isNaN(parsedTime)) {
    return parsedTime;
  }

  const numericId = Number(item.id || item.itemId || item.inventoryId || 0);

  if (Number.isFinite(numericId) && numericId > 0) {
    return numericId;
  }

  return fallbackIndex;
}

function getInventoryStatusForPOS(quantity) {
  const qty = Number(quantity) || 0;
  return qty <= 5 ? "Low Stock" : "In Stock";
}

function isExpiredDate(value) {
  if (!value) return false;

  if (String(value).includes("-") && String(value).length === 7) {
    const [year, month] = String(value).split("-");
    const expirationDate = new Date(Number(year), Number(month), 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return expirationDate < today;
  }

  const expirationDate = new Date(value);
  if (Number.isNaN(expirationDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  expirationDate.setHours(0, 0, 0, 0);

  return expirationDate < today;
}

function isInventoryItemSellable(item) {
  const blockedCategories = [
    "Surgery Supplies",
    "Clinic Supplies",
    "Supply"
  ];

  return !blockedCategories.includes(item.category);
}

function isItemAvailableForCheckout(item) {
  return (
    !item.archived &&
    !item.expired &&
    item.stock > 0 &&
    String(item.status).toLowerCase() !== "out of stock"
  );
}

/* =========================================================
   RENDER AVAILABLE CHECKOUT ITEMS
========================================================= */

function renderPOSAvailableItems() {
  const body = document.getElementById("posItemsTableBody");
  if (!body) return;

  const searchValue =
    document.getElementById("posSearchInput")?.value.toLowerCase().trim() || "";

  const categoryValue =
    document.getElementById("posCategoryFilter")?.value.toLowerCase() || "all";

  const availableItems = posInventoryItems
    .filter(isItemAvailableForCheckout)
    .filter(function (item) {
      const matchesSearch =
        item.id.toLowerCase().includes(searchValue) ||
        item.key.toLowerCase().includes(searchValue) ||
        item.name.toLowerCase().includes(searchValue) ||
        item.category.toLowerCase().includes(searchValue);

      const matchesCategory =
        categoryValue === "all" ||
        item.category.toLowerCase() === categoryValue ||
        item.category.toLowerCase().includes(categoryValue);

      return matchesSearch && matchesCategory;
    });

  body.innerHTML = "";

  if (posCheckoutItemsRaw.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted py-4">
          No items selected for checkout. Please add items from Inventory first.
        </td>
      </tr>
    `;
    return;
  }

  if (availableItems.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted py-4">
          No available checkout items found.
        </td>
      </tr>
    `;
    return;
  }

  availableItems.forEach(function (item) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(formatPOSQuantity(item.stock))} ${escapeHtml(item.unit)}</td>
      <td>${formatPeso(item.price)}</td>
      <td>
        <button
          class="btn btn-action pos-add-btn"
          type="button"
          data-id="${escapeHtml(item.key)}"
        >
          Add to Cart
        </button>
      </td>
    `;

    body.appendChild(row);
  });
}

/* =========================================================
   CART LOGIC
========================================================= */

function addItemToCart(itemKey) {
  const item = posInventoryItems.find(function (inventoryItem) {
    return inventoryItem.key === itemKey;
  });

  if (!item) {
    showPOSNotification("Item not found.", "error");
    return;
  }

  if (!isItemAvailableForCheckout(item)) {
    showPOSNotification("Item is not available for checkout.", "error");
    return;
  }

  const existingCartItem = posCart.find(function (cartItem) {
    return cartItem.key === item.key;
  });

  if (existingCartItem) {
    if (existingCartItem.quantity >= item.stock) {
      showPOSNotification("Not enough stock available.", "error");
      return;
    }

    existingCartItem.quantity += 1;
  } else {
    posCart.push({
      id: item.key,
      key: item.key,
      sourceInventoryId: item.id,
      latestId: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
      stock: item.stock,
      unit: item.unit,
      quantity: 1
    });
  }

  renderPOSCart();
  showPOSNotification("Item added to cart.", "success");
}

function increaseCartItem(itemId) {
  const cartItem = posCart.find(function (item) {
    return item.id === itemId;
  });

  if (!cartItem) return;

  if (cartItem.quantity >= cartItem.stock) {
    showPOSNotification("Not enough stock available.", "error");
    return;
  }

  cartItem.quantity += 1;
  renderPOSCart();
}

function decreaseCartItem(itemId) {
  const cartItem = posCart.find(function (item) {
    return item.id === itemId;
  });

  if (!cartItem) return;

  cartItem.quantity -= 1;

  if (cartItem.quantity <= 0) {
    removeCartItem(itemId);
    return;
  }

  renderPOSCart();
}

function removeCartItem(itemId) {
  posCart = posCart.filter(function (item) {
    return item.id !== itemId;
  });

  renderPOSCart();
}

function cancelCheckout() {
  if (posCart.length === 0 && posCheckoutItemsRaw.length === 0) {
    clearPOSPaymentFields();
    showPOSNotification("No checkout to cancel.", "error");
    return;
  }

  posCart = [];
  clearPOSPaymentFields();


  loadPOSLocalStorage();
  loadCheckoutItemsForPOS();
  renderPOSAvailableItems();
  renderPOSCart();

  showPOSNotification("Checkout cancelled.", "success");
}

function renderPOSCart() {
  const cartList = document.getElementById("posCartList");
  if (!cartList) return;

  cartList.innerHTML = "";

  if (posCart.length === 0) {
    cartList.innerHTML = `
      <div class="pos-empty-cart">
        No items added yet.
      </div>
    `;
  } else {
    posCart.forEach(function (item) {
      const cartItem = document.createElement("div");
      cartItem.className = "pos-cart-item";

      cartItem.innerHTML = `
        <div class="pos-cart-info">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${formatPeso(item.price)} × ${item.quantity}</small>
        </div>

        <div class="pos-cart-controls">
          <button type="button" class="pos-cart-btn" data-action="decrease" data-id="${escapeHtml(item.id)}">−</button>
          <span>${item.quantity}</span>
          <button type="button" class="pos-cart-btn" data-action="increase" data-id="${escapeHtml(item.id)}">+</button>
          <button type="button" class="pos-cart-remove" data-action="remove" data-id="${escapeHtml(item.id)}">×</button>
        </div>
      `;

      cartList.appendChild(cartItem);
    });
  }

  updatePOSTotals();
}

function getCartSubtotal() {
  return posCart.reduce(function (total, item) {
    return total + item.price * item.quantity;
  }, 0);
}

function updatePOSTotals() {
  const subtotal = getCartSubtotal();
  const total = subtotal;

  const subtotalEl = document.getElementById("posSubtotal");
  const totalEl = document.getElementById("posGrandTotal");

  if (subtotalEl) subtotalEl.textContent = formatPeso(subtotal);
  if (totalEl) totalEl.textContent = formatPeso(total);

  updatePOSChange();
}

function updatePOSChange() {
  const amountPaidInput = document.getElementById("amountPaid");
  const changeEl = document.getElementById("posChange");

  if (!amountPaidInput || !changeEl) return;

  const total = getCartSubtotal();
  const amountPaid = Number(amountPaidInput.value) || 0;
  const change = Math.max(amountPaid - total, 0);

  changeEl.textContent = formatPeso(change);
}

function clearPOSPaymentFields() {
  const amountPaidInput = document.getElementById("amountPaid");
  const paymentMethod = document.getElementById("paymentMethod");

  if (amountPaidInput) amountPaidInput.value = "";
  if (paymentMethod) paymentMethod.value = "cash";

  updatePOSTotals();
}

/* =========================================================
   CHECKOUT
========================================================= */

async function checkoutPOS() {
  if (posCart.length === 0) {
    showPOSNotification("Please add items to cart first.", "error");
    return;
  }

  const total = getCartSubtotal();
  const amountPaidInput = document.getElementById("amountPaid");
  const paymentMethodInput = document.getElementById("paymentMethod");

  const amountPaid = Number(amountPaidInput?.value) || 0;
  const paymentMethod = paymentMethodInput?.value || "cash";

  if (amountPaid < total) {
    showPOSNotification("Amount paid is not enough.", "error");
    return;
  }

  try {
    await syncPOSFromFirebaseToLocalStorage();

    const hasEnoughStock = validateCartStock();

    if (!hasEnoughStock) {
      return;
    }

    const saleRecord = createSaleRecord({
      total,
      amountPaid,
      paymentMethod
    });

    deductInventoryStock();

    await updateAllDeductedInventoryInFirebase();

    salesHistory.unshift(saleRecord);

    savePOSSalesHistoryLocalStorage();
    savePOSInventoryLocalStorage();

    syncPOSLowStockItems();
    await syncPOSLowStockItemsToFirebase();

    await savePOSSaleToFirebase(saleRecord);

    const activity = {
      dateTime: new Date().toLocaleString(),
      module: "POS",
      action: "Checkout Completed",
      details: `${saleRecord.salesId} completed with ${saleRecord.itemCount} item(s)`
    };

    await savePOSRecentActivityToFirebase(activity);
    savePOSRecentActivity(activity);

    posCart = [];
    clearPOSPaymentFields();

    await syncPOSFromFirebaseToLocalStorage();

    loadPOSLocalStorage();
    loadCheckoutItemsForPOS();
    renderPOSAvailableItems();
    renderPOSCart();

    showPOSTransactionReceipt(saleRecord);
  } catch (error) {
    console.error("Firebase checkout error:", error);
    showPOSNotification("Failed to complete checkout in Firebase.", "error");
  }
}

function validateCartStock() {
  for (const cartItem of posCart) {
    const inventoryRecord = posInventoryRecordsRaw.find(function (item) {
      return String(item.id) === String(cartItem.sourceInventoryId);
    });

    if (!inventoryRecord) {
      showPOSNotification(`${cartItem.name} was not found in inventory.`, "error");
      return false;
    }

    const currentStock =
      Number(
        inventoryRecord.quantity ??
        inventoryRecord.stock ??
        inventoryRecord.qty ??
        inventoryRecord.itemQuantity ??
        0
      ) || 0;

    if (currentStock < cartItem.quantity) {
      showPOSNotification(`Not enough stock for ${cartItem.name}.`, "error");
      return false;
    }
  }

  return true;
}

function createSaleRecord({ total, amountPaid, paymentMethod }) {
  const now = new Date();
  const saleId = generateSaleId();

  return {
    id: saleId,
    saleId,
    salesId: saleId,
    transactionId: saleId,

    dateTime: now.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }),

    date: formatDateKey(now),

    time: now.toLocaleTimeString("en-PH", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }),

    items: posCart.map(function (item) {
      return {
        id: item.sourceInventoryId || item.latestId || item.id,
        itemKey: item.key || item.id,
        itemName: item.name,
        name: item.name,
        category: item.category,
        unit: item.unit,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity
      };
    }),

    itemCount: posCart.reduce(function (sum, item) {
      return sum + item.quantity;
    }, 0),

    subtotal: total,
    total,
    payment: paymentMethod,
    paymentMethod,
    amountPaid,
    change: amountPaid - total,
    staff: getCurrentPOSUser(),
    status: "Completed",
    createdAt: now.toISOString()
  };
}

function deductInventoryStock() {
  posCart.forEach(function (cartItem) {
    const inventoryRecord = posInventoryRecordsRaw.find(function (item) {
      return String(item.id) === String(cartItem.sourceInventoryId);
    });

    if (!inventoryRecord) return;

    const currentQuantity =
      Number(
        inventoryRecord.quantity ??
        inventoryRecord.stock ??
        inventoryRecord.qty ??
        inventoryRecord.itemQuantity ??
        0
      ) || 0;

    const quantityToDeduct = Number(cartItem.quantity) || 0;
    const newQuantity = Math.max(currentQuantity - quantityToDeduct, 0);

    inventoryRecord.quantity = newQuantity;
    inventoryRecord.stock = newQuantity;
    inventoryRecord.qty = newQuantity;
    inventoryRecord.itemQuantity = newQuantity;
    inventoryRecord.status = getInventoryStatusForPOS(newQuantity);
    inventoryRecord.updatedAt = new Date().toISOString();
  });
}

/* =========================================================
   EVENTS
========================================================= */

function initializePOSEvents() {
  const searchInput = document.getElementById("posSearchInput");
  const categoryFilter = document.getElementById("posCategoryFilter");
  const itemsBody = document.getElementById("posItemsTableBody");
  const cartList = document.getElementById("posCartList");
  const amountPaidInput = document.getElementById("amountPaid");
  const paymentMethod = document.getElementById("paymentMethod");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const cancelCheckoutBtn = document.getElementById("cancelCheckoutBtn");

  if (searchInput) {
    searchInput.addEventListener("input", renderPOSAvailableItems);
  }

  if (categoryFilter) {
    categoryFilter.addEventListener("change", renderPOSAvailableItems);
  }

  if (itemsBody) {
    itemsBody.addEventListener("click", function (event) {
      const addBtn = event.target.closest(".pos-add-btn");
      if (!addBtn) return;

      const itemId = addBtn.dataset.id;
      addItemToCart(itemId);
    });
  }

  if (cartList) {
    cartList.addEventListener("click", function (event) {
      const button = event.target.closest("[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      const itemId = button.dataset.id;

      if (action === "increase") increaseCartItem(itemId);
      if (action === "decrease") decreaseCartItem(itemId);
      if (action === "remove") removeCartItem(itemId);
    });
  }

  if (amountPaidInput) {
    amountPaidInput.addEventListener("input", updatePOSChange);
  }

  if (paymentMethod) {
    paymentMethod.addEventListener("change", updatePOSChange);
  }

  if (cancelCheckoutBtn) {
    cancelCheckoutBtn.addEventListener("click", cancelCheckout);
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", checkoutPOS);
  }
}

/* =========================================================
   POS TRANSACTION RECEIPT MODAL
========================================================= */

function showPOSTransactionReceipt(saleRecord) {
  const modal = document.getElementById("posReceiptModal");
  if (!modal) return;

  const saleIdEl = document.getElementById("receiptSaleId");
  const dateTimeEl = document.getElementById("receiptDateTime");
  const paymentMethodEl = document.getElementById("receiptPaymentMethod");
  const staffEl = document.getElementById("receiptStaff");
  const totalEl = document.getElementById("receiptTotal");
  const amountPaidEl = document.getElementById("receiptAmountPaid");
  const changeEl = document.getElementById("receiptChange");
  const itemsList = document.getElementById("receiptItemsList");

  if (saleIdEl) saleIdEl.textContent = saleRecord.salesId || "-";
  if (dateTimeEl) dateTimeEl.textContent = saleRecord.dateTime || "-";

  if (paymentMethodEl) {
    paymentMethodEl.textContent = String(saleRecord.paymentMethod || "-").toUpperCase();
  }

  if (staffEl) staffEl.textContent = saleRecord.staff || "-";
  if (totalEl) totalEl.textContent = formatPeso(saleRecord.total);
  if (amountPaidEl) amountPaidEl.textContent = formatPeso(saleRecord.amountPaid);
  if (changeEl) changeEl.textContent = formatPeso(saleRecord.change);

  if (itemsList) {
    itemsList.innerHTML = "";

    saleRecord.items.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "pos-receipt-item";

      row.innerHTML = `
        <div>
          <strong>${escapeHtml(item.itemName || item.name)}</strong>
          <small>${formatPeso(item.price)} × ${item.quantity}</small>
        </div>

        <strong>${formatPeso(item.subtotal)}</strong>
      `;

      itemsList.appendChild(row);
    });
  }

  modal.classList.remove("hidden");
}

function initializePOSReceiptEvents() {
  const receiptModal = document.getElementById("posReceiptModal");
  const closeBtn = document.getElementById("closePosReceiptModal");
  const doneBtn = document.getElementById("doneReceiptBtn");
  const printBtn = document.getElementById("printReceiptBtn");

  function closeReceiptModal() {
    if (receiptModal) receiptModal.classList.add("hidden");
  }

  if (closeBtn) closeBtn.addEventListener("click", closeReceiptModal);
if (doneBtn) {
  doneBtn.addEventListener("click", function () {
    closeReceiptModal();

    showPOSNotification("Checkout completed successfully.", "success");

    showPOSLoading();

    setTimeout(function () {
      window.location.reload();
    }, 900);
  });
}

  if (printBtn) {
    printBtn.addEventListener("click", function () {
      window.print();
    });
  }

  if (receiptModal) {
    receiptModal.addEventListener("click", function (event) {
      if (event.target === receiptModal) {
        closeReceiptModal();
      }
    });
  }
}

/* =========================================================
   UTILITIES
========================================================= */

function parseMoney(value) {
  const number = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function formatPeso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPOSQuantity(quantity) {
  const qty = Number(quantity) || 0;

  if (Number.isInteger(qty)) {
    return String(qty);
  }

  return String(qty.toFixed(2)).replace(/\.?0+$/, "");
}

function formatDateKey(date) {
  const manilaDate = new Date(
    date.toLocaleString("en-US", { timeZone: "Asia/Manila" })
  );

  const year = manilaDate.getFullYear();
  const month = String(manilaDate.getMonth() + 1).padStart(2, "0");
  const day = String(manilaDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function generateSaleId() {
  const now = new Date();
  const year = now.getFullYear();

  const existingNumbers = salesHistory
    .map(function (sale) {
      const id = String(sale.salesId || sale.saleId || sale.id || "");
      const match = id.match(/SALE-\d{4}-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(function (number) {
      return !isNaN(number);
    });

  const nextNumber =
    existingNumbers.length === 0 ? 1 : Math.max(...existingNumbers) + 1;

  return `SALE-${year}-${String(nextNumber).padStart(4, "0")}`;
}

function getCurrentPOSUser() {
  const currentPage = window.location.pathname.split("/").pop();

  if (currentPage.startsWith("staff-")) {
    return "Staff";
  }

  return "Admin";
}

function showPOSNotification(message, type = "success") {
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}