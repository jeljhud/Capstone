document.addEventListener("DOMContentLoaded", function () {
  addSidebarRoleLabel();

  initializeNavigationDropdowns();
  initializeLogoutButton();
  keepCurrentDropdownOpen();

  createPageTransitionLoader();
  initializePageTransitionLinks();
  removeSidebarFocusFlash();

  document.body.classList.add("nav-ready");
});

/* =========================================================
   SIDEBAR DROPDOWNS
========================================================= */

function initializeNavigationDropdowns() {
  const dropdowns = document.querySelectorAll(".appointment-nav-dropdown");

  dropdowns.forEach(function (dropdown) {
    const button = dropdown.querySelector(".appointment-main-btn");

    if (!button) return;

    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = dropdown.classList.contains("open");

      dropdowns.forEach(function (item) {
        item.classList.remove("open");
      });

      if (!isOpen) {
        dropdown.classList.add("open");
      }

      button.blur();
    });

    dropdown.addEventListener("click", function (event) {
      event.stopPropagation();
    });
  });

  document.addEventListener("click", function () {
    dropdowns.forEach(function (dropdown) {
      dropdown.classList.remove("open");
    });

    keepCurrentDropdownOpen();
  });
}

/* =========================================================
   KEEP CURRENT DROPDOWN OPEN
========================================================= */

function keepCurrentDropdownOpen() {
  const currentPath = window.location.pathname.split("/").pop();
  const dropdowns = document.querySelectorAll(".appointment-nav-dropdown");

  dropdowns.forEach(function (dropdown) {
    const links = dropdown.querySelectorAll(".dropdown-link-btn");

    links.forEach(function (link) {
      const linkPath = link.getAttribute("href");

      if (linkPath === currentPath) {
        dropdown.classList.add("open");
        link.classList.add("active");
      }
    });
  });
}

/* =========================================================
   LOGOUT
========================================================= */

function initializeLogoutButton() {
  const logoutBtn = document.getElementById("logoutBtn");

  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", function (event) {
    event.preventDefault();

    showPageLoader();

    localStorage.removeItem("furconnectLoggedIn");
    localStorage.removeItem("furconnectUsername");
    localStorage.removeItem("furconnectUserRole");

    sessionStorage.removeItem("furconnectLoggedIn");
    sessionStorage.removeItem("furconnectUsername");
    sessionStorage.removeItem("furconnectUserRole");

    setTimeout(function () {
      window.location.replace("/html/login.html?logout=1");
    }, 220);
  });
}

/* =========================================================
   ADMIN / STAFF PANEL LABEL
========================================================= */

function addSidebarRoleLabel() {
  const brandWrap = document.querySelector(".brand-wrap");
  if (!brandWrap) return;

  if (brandWrap.querySelector(".sidebar-role-label")) return;

  const currentPage = window.location.pathname.split("/").pop();
  const isStaffPage = currentPage.startsWith("staff-");

  const roleText = isStaffPage ? "Staff Panel" : "Admin Panel";

  const roleLabel = document.createElement("div");
  roleLabel.className = "sidebar-role-label";
  roleLabel.innerHTML = `
    <i class="bi bi-person-badge me-1"></i>
    ${roleText}
  `;

  brandWrap.appendChild(roleLabel);
}

/* =========================================================
   PAGE TRANSITION LOADER
========================================================= */

function createPageTransitionLoader() {
  if (document.querySelector(".page-transition-loader")) return;

  const loader = document.createElement("div");
  loader.className = "page-transition-loader";
  loader.innerHTML = `
    <div class="loader-card">
      <div class="loader-spinner"></div>
      <span>Loading...</span>
    </div>
  `;

  document.body.appendChild(loader);
}

function showPageLoader() {
  document.body.classList.add("page-loading");
}

function initializePageTransitionLinks() {
  const pageLinks = document.querySelectorAll(
    ".sidebar a[href], .quicklink-card[href]"
  );

  let isNavigating = false;

  pageLinks.forEach(function (link) {
    link.addEventListener("click", function (event) {
      const href = link.getAttribute("href");

      if (!href) return;
      if (link.id === "logoutBtn") return;
      if (href.startsWith("#")) return;
      if (href.startsWith("javascript:")) return;
      if (link.target === "_blank") return;
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;

      event.preventDefault();

      if (isNavigating) return;
      isNavigating = true;

      link.blur();
      showPageLoader();

      setTimeout(function () {
        window.location.href = href;
      }, 220);
    });
  });
}

/* =========================================================
   REMOVE CLICK FOCUS FLASH ONLY
========================================================= */

function removeSidebarFocusFlash() {
  const clickableItems = document.querySelectorAll(
    ".sidebar a, .sidebar button, .quicklink-card"
  );

  clickableItems.forEach(function (item) {
    item.addEventListener("click", function () {
      setTimeout(function () {
        item.blur();
      }, 0);
    });
  });
}