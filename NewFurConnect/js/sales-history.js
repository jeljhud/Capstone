document.addEventListener("DOMContentLoaded", async function () {
  await initializeSalesHistory();
});

/* =========================================================
   SALES HISTORY JS
   FIREBASE + LOCALSTORAGE FALLBACK
   DISPLAYS COMPLETED ITEM CHECKOUTS
========================================================= */

let salesHistoryRecords = [];

/* =========================================================
   LOCAL STORAGE
========================================================= */

const SALES_HISTORY_STORAGE_KEYS = {
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

function loadSalesHistoryLocalStorage() {
  salesHistoryRecords = getLocalStorageArray(
    SALES_HISTORY_STORAGE_KEYS.salesHistory
  );
}

function saveSalesHistoryLocalStorage() {
  setLocalStorageArray(
    SALES_HISTORY_STORAGE_KEYS.salesHistory,
    salesHistoryRecords
  );
}

function saveSalesRecentActivity(activity) {
  const recentActivities = getLocalStorageArray(
    SALES_HISTORY_STORAGE_KEYS.recentActivities
  );

  recentActivities.unshift(activity);

  setLocalStorageArray(
    SALES_HISTORY_STORAGE_KEYS.recentActivities,
    recentActivities
  );
}

/* =========================================================
   FIREBASE
========================================================= */

async function syncSalesHistoryFromFirebaseToLocalStorage() {
  if (!window.db) {
    console.warn("Firestore is not ready. Using localStorage only.");
    loadSalesHistoryLocalStorage();
    return;
  }

  try {
    const snapshot = await window.db.collection("salesHistory").get();

    const firebaseSalesHistory = snapshot.docs.map(function (doc) {
      const data = doc.data();

      return {
        firebaseDocId: doc.id,
        ...data,
        createdAt: normalizeFirebaseDate(data.createdAt),
        updatedAt: normalizeFirebaseDate(data.updatedAt)
      };
    });

    salesHistoryRecords = firebaseSalesHistory.sort(function (a, b) {
      const dateA = getSaleDateObject(a);
      const dateB = getSaleDateObject(b);

      const timeA = dateA ? dateA.getTime() : 0;
      const timeB = dateB ? dateB.getTime() : 0;

      return timeB - timeA;
    });

    setLocalStorageArray(
      SALES_HISTORY_STORAGE_KEYS.salesHistory,
      salesHistoryRecords
    );

    console.log("Firebase sales history loaded:", salesHistoryRecords.length);
  } catch (error) {
    console.error("Firebase sales history load error:", error);
    showSalesNotification("Failed to load sales history from Firebase.", "error");

    loadSalesHistoryLocalStorage();
  }
}

function normalizeFirebaseDate(value) {
  if (!value) return "";

  if (value.toDate) {
    return value.toDate().toISOString();
  }

  return value;
}

async function saveSalesRecentActivityToFirebase(activity) {
  if (!window.db) return;

  await window.db.collection("recentActivities").add({
    ...activity,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/* =========================================================
   INITIALIZE
========================================================= */

async function initializeSalesHistory() {
  const salesPage = document.getElementById("salesHistoryPage");
  if (!salesPage) return;

  await syncSalesHistoryFromFirebaseToLocalStorage();

  loadSalesHistoryLocalStorage();
  createSalesDetailsModal();
  renderSalesHistory();
  initializeSalesHistoryEvents();
}

/* =========================================================
   RENDER
========================================================= */

function renderSalesHistory() {
  loadSalesHistoryLocalStorage();

  const filteredSales = getFilteredSalesRecords();

  renderSalesSummary(filteredSales);
  renderSalesTable(filteredSales);
  renderSalesCount(filteredSales);
}

function renderSalesSummary(records) {
  const totalSalesAmount = document.getElementById("totalSalesAmount");
  const totalTransactions = document.getElementById("totalTransactions");
  const totalItemsSold = document.getElementById("totalItemsSold");

  const totalSales = records.reduce(function (sum, sale) {
    return sum + getSaleTotal(sale);
  }, 0);

  const transactionCount = records.length;

  const unitsSold = records.reduce(function (sum, sale) {
    return sum + getSaleItemCount(sale);
  }, 0);

  if (totalSalesAmount) {
    totalSalesAmount.textContent = formatSalesPeso(totalSales);
  }

  if (totalTransactions) {
    totalTransactions.textContent = transactionCount;
  }

  if (totalItemsSold) {
    totalItemsSold.textContent = unitsSold;
  }
}

function renderSalesTable(records) {
  const tableBody = document.getElementById("salesHistoryTableBody");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (records.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center text-muted py-4">
          No sales history found.
        </td>
      </tr>
    `;
    return;
  }

  records.forEach(function (sale) {
    const saleId = getSaleId(sale);

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeSalesHtml(saleId)}</td>
      <td>${escapeSalesHtml(getSaleDateText(sale))}</td>
      <td>${escapeSalesHtml(getSaleItemsText(sale))}</td>
      <td>${formatSalesPeso(getSaleTotal(sale))}</td>
      <td>${escapeSalesHtml(getSalePayment(sale))}</td>
      <td>${escapeSalesHtml(getSaleStaff(sale))}</td>
      <td>
        <span class="status-badge status-finished">
          ${escapeSalesHtml(getSaleStatus(sale))}
        </span>
      </td>
      <td>
        <button
          type="button"
          class="btn btn-action btn-sm sales-view-btn"
          data-sale-id="${escapeSalesHtml(saleId)}"
        >
          View
        </button>
      </td>
    `;

    tableBody.appendChild(row);
  });
}

function renderSalesCount(records) {
  const countText = document.getElementById("salesCountText");
  if (!countText) return;

  const count = records.length;

  if (count === 0) {
    countText.textContent = "No records";
    return;
  }

  countText.textContent =
    count === 1
      ? "Showing 1 sales transaction"
      : `Showing ${count} sales transactions`;
}

/* =========================================================
   FILTERS
========================================================= */

function getFilteredSalesRecords() {
  const searchValue =
    document.getElementById("salesSearchInput")?.value.toLowerCase().trim() || "";

  const fromDateValue = document.getElementById("salesFromDate")?.value || "";
  const toDateValue = document.getElementById("salesToDate")?.value || "";

  return salesHistoryRecords
    .filter(function (sale) {
      const saleDate = getSaleDateObject(sale);

      let matchesDate = true;

      if (fromDateValue && saleDate) {
        const fromDate = new Date(fromDateValue);
        fromDate.setHours(0, 0, 0, 0);

        matchesDate = matchesDate && saleDate >= fromDate;
      }

      if (toDateValue && saleDate) {
        const toDate = new Date(toDateValue);
        toDate.setHours(23, 59, 59, 999);

        matchesDate = matchesDate && saleDate <= toDate;
      }

      const searchableText = [
        getSaleId(sale),
        getSaleDateText(sale),
        getSaleItemsText(sale),
        getSalePayment(sale),
        getSaleStaff(sale),
        getSaleStatus(sale),
        formatSalesPeso(getSaleTotal(sale))
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        searchValue === "" || searchableText.includes(searchValue);

      return matchesDate && matchesSearch;
    })
    .sort(function (a, b) {
      const dateA = getSaleDateObject(a);
      const dateB = getSaleDateObject(b);

      const timeA = dateA ? dateA.getTime() : 0;
      const timeB = dateB ? dateB.getTime() : 0;

      return timeB - timeA;
    });
}

/* =========================================================
   EVENTS
========================================================= */

function initializeSalesHistoryEvents() {
  const fromDate = document.getElementById("salesFromDate");
  const toDate = document.getElementById("salesToDate");
  const searchInput = document.getElementById("salesSearchInput");
  const exportBtn = document.getElementById("exportSalesBtn");
  const tableBody = document.getElementById("salesHistoryTableBody");

  if (fromDate) {
    fromDate.addEventListener("change", renderSalesHistory);
  }

  if (toDate) {
    toDate.addEventListener("change", renderSalesHistory);
  }

  if (searchInput) {
    searchInput.addEventListener("input", renderSalesHistory);
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", async function () {
      await exportSalesHistoryFile();
    });
  }

  if (tableBody) {
    tableBody.addEventListener("click", function (event) {
      const viewBtn = event.target.closest(".sales-view-btn");
      if (!viewBtn) return;

      const saleId = viewBtn.dataset.saleId;

      const sale = salesHistoryRecords.find(function (record) {
        return getSaleId(record) === saleId;
      });

      if (!sale) {
        showSalesNotification("Transaction not found.", "error");
        return;
      }

      openSalesDetailsModal(sale);
    });
  }
}

/* =========================================================
   SALES DETAILS MODAL
========================================================= */

function createSalesDetailsModal() {
  if (document.getElementById("salesDetailsModal")) return;

  const modal = document.createElement("div");
  modal.id = "salesDetailsModal";
  modal.className = "qr-modal hidden";

  modal.innerHTML = `
    <div class="pos-receipt-modal">
      <button type="button" class="modal-close-x" id="closeSalesDetailsModal">×</button>

      <div class="pos-receipt-header">
        <h3>Sales Transaction</h3>
        <p>Completed item checkout details</p>
      </div>

      <div class="pos-receipt-info">
        <div>
          <span>Sales ID</span>
          <strong id="salesDetailId">-</strong>
        </div>

        <div>
          <span>Date & Time</span>
          <strong id="salesDetailDateTime">-</strong>
        </div>

        <div>
          <span>Payment</span>
          <strong id="salesDetailPayment">-</strong>
        </div>

        <div>
          <span>Staff</span>
          <strong id="salesDetailStaff">-</strong>
        </div>
      </div>

      <div class="pos-receipt-items" id="salesDetailItems"></div>

      <div class="pos-receipt-total">
        <div>
          <span>Total</span>
          <strong id="salesDetailTotal">₱0.00</strong>
        </div>

        <div>
          <span>Amount Paid</span>
          <strong id="salesDetailAmountPaid">₱0.00</strong>
        </div>

        <div>
          <span>Change</span>
          <strong id="salesDetailChange">₱0.00</strong>
        </div>
      </div>

      <div class="pos-receipt-actions">
        <button type="button" class="btn btn-outline-custom" id="printSalesDetailsBtn">
          Print
        </button>

        <button type="button" class="btn btn-primary-custom" id="doneSalesDetailsBtn">
          Done
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = document.getElementById("closeSalesDetailsModal");
  const doneBtn = document.getElementById("doneSalesDetailsBtn");
  const printBtn = document.getElementById("printSalesDetailsBtn");

  if (closeBtn) {
    closeBtn.addEventListener("click", closeSalesDetailsModal);
  }

  if (doneBtn) {
    doneBtn.addEventListener("click", closeSalesDetailsModal);
  }

  if (printBtn) {
    printBtn.addEventListener("click", function () {
      window.print();
    });
  }

  modal.addEventListener("click", function (event) {
    if (event.target === modal) {
      closeSalesDetailsModal();
    }
  });
}

function openSalesDetailsModal(sale) {
  const modal = document.getElementById("salesDetailsModal");
  if (!modal) return;

  const salesDetailId = document.getElementById("salesDetailId");
  const salesDetailDateTime = document.getElementById("salesDetailDateTime");
  const salesDetailPayment = document.getElementById("salesDetailPayment");
  const salesDetailStaff = document.getElementById("salesDetailStaff");
  const salesDetailTotal = document.getElementById("salesDetailTotal");
  const salesDetailAmountPaid = document.getElementById("salesDetailAmountPaid");
  const salesDetailChange = document.getElementById("salesDetailChange");
  const itemsContainer = document.getElementById("salesDetailItems");

  if (salesDetailId) {
    salesDetailId.textContent = getSaleId(sale);
  }

  if (salesDetailDateTime) {
    salesDetailDateTime.textContent = getSaleDateText(sale);
  }

  if (salesDetailPayment) {
    salesDetailPayment.textContent = getSalePayment(sale);
  }

  if (salesDetailStaff) {
    salesDetailStaff.textContent = getSaleStaff(sale);
  }

  if (salesDetailTotal) {
    salesDetailTotal.textContent = formatSalesPeso(getSaleTotal(sale));
  }

  if (salesDetailAmountPaid) {
    salesDetailAmountPaid.textContent = formatSalesPeso(getSaleAmountPaid(sale));
  }

  if (salesDetailChange) {
    salesDetailChange.textContent = formatSalesPeso(getSaleChange(sale));
  }

  if (itemsContainer) {
    renderSalesDetailItems(sale, itemsContainer);
  }

  modal.classList.remove("hidden");
}

function renderSalesDetailItems(sale, container) {
  container.innerHTML = "";

  const items = Array.isArray(sale.items) ? sale.items : [];

  if (items.length === 0) {
    container.innerHTML = `
      <div class="text-muted">
        No item details available.
      </div>
    `;
    return;
  }

  items.forEach(function (item) {
    const itemName = item.itemName || item.name || "Unnamed Item";
    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const subtotal = Number(item.subtotal ?? price * quantity);

    const row = document.createElement("div");
    row.className = "pos-receipt-item";

    row.innerHTML = `
      <div>
        <strong>${escapeSalesHtml(itemName)}</strong>
        <small>${formatSalesPeso(price)} × ${quantity}</small>
      </div>

      <strong>${formatSalesPeso(subtotal)}</strong>
    `;

    container.appendChild(row);
  });
}

function closeSalesDetailsModal() {
  const modal = document.getElementById("salesDetailsModal");

  if (modal) {
    modal.classList.add("hidden");
  }
}

/* =========================================================
   EXPORT
========================================================= */

async function exportSalesHistoryFile() {
  await syncSalesHistoryFromFirebaseToLocalStorage();

  loadSalesHistoryLocalStorage();

  const records = getFilteredSalesRecords();

  if (records.length === 0) {
    showSalesNotification("No sales records to export.", "error");
    return;
  }

  const rows = records.map(function (sale) {
    return {
      "Sales ID": getSaleId(sale),
      Date: getSaleDateText(sale),
      Items: getSaleItemsText(sale),
      Total: getSaleTotal(sale),
      Payment: getSalePayment(sale),
      "Amount Paid": getSaleAmountPaid(sale),
      Change: getSaleChange(sale),
      Staff: getSaleStaff(sale),
      Status: getSaleStatus(sale)
    };
  });

  if (typeof XLSX !== "undefined") {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Sales History");
    XLSX.writeFile(workbook, `furconnect-sales-history-${getTodayKey()}.xlsx`);
  } else {
    exportSalesHistoryCSVRows(rows);
  }

  const activity = {
    dateTime: new Date().toLocaleString(),
    module: "Sales History",
    action: "Exported Sales",
    details: `${records.length} sales transaction(s) exported`
  };

  await saveSalesRecentActivityToFirebase(activity);
  saveSalesRecentActivity(activity);

  showSalesNotification("Sales history exported.", "success");
}

function exportSalesHistoryCSVRows(rows) {
  const headers = Object.keys(rows[0]);

  const csvContent = [
    headers.join(","),
    ...rows.map(function (row) {
      return headers
        .map(function (header) {
          return `"${String(row[header] || "").replaceAll('"', '""')}"`;
        })
        .join(",");
    })
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = `furconnect-sales-history-${getTodayKey()}.csv`;
  link.click();

  URL.revokeObjectURL(link.href);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

/* =========================================================
   GETTER HELPERS
========================================================= */

function getSaleId(sale) {
  return String(
    sale.salesId ||
    sale.saleId ||
    sale.id ||
    sale.transactionId ||
    "-"
  );
}

function getSaleDateText(sale) {
  return String(
    sale.dateTime ||
    sale.datetime ||
    sale.date ||
    sale.createdAt ||
    "-"
  );
}

function getSaleDateObject(sale) {
  if (sale.date) {
    const dateOnly = new Date(sale.date);

    if (!Number.isNaN(dateOnly.getTime())) {
      dateOnly.setHours(0, 0, 0, 0);
      return dateOnly;
    }
  }

  const rawDate =
    sale.createdAt ||
    sale.dateTime ||
    sale.datetime ||
    sale.date ||
    "";

  if (!rawDate) return null;

  const parsedDate = new Date(rawDate);

  if (Number.isNaN(parsedDate.getTime())) return null;

  return parsedDate;
}

function getSaleItemsText(sale) {
  const items = Array.isArray(sale.items) ? sale.items : [];

  if (items.length === 0) {
    return sale.itemName || "-";
  }

  return items
    .map(function (item) {
      const name = item.itemName || item.name || "Item";
      const quantity = Number(item.quantity || 0);

      return `${name} (${quantity})`;
    })
    .join(", ");
}

function getSaleTotal(sale) {
  return Number(
    sale.total ??
    sale.grandTotal ??
    sale.subtotal ??
    sale.amount ??
    0
  );
}

function getSaleAmountPaid(sale) {
  return Number(
    sale.amountPaid ??
    sale.paid ??
    getSaleTotal(sale)
  );
}

function getSaleChange(sale) {
  return Number(
    sale.change ??
    Math.max(getSaleAmountPaid(sale) - getSaleTotal(sale), 0)
  );
}

function getSalePayment(sale) {
  return String(
    sale.paymentMethod ||
    sale.payment ||
    "-"
  ).toUpperCase();
}

function getSaleStaff(sale) {
  return String(
    sale.staff ||
    sale.cashier ||
    sale.user ||
    "-"
  );
}

function getSaleStatus(sale) {
  return String(
    sale.status ||
    "Completed"
  );
}

function getSaleItemCount(sale) {
  const items = Array.isArray(sale.items) ? sale.items : [];

  if (items.length === 0) {
    return Number(sale.itemCount || sale.quantity || 0);
  }

  return items.reduce(function (sum, item) {
    return sum + Number(item.quantity || 0);
  }, 0);
}

/* =========================================================
   UTILITIES
========================================================= */

function formatSalesPeso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function showSalesNotification(message, type = "success") {
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

function escapeSalesHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}