document.addEventListener("DOMContentLoaded", function () {
  renderInventoryRecords();
  initializeInventoryEvents();
});

/* TEMP DATA — papalitan later ng Firebase */
let inventoryRecords = [];
let selectedInventoryIds = [];
let editingInventoryIndex = null;

let inventoryCurrentFilter = "all";
let inventoryCurrentSort = "";
let inventorySortDirection = "asc";

/* ================= HELPERS ================= */

function getNextInventoryId() {
  if (inventoryRecords.length === 0) return 1;

  return inventoryRecords.reduce((max, item) => {
    return Math.max(max, parseInt(item.id, 10) || 0);
  }, 0) + 1;
}

function getInventoryStatus(quantity) {
  const qty = parseFloat(quantity) || 0;
  return qty <= 5 ? "Low Stock" : "In Stock";
}

function formatInventoryQuantity(quantity) {
  const qty = parseFloat(quantity) || 0;
  return Math.floor(qty);
}

function formatInventoryExpiration(value) {
  if (!value) return "";

  if (value.includes("-")) {
    const [year, month] = value.split("-");
    return `${month}/${year.slice(2)}`;
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

/* ================= RENDER ================= */

function getFilteredInventory() {
  let data = [...inventoryRecords];

  if (inventoryCurrentFilter !== "all") {
    data = data.filter((item) => item.category === inventoryCurrentFilter);
  }

  const searchValue = document.getElementById("inventorySearch")?.value.toLowerCase() || "";

  if (searchValue) {
    data = data.filter((item) => {
      return (
        (item.itemName || "").toLowerCase().includes(searchValue) ||
        (item.itemDescription || "").toLowerCase().includes(searchValue) ||
        (item.category || "").toLowerCase().includes(searchValue) ||
        (item.status || "").toLowerCase().includes(searchValue)
      );
    });
  }

  if (inventoryCurrentSort === "quantity") {
    data.sort((a, b) => {
      const result = Number(a.quantity) - Number(b.quantity);
      return inventorySortDirection === "asc" ? result : -result;
    });
  }

  if (inventoryCurrentSort === "expiration") {
    data.sort((a, b) => {
      const result = (a.expirationDate || "").localeCompare(b.expirationDate || "");
      return inventorySortDirection === "asc" ? result : -result;
    });
  }

  if (inventoryCurrentSort === "status") {
    const order = { "Low Stock": 1, "In Stock": 2 };

    data.sort((a, b) => {
      const result = (order[a.status] || 99) - (order[b.status] || 99);
      return inventorySortDirection === "asc" ? result : -result;
    });
  }

  return data;
}

function renderInventoryRecords() {
  const tableBody = document.getElementById("inventoryTableBody");
  if (!tableBody) return;

  const displayInventory = getFilteredInventory();

  tableBody.innerHTML = "";

  if (displayInventory.length === 0) {
    tableBody.innerHTML = `
      <tr id="emptyInventoryRow">
        <td colspan="8" class="text-center text-muted py-5">
          No inventory records found.
        </td>
      </tr>
    `;
    return;
  }

  displayInventory.forEach((item) => {
    const originalIndex = inventoryRecords.findIndex((record) => record.id === item.id);

    const row = document.createElement("tr");

    row.innerHTML = `
      <td class="checkbox-col">
        <input type="checkbox" class="inventory-checkbox" data-id="${item.id}">
      </td>
      <td>${item.id || ""}</td>
      <td>${item.itemName || ""}</td>
      <td>${item.category || ""}</td>
      <td>${formatInventoryQuantity(item.quantity)}</td>
      <td>${formatInventoryExpiration(item.expirationDate)}</td>
      <td>${item.status || ""}</td>
      <td>
        <button type="button" class="btn btn-sm btn-primary edit-inventory-btn" data-index="${originalIndex}">
          Edit
        </button>
      </td>
    `;

    tableBody.appendChild(row);
  });
}

/* ================= ADD ================= */

function addInventoryItem(event) {
  event.preventDefault();

  const itemName = document.getElementById("itemName")?.value.trim();
  const itemDescription = document.getElementById("itemDescription")?.value.trim();
  const category = document.getElementById("category")?.value;
  const quantity = document.getElementById("quantity")?.value;
  const unit = document.getElementById("unit")?.value;
  const expirationDate = document.getElementById("expirationDate")?.value;

  if (!itemName || !itemDescription || !category || !quantity || !unit || !expirationDate) {
    alert("Please fill in all inventory fields.");
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
    status: getInventoryStatus(quantity)
  };

  inventoryRecords.push(newItem);

  document.getElementById("addInventoryForm")?.reset();
  closeBootstrapModal("addInventoryModal");

  renderInventoryRecords();

  alert("Item added successfully!");
}

/* ================= EDIT ================= */

function openEditInventoryModal(index) {
  const item = inventoryRecords[index];
  if (!item) return;

  editingInventoryIndex = index;

  document.getElementById("editInventoryId").value = item.id || "";
  document.getElementById("editInventoryItemName").value = item.itemName || "";
  document.getElementById("editInventoryItemDescription").value = item.itemDescription || "";
  document.getElementById("editInventoryCategory").value = item.category || "";
  document.getElementById("editInventoryQuantity").value = item.quantity || "";
  document.getElementById("editInventoryUnit").value = item.unit || "";
  document.getElementById("editInventoryExpirationDate").value = item.expirationDate || "";

  const modal = new bootstrap.Modal(document.getElementById("editInventoryModal"));
  modal.show();
}

function updateInventoryItem(event) {
  event.preventDefault();

  if (editingInventoryIndex === null || !inventoryRecords[editingInventoryIndex]) return;

  const itemName = document.getElementById("editInventoryItemName")?.value.trim();
  const itemDescription = document.getElementById("editInventoryItemDescription")?.value.trim();
  const category = document.getElementById("editInventoryCategory")?.value;
  const quantity = document.getElementById("editInventoryQuantity")?.value;
  const unit = document.getElementById("editInventoryUnit")?.value;
  const expirationDate = document.getElementById("editInventoryExpirationDate")?.value;

  if (!itemName || !itemDescription || !category || !quantity || !unit || !expirationDate) {
    alert("Please fill in all inventory fields.");
    return;
  }

  inventoryRecords[editingInventoryIndex] = {
    ...inventoryRecords[editingInventoryIndex],
    itemName,
    itemDescription,
    category,
    quantity,
    unit,
    expirationDate,
    status: getInventoryStatus(quantity)
  };

  closeBootstrapModal("editInventoryModal");

  editingInventoryIndex = null;
  renderInventoryRecords();

  alert("Item updated successfully!");
}

/* ================= REMOVE ================= */

function removeSelectedInventoryItems() {
  const checkedBoxes = document.querySelectorAll(".inventory-checkbox:checked");

  if (checkedBoxes.length === 0) {
    alert("Please select item/s to remove.");
    return;
  }

  const confirmed = confirm("Remove selected inventory item/s?");
  if (!confirmed) return;

  const selectedIds = Array.from(checkedBoxes).map((checkbox) =>
    String(checkbox.dataset.id)
  );

  inventoryRecords = inventoryRecords.filter((item) => {
    return !selectedIds.includes(String(item.id));
  });

  selectedInventoryIds = [];

  const selectAll = document.getElementById("selectAllInventory");
  if (selectAll) selectAll.checked = false;

  renderInventoryRecords();

  alert("Selected item/s removed.");
}

/* ================= EVENTS ================= */

function initializeInventoryEvents() {
  const addInventoryForm = document.getElementById("addInventoryForm");
  const editInventoryForm = document.getElementById("editInventoryForm");
  const removeInventoryBtn = document.getElementById("removeInventoryBtn");
  const inventorySearch = document.getElementById("inventorySearch");
  const selectAllInventory = document.getElementById("selectAllInventory");

  if (addInventoryForm) {
    addInventoryForm.addEventListener("submit", addInventoryItem);
  }

  if (editInventoryForm) {
    editInventoryForm.addEventListener("submit", updateInventoryItem);
  }

  if (removeInventoryBtn) {
    removeInventoryBtn.addEventListener("click", removeSelectedInventoryItems);
  }

  if (inventorySearch) {
    inventorySearch.addEventListener("input", renderInventoryRecords);
  }

  if (selectAllInventory) {
    selectAllInventory.addEventListener("change", function () {
      document.querySelectorAll(".inventory-checkbox").forEach((checkbox) => {
        checkbox.checked = selectAllInventory.checked;
      });
    });
  }

  document.querySelectorAll(".inventory-filter-btn").forEach((button) => {
    button.addEventListener("click", function () {
      document.querySelectorAll(".inventory-filter-btn").forEach((btn) => {
        btn.classList.remove("active");
      });

      button.classList.add("active");
      inventoryCurrentFilter = button.dataset.filter || "all";

      renderInventoryRecords();
    });
  });

  document.querySelectorAll(".sortable-th").forEach((header) => {
    header.addEventListener("click", function () {
      const sortKey = header.dataset.sort;

      if (inventoryCurrentSort === sortKey) {
        inventorySortDirection = inventorySortDirection === "asc" ? "desc" : "asc";
      } else {
        inventoryCurrentSort = sortKey;
        inventorySortDirection = "asc";
      }

      renderInventoryRecords();
    });
  });

  document.addEventListener("click", function (event) {
    const editBtn = event.target.closest(".edit-inventory-btn");

    if (!editBtn) return;

    const index = parseInt(editBtn.dataset.index, 10);
    openEditInventoryModal(index);
  });
}