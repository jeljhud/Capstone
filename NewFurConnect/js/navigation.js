document.addEventListener("DOMContentLoaded", function () {
  initializeSidebarDropdowns();
  initializeLogoutButton();
});

function initializeSidebarDropdowns() {
  const dropdowns = document.querySelectorAll(".appointment-nav-dropdown");

  dropdowns.forEach((dropdown) => {
    const button = dropdown.querySelector(".appointment-main-btn");

    if (!button) return;

    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = dropdown.classList.contains("open");

      dropdowns.forEach((item) => {
        item.classList.remove("open");
      });

      if (!isOpen) {
        dropdown.classList.add("open");
      }
    });

    dropdown.addEventListener("click", function (event) {
      event.stopPropagation();
    });
  });

  document.addEventListener("click", function () {
    dropdowns.forEach((dropdown) => {
      dropdown.classList.remove("open");
    });
  });
}

function initializeLogoutButton() {
  const logoutBtn = document.getElementById("logoutBtn");

  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", function () {
    localStorage.removeItem("furconnectLoggedIn");
  });
}