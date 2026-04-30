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

      dropdowns.forEach((item) => {
        if (item !== dropdown) {
          item.classList.remove("open");
        }
      });

      dropdown.classList.toggle("open");
    });
  });

  document.addEventListener("click", function () {
    dropdowns.forEach((dropdown) => {
      dropdown.classList.remove("open");
    });
  });

  dropdowns.forEach((dropdown) => {
    dropdown.addEventListener("click", function (event) {
      event.stopPropagation();
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