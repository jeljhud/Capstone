document.addEventListener("DOMContentLoaded", function () {
  const splashPage = document.getElementById("splashPage");

  if (!splashPage) return;

  splashPage.addEventListener("click", function () {
    const isLoggedIn = localStorage.getItem("furconnectLoggedIn") === "true";

    if (isLoggedIn) {
      window.location.replace("html/dashboard.html");
      return;
    }

    window.location.replace("html/login.html");
  });
});