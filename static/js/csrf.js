(() => {
  const COOKIE_NAME = 'csrf_token';
  const HEADER_NAME = 'X-CSRF-Token';
  const FIELD_NAME = 'csrf_token';

  const readCookie = (name) => {
    const parts = `; ${document.cookie}`.split(`; ${name}=`);
    if (parts.length === 2) {
      return decodeURIComponent(parts.pop().split(';').shift() || '');
    }
    return '';
  };

  const getToken = () => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const fromMeta = meta?.getAttribute('content') || '';
    return fromMeta || readCookie(COOKIE_NAME) || '';
  };

  const syncMeta = () => {
    const token = getToken();
    let meta = document.querySelector('meta[name="csrf-token"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'csrf-token');
      document.head.appendChild(meta);
    }
    if (token) meta.setAttribute('content', token);
    return token;
  };

  const injectForms = () => {
    const token = syncMeta();
    if (!token) return;
    document.querySelectorAll('form').forEach((form) => {
      const method = (form.getAttribute('method') || 'get').toLowerCase();
      if (method !== 'post') return;
      let input = form.querySelector(`input[name="${FIELD_NAME}"]`);
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = FIELD_NAME;
        form.prepend(input);
      }
      input.value = token;
    });
  };

  // fetch/XHR APIs: всегда добавляем CSRF-заголовок
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const token = syncMeta();
    const nextInit = { ...init };
    const headers = new Headers(nextInit.headers || {});
    if (token && !headers.has(HEADER_NAME)) {
      headers.set(HEADER_NAME, token);
    }
    nextInit.headers = headers;
    if (nextInit.credentials == null) {
      nextInit.credentials = 'same-origin';
    }
    return originalFetch(input, nextInit);
  };

  // Перед submit ещё раз проставляем токен в hidden-поле
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if ((form.getAttribute('method') || 'get').toLowerCase() !== 'post') return;
    injectForms();
  }, true);

  window.NailisCsrf = {
    getToken,
    injectForms,
    headerName: HEADER_NAME,
    fieldName: FIELD_NAME,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectForms);
  } else {
    injectForms();
  }
})();
