const DEFAULT_LOGIN_ACCOUNTS = [
  {
    username: "admin",
    password: "admin123",
    role: "Admin"
  },
  {
    username: "staff",
    password: "staff123",
    role: "Staff"
  }
];

handleLogoutRedirect();
redirectLoggedInUserAwayFromLogin();

document.addEventListener("DOMContentLoaded", function () {
  initializeLoginAccounts();
  initializeLoginForm();
  initializePasswordToggle();
});

window.addEventListener("pageshow", function () {
  redirectLoggedInUserAwayFromLogin();
});

function getDashboardPathByRole(role) {
  if (role === "Admin") {
    return "dashboard.html";
  }

  if (role === "Staff") {
    return "../staff/staff-dashboard.html";
  }

  return "login.html";
}

function handleLogoutRedirect() {
  const params = new URLSearchParams(window.location.search);
  const isLogout = params.get("logout") === "1";

  if (!isLogout) return;

  localStorage.removeItem("furconnectLoggedIn");
  localStorage.removeItem("furconnectUsername");
  localStorage.removeItem("furconnectUserRole");

  sessionStorage.removeItem("furconnectLoggedIn");
  sessionStorage.removeItem("furconnectUsername");
  sessionStorage.removeItem("furconnectUserRole");

  window.history.replaceState({}, document.title, "login.html");
}

function redirectLoggedInUserAwayFromLogin() {
  const params = new URLSearchParams(window.location.search);
  const isLogout = params.get("logout") === "1";

  if (isLogout) return;

  const isLoggedIn = localStorage.getItem("furconnectLoggedIn") === "true";
  const userRole = localStorage.getItem("furconnectUserRole");

  if (!isLoggedIn) return;

  const redirectPath = getDashboardPathByRole(userRole);

  if (redirectPath === "login.html") {
    localStorage.removeItem("furconnectLoggedIn");
    localStorage.removeItem("furconnectUsername");
    localStorage.removeItem("furconnectUserRole");
    return;
  }

  window.location.replace(redirectPath);
}

function initializeLoginAccounts() {
  const savedAccounts = getSavedAccounts();

  if (!savedAccounts || savedAccounts.length === 0) {
    localStorage.setItem("furconnectAccounts", JSON.stringify(DEFAULT_LOGIN_ACCOUNTS));
  }
}

function getSavedAccounts() {
  try {
    return JSON.parse(localStorage.getItem("furconnectAccounts"));
  } catch (error) {
    return null;
  }
}

function initializeLoginForm() {
  const loginForm = document.getElementById("loginForm");

  if (!loginForm) return;

  loginForm.setAttribute("autocomplete", "off");

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();

    const usernameInput = document.getElementById("loginUsername");
    const passwordInput = document.getElementById("loginPassword");
    const roleInput = document.getElementById("loginRole");
    const loginError = document.getElementById("loginError");

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const role = roleInput.value;

    hideLoginError(loginError);

    if (!username || !password || !role) {
      showLoginError(loginError, "Please enter username, password, and role.");
      return;
    }

    const savedAccounts = getSavedAccounts() || DEFAULT_LOGIN_ACCOUNTS;

    const matchedAccount = savedAccounts.find(function (account) {
      return (
        account.username === username &&
        account.password === password &&
        account.role === role
      );
    });

    if (!matchedAccount) {
      showLoginError(loginError, "Invalid username, password, or role.");
      return;
    }

    localStorage.setItem("furconnectLoggedIn", "true");
    localStorage.setItem("furconnectUsername", matchedAccount.username);
    localStorage.setItem("furconnectUserRole", matchedAccount.role);

    loginForm.reset();

    const redirectPath = getDashboardPathByRole(matchedAccount.role);
    window.location.replace(redirectPath);
  });
}

function initializePasswordToggle() {
  const passwordInput = document.getElementById("loginPassword");
  const togglePasswordBtn = document.getElementById("togglePasswordBtn");

  if (!passwordInput || !togglePasswordBtn) return;

  togglePasswordBtn.addEventListener("click", function () {
    const isPassword = passwordInput.type === "password";

    passwordInput.type = isPassword ? "text" : "password";

    togglePasswordBtn.innerHTML = isPassword
      ? '<i class="bi bi-eye-slash"></i>'
      : '<i class="bi bi-eye"></i>';
  });
}

function showLoginError(errorElement, message) {
  if (!errorElement) return;

  errorElement.textContent = message;
  errorElement.classList.remove("hidden");
}

function hideLoginError(errorElement) {
  if (!errorElement) return;

  errorElement.textContent = "";
  errorElement.classList.add("hidden");
}