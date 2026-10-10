document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle-password]');
  if (!toggle) return;
  const input = document.getElementById(toggle.dataset.togglePassword);
  if (!input) return;

  const icon = toggle.querySelector('i');
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  toggle.setAttribute('aria-label', isPassword ? 'Скрыть пароль' : 'Показать пароль');
  if (icon) {
    icon.className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';
  }
});
