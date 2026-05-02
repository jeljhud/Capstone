document.addEventListener("DOMContentLoaded", function () {
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
    info: "#0f6d7a"
  };

  notif.style.background = colors[type] || colors.success;

  container.appendChild(notif);

  setTimeout(() => {
    notif.classList.add("hide");

    setTimeout(() => {
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
                Remove
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
  return new Promise((resolve) => {
    createInventoryConfirmModal();

    const modalElement = document.getElementById("inventoryConfirmModal");
    const messageElement = document.getElementById("inventoryConfirmMessage");
    const yesButton = document.getElementById("inventoryConfirmYesBtn");

    if (!modalElement || !messageElement || !yesButton || !window.bootstrap) {
      resolve(false);
      return;
    }

    messageElement.textContent = message;

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

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function syncInventorySelection(id, isSelected) {
  const itemId = String(id || "");

  if (!itemId) return;

  if (isSelected) {
    if (!selectedInventoryIds.includes(itemId)) {
      selectedInventoryIds.push(itemId);
    }
  } else {
    selectedInventoryIds = selectedInventoryIds.filter((selectedId) => {
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

  const checkedBoxes = document.querySelectorAll(".inventory-checkbox:checked");

  if (!allowSelectAllChecked) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  selectAll.checked = checkedBoxes.length === checkboxes.length;
  selectAll.indeterminate =
    checkedBoxes.length > 0 && checkedBoxes.length < checkboxes.length;
}
/* ================= FILTER / SORT ================= */

function getFilteredInventory() {
  let data = [...inventoryRecords];

  if (inventoryCurrentFilter !== "all") {
    data = data.filter((item) => item.category === inventoryCurrentFilter);
  }

  const searchValue =
    document.getElementById("inventorySearch")?.value.toLowerCase() || "";

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
      const result = (a.expirationDate || "").localeCompare(
        b.expirationDate || ""
      );

      return inventorySortDirection === "asc" ? result : -result;
    });
  }

  if (inventoryCurrentSort === "status") {
    const order = {
      "Low Stock": 1,
      "In Stock": 2
    };

    data.sort((a, b) => {
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

  tableBody.innerHTML = "";

  if (displayInventory.length === 0) {
    tableBody.innerHTML = `
      <tr id="emptyInventoryRow">
        <td colspan="8" class="text-center text-muted py-5">
          No inventory records found.
        </td>
      </tr>
    `;

updateSelectAllInventoryState(true);
    return;
  }

  displayInventory.forEach((item) => {
    const originalIndex = inventoryRecords.findIndex((record) => {
      return String(record.id) === String(item.id);
    });

    const itemId = String(item.id);
    const isSelected = selectedInventoryIds.includes(itemId);

    const row = document.createElement("tr");
    row.dataset.inventoryRowId = itemId;

    if (isSelected) {
      row.classList.add("selected-record");
    }

    row.innerHTML = `
      <td class="checkbox-col">
        <input 
          type="checkbox" 
          class="inventory-checkbox" 
          data-id="${escapeHTML(item.id)}"
          ${isSelected ? "checked" : ""}
        >
      </td>

      <td>${escapeHTML(item.id)}</td>
      <td>${escapeHTML(item.itemName)}</td>
      <td>${escapeHTML(item.category)}</td>
      <td>${escapeHTML(formatInventoryQuantity(item.quantity))} ${escapeHTML(item.unit)}</td>
      <td>${escapeHTML(formatInventoryExpiration(item.expirationDate))}</td>

      <td>
        <span class="status-badge ${
          item.status === "Low Stock" ? "status-low" : "status-active"
        }">
          ${escapeHTML(item.status)}
        </span>
      </td>

      <td>
        <button 
          type="button" 
          class="btn btn-sm btn-primary edit-inventory-btn" 
          data-index="${originalIndex}"
        >
          Edit
        </button>
      </td>
    `;

    tableBody.appendChild(row);
  });

  updateSelectAllInventoryState();
}

/* ================= ADD ================= */

function addInventoryItem(event) {
  event.preventDefault();

  const itemName = document.getElementById("itemName")?.value.trim();
  const itemDescription = document
    .getElementById("itemDescription")
    ?.value.trim();
  const category = document.getElementById("category")?.value;
  const quantity = document.getElementById("quantity")?.value;
  const unit = document.getElementById("unit")?.value;
  const expirationDate = document.getElementById("expirationDate")?.value;

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
    status: getInventoryStatus(quantity)
  };

  inventoryRecords.push(newItem);

  document.getElementById("addInventoryForm")?.reset();
  closeBootstrapModal("addInventoryModal");

  renderInventoryRecords();

  showNotification("Item added successfully!", "success");
}

/* ================= EDIT ================= */

function openEditInventoryModal(index) {
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

  const modal = new bootstrap.Modal(
    document.getElementById("editInventoryModal")
  );

  modal.show();
}

function updateInventoryItem(event) {
  event.preventDefault();

  if (
    editingInventoryIndex === null ||
    !inventoryRecords[editingInventoryIndex]
  ) {
    return;
  }

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

  showNotification("Item updated successfully!", "success");
}

/* ================= REMOVE ================= */

async function removeSelectedInventoryItems() {
  const checkedBoxes = document.querySelectorAll(".inventory-checkbox:checked");

  if (checkedBoxes.length === 0 && selectedInventoryIds.length === 0) {
    showNotification("Please select item/s to remove.", "warning");
    return;
  }

  const confirmed = await showInventoryConfirm(
    "Remove selected inventory item/s?"
  );

  if (!confirmed) return;

  const selectedIds =
    selectedInventoryIds.length > 0
      ? [...selectedInventoryIds]
      : Array.from(checkedBoxes).map((checkbox) => String(checkbox.dataset.id));

  inventoryRecords = inventoryRecords.filter((item) => {
    return !selectedIds.includes(String(item.id));
  });

  selectedInventoryIds = [];

  const selectAll = document.getElementById("selectAllInventory");

  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }

  renderInventoryRecords();

  showNotification("Selected item/s removed.", "success");
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

      syncInventorySelection(checkbox.dataset.id, checkbox.checked);

      const row = checkbox.closest("tr");

      if (row) {
        row.classList.toggle("selected-record", checkbox.checked);
      }
    });

    updateSelectAllInventoryState(true);
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
        inventorySortDirection =
          inventorySortDirection === "asc" ? "desc" : "asc";
      } else {
        inventoryCurrentSort = sortKey;
        inventorySortDirection = "asc";
      }

      document.querySelectorAll(".sortable-th").forEach((th) => {
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

    updateSelectAllInventoryState();
  });

  document.addEventListener("click", function (event) {
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

    updateSelectAllInventoryState();
  });
}