/**
 * Кастомное подтверждение вместо window.confirm.
 * nailisConfirm({ title, message, confirmText, cancelText, danger }) → Promise<boolean>
 *
 * Формы: data-confirm / data-confirm-title / data-confirm-message / data-confirm-ok / data-confirm-cancel
 */
(function () {
  const ROOT_ID = "nailisConfirmRoot";

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "nh-confirm-root";
    root.hidden = true;
    root.innerHTML = `
      <div class="nh-confirm-backdrop" data-nh-confirm-cancel></div>
      <div class="nh-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="nhConfirmTitle" aria-describedby="nhConfirmMessage">
        <h2 id="nhConfirmTitle" class="nh-confirm-title"></h2>
        <p id="nhConfirmMessage" class="nh-confirm-message"></p>
        <div class="nh-confirm-actions">
          <button type="button" class="nh-btn secondary" data-nh-confirm-cancel>Отмена</button>
          <button type="button" class="nh-btn primary nh-confirm-ok" data-nh-confirm-ok>Подтвердить</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  function nailisConfirm(options = {}) {
    const {
      title = "Подтвердите действие",
      message = "",
      confirmText = "Удалить",
      cancelText = "Отмена",
      danger = true,
    } = options;

    const root = ensureRoot();
    const titleEl = root.querySelector("#nhConfirmTitle");
    const messageEl = root.querySelector("#nhConfirmMessage");
    const okBtn = root.querySelector("[data-nh-confirm-ok]");
    const cancelBtns = root.querySelectorAll("[data-nh-confirm-cancel]");

    titleEl.textContent = title;
    messageEl.textContent = message;
    messageEl.hidden = !message;
    okBtn.textContent = confirmText;
    okBtn.classList.toggle("is-danger", Boolean(danger));
    cancelBtns.forEach((btn) => {
      if (btn.tagName === "BUTTON") btn.textContent = cancelText;
    });

    root.hidden = false;
    document.body.classList.add("nh-confirm-open");
    okBtn.focus();

    return new Promise((resolve) => {
      const finish = (value) => {
        root.hidden = true;
        document.body.classList.remove("nh-confirm-open");
        root.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKey);
        resolve(value);
      };

      const onClick = (ev) => {
        if (ev.target.closest("[data-nh-confirm-ok]")) {
          finish(true);
          return;
        }
        if (ev.target.closest("[data-nh-confirm-cancel]")) {
          finish(false);
        }
      };

      const onKey = (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          finish(false);
        } else if (ev.key === "Enter") {
          const tag = (ev.target && ev.target.tagName) || "";
          if (tag === "BUTTON") return;
          ev.preventDefault();
          finish(true);
        }
      };

      root.addEventListener("click", onClick);
      document.addEventListener("keydown", onKey);
    });
  }

  function readConfirmOptions(el) {
    if (!el) return null;
    const title =
      el.getAttribute("data-confirm-title") ||
      el.getAttribute("data-confirm") ||
      "";
    const message = el.getAttribute("data-confirm-message") || "";
    if (!title && !message) return null;
    return {
      title: title || "Подтвердите действие",
      message,
      confirmText: el.getAttribute("data-confirm-ok") || "Удалить",
      cancelText: el.getAttribute("data-confirm-cancel") || "Отмена",
      danger: el.getAttribute("data-confirm-danger") !== "0",
    };
  }

  document.addEventListener(
    "submit",
    async (ev) => {
      const form = ev.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.confirmAccepted === "1") {
        delete form.dataset.confirmAccepted;
        return;
      }

      const options =
        readConfirmOptions(form) ||
        readConfirmOptions(ev.submitter) ||
        readConfirmOptions(form.querySelector("[data-confirm], [data-confirm-title]"));
      if (!options) return;

      ev.preventDefault();
      ev.stopPropagation();

      const ok = await nailisConfirm(options);
      if (!ok) return;

      form.dataset.confirmAccepted = "1";
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit(ev.submitter || undefined);
      } else {
        form.submit();
      }
    },
    true
  );

  window.nailisConfirm = nailisConfirm;
})();
