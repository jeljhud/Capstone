document.addEventListener("DOMContentLoaded", function () {
  initializeLoginAccount();
  initializeLoginForm();
  initializePasswordToggle();
});

const DEFAULT_LOGIN_ACCOUNT = {
  username: "admin",
  password: "admin123"
};

function initializeLoginAccount() {
  const savedAccount = JSON.parse(localStorage.getItem("furconnectAccount"));

  if (!savedAccount) {
    localStorage.setItem("furconnectAccount", JSON.stringify(DEFAULT_LOGIN_ACCOUNT));
  }
}

function initializeLoginForm() {
  const loginForm = document.getElementById("loginForm");

  if (!loginForm) return;

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();

    const username = document.getElementById("loginUsername")?.value.trim();
    const password = document.getElementById("loginPassword")?.value.trim();
    const loginError = document.getElementById("loginError");

    const savedAccount =
      JSON.parse(localStorage.getItem("furconnectAccount")) || DEFAULT_LOGIN_ACCOUNT;

    if (username === savedAccount.username && password === savedAccount.password) {
      localStorage.setItem("furconnectLoggedIn", "true");
      window.location.href = "dashboard.html";
      return;
    }

    if (loginError) {
      loginError.textContent = "Invalid username or password.";
      loginError.classList.remove("hidden");
    }
  });
}

function initializePasswordToggle() {
  const passwordInput = document.getElementById("loginPassword");
  const togglePasswordBtn = document.getElementById("togglePasswordBtn");

  if (!passwordInput || !togglePasswordBtn) return;

  togglePasswordBtn.addEventListener("click", function () {
    const isPassword = passwordInput.type === "password";

    passwordInput.type = isPassword ? "text" : "password";
    togglePasswordBtn.textContent = isPassword ? "Hide" : "Show";
  });
}