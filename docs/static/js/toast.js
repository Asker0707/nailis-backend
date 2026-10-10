/**
 * Глобальные тосты: nailisToast.success/error/info(message, { timeout })
 * Читает flash cookies flash_success / flash_error.
 */
(function () {
  const HOST_ID = "nailisToastHost";

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.className = "nh-toast-host";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-relevant", "additions");
    document.body.appendChild(host);
    return host;
  }

  function readCookie(name) {
    const parts = `; ${document.cookie}`.split(`; ${name}=`);
    if (parts.length !== 2) return "";
    return decodeURIComponent(parts.pop().split(";").shift() || "");
  }

  function clearCookie(name) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
  }

  function nailisToast(message, options = {}) {
    const text = String(message || "").trim();
    if (!text) return;
    const type = options.type || "info";
    const timeout = Number.isFinite(options.timeout) ? options.timeout : 4200;
    const host = ensureHost();

    const el = document.createElement("div");
    el.className = `nh-toast nh-toast--${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.innerHTML = `
      <span class="nh-toast-text"></span>
      <button type="button" class="nh-toast-close" aria-label="Закрыть">×</button>
    `;
    el.querySelector(".nh-toast-text").textContent = text;
    host.appendChild(el);

    requestAnimationFrame(() => el.classList.add("is-visible"));

    const close = () => {
      el.classList.remove("is-visible");
      el.classList.add("is-hiding");
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector(".nh-toast-close")?.addEventListener("click", close);
    if (timeout > 0) setTimeout(close, timeout);
  }

  nailisToast.success = (message, opts) => nailisToast(message, { ...opts, type: "success" });
  nailisToast.error = (message, opts) => nailisToast(message, { ...opts, type: "error" });
  nailisToast.info = (message, opts) => nailisToast(message, { ...opts, type: "info" });

  function showFlashToasts() {
    const success = readCookie("flash_success");
    const error = readCookie("flash_error");
    if (success) {
      nailisToast.success(success);
      clearCookie("flash_success");
    }
    if (error) {
      nailisToast.error(error);
      clearCookie("flash_error");
    }
  }

  window.nailisToast = nailisToast;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showFlashToasts);
  } else {
    showFlashToasts();
  }
})();
