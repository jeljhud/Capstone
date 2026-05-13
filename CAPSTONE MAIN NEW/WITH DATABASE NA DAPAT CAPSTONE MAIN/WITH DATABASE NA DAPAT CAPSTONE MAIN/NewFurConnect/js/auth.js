(function () {
  const publicPages = [
    "furconnect.html",
    "login.html"
  ];

  const currentPage = window.location.pathname.split("/").pop().toLowerCase();

  const allowedPatientQrPages = [
    "records.html",
    "staff-records.html"
  ];

  const params = new URLSearchParams(window.location.search);

  const PUBLIC_PATIENT_QR_VIEW =
    allowedPatientQrPages.includes(currentPage) &&
    params.get("view") === "patient" &&
    params.get("id") &&
    params.get("id").trim() !== "";

  if (PUBLIC_PATIENT_QR_VIEW) {
    window.FURCONNECT_PUBLIC_PATIENT_QR_VIEW = true;
  }

  const isPublicPage = publicPages.includes(currentPage);

  function isLoggedIn() {
    return (
      localStorage.getItem("furconnectLoggedIn") === "true" ||
      sessionStorage.getItem("furconnectLoggedIn") === "true"
    );
  }

  function getLoginPath() {
    return "/html/login.html";
  }

  function protectPage() {
    if (isPublicPage) return;

    // Allow QR patient page without admin login
    if (PUBLIC_PATIENT_QR_VIEW) return;

    if (!isLoggedIn()) {
      window.location.replace(getLoginPath());
    }
  }

  protectPage();

  window.addEventListener("pageshow", protectPage);
  window.addEventListener("load", protectPage);
  window.addEventListener("focus", protectPage);
  window.addEventListener("popstate", protectPage);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      protectPage();
    }
  });
})();