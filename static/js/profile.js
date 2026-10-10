function toast(type, message) {
  if (window.nailisToast && typeof window.nailisToast[type] === 'function') {
    window.nailisToast[type](message);
    return;
  }
  if (type === 'error') alert(message);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function bindProfileSettingsForm() {
  const form = document.getElementById('profileSettingsForm');
  if (!form) return;
  const statusEl = document.getElementById('profileSettingsStatus');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData();
    formData.append('full_name', form.full_name.value || '');
    formData.append('telegram', form.telegram.value || '');
    formData.append('remove_avatar', form.remove_avatar.checked ? 'true' : 'false');
    const file = form.avatar.files?.[0];
    if (file) {
      formData.append('avatar', file);
    }

    if (statusEl) {
      statusEl.textContent = 'Сохраняем...';
      statusEl.classList.remove('error');
    }
    if (submitBtn) submitBtn.disabled = true;

    try {
      const response = await fetch('/api/profile/settings', {
        method: 'PUT',
        body: formData,
        credentials: 'same-origin',
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload.detail || 'Не удалось сохранить настройки';
        throw new Error(detail);
      }
      if (statusEl) {
        statusEl.textContent = payload.detail || 'Сохранено';
        statusEl.classList.remove('error');
      }
      toast('success', payload.detail || 'Настройки сохранены');
      await loadProfile();
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = error.message || 'Ошибка при сохранении';
        statusEl.classList.add('error');
      }
      toast('error', error.message || 'Ошибка при сохранении');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function bindPasswordForm() {
  const form = document.getElementById('profilePasswordForm');
  if (!form) return;
  const statusEl = document.getElementById('profilePasswordStatus');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);

    if (statusEl) {
      statusEl.textContent = 'Обновляем пароль...';
      statusEl.classList.remove('error');
    }
    if (submitBtn) submitBtn.disabled = true;

    try {
      const response = await fetch('/api/profile/password', {
        method: 'PUT',
        body: formData,
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(payload.detail)
          ? payload.detail.map((item) => item.msg || item).join(', ')
          : (payload.detail || 'Не удалось сменить пароль');
        throw new Error(detail);
      }
      form.reset();
      if (statusEl) {
        statusEl.textContent = payload.detail || 'Пароль обновлён';
        statusEl.classList.remove('error');
      }
      toast('success', payload.detail || 'Пароль обновлён');
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = error.message || 'Ошибка при смене пароля';
        statusEl.classList.add('error');
      }
      toast('error', error.message || 'Ошибка при смене пароля');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

async function loadProfile() {
  const target = document.getElementById('profile-content');

  try {
    const res = await fetch('/api/profile_data', { credentials: 'same-origin' });
    if (!res.ok) {
      window.location.href = '/auth/login';
      return;
    }

    const data = await res.json();
    const fullName = data.full_name || 'Пользователь';
    const initials = fullName
      .split(' ')
      .map((part) => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const avatarMarkup = data.avatar_url
      ? `<img class="profile-avatar-image" src="${escapeHtml(data.avatar_url)}" alt="Аватар пользователя">`
      : `${escapeHtml(initials || 'U')}`;

    const telegramValue = escapeHtml(data.telegram || '');
    const joinedAt = escapeHtml(data.joined_at || '');
    const email = escapeHtml(data.email || '');

    target.innerHTML = `
      <section class="hero-card profile-reveal" style="--delay: 30ms;">
        <div>
          <div class="hero-kicker">Профиль студента</div>
          <h1 class="hero-title">${escapeHtml(fullName)}</h1>
          <p class="hero-subtitle">Личные данные аккаунта и настройки. Прогресс обучения смотрите в кабинете.</p>
          <div class="hero-meta">
            <span class="hero-pill"><strong>Email:</strong> ${email || '--'}</span>
            <span class="hero-pill"><strong>На платформе:</strong> ${joinedAt || '--'}</span>
            <span class="hero-pill"><strong>Telegram:</strong> ${telegramValue || 'не указан'}</span>
          </div>
        </div>

        <aside class="hero-side">
          <div class="avatar-card">
            <div class="profile-avatar">${avatarMarkup}</div>
            <p class="avatar-name">${escapeHtml(fullName)}</p>
            <div class="avatar-email">${email || '--'}</div>
          </div>
        </aside>
      </section>

      <div class="profile-layout">
        <div class="profile-main">
          <section class="settings-card" style="--delay: 90ms;">
            <div class="section-head">
              <div>
                <span class="section-chip">Настройки</span>
                <h2>Редактирование профиля</h2>
                <p>Измените данные аккаунта и сохраните актуальную информацию о себе.</p>
              </div>
            </div>

            <form id="profileSettingsForm">
              <div class="settings-grid">
                <div class="settings-group">
                  <label class="settings-label" for="profileFullName">Имя</label>
                  <input id="profileFullName" name="full_name" class="settings-input" value="${escapeHtml(fullName)}" required>
                </div>
                <div class="settings-group">
                  <label class="settings-label" for="profileTelegram">Telegram</label>
                  <input id="profileTelegram" name="telegram" class="settings-input" value="${telegramValue}" placeholder="@username">
                </div>
                <div class="settings-group">
                  <label class="settings-label" for="profileAvatar">Аватар</label>
                  <input id="profileAvatar" name="avatar" type="file" accept="image/*" class="settings-file">
                </div>
              </div>
              <div class="settings-row">
                <label class="settings-check">
                  <input type="checkbox" name="remove_avatar">
                  Удалить текущий аватар
                </label>
                <button type="submit" class="settings-save-btn">Сохранить настройки</button>
              </div>
              <div class="settings-status" id="profileSettingsStatus"></div>
            </form>
          </section>

          <section class="settings-card" style="--delay: 120ms;">
            <div class="section-head">
              <div>
                <span class="section-chip">Безопасность</span>
                <h2>Смена пароля</h2>
                <p>Введите текущий пароль и задайте новый.</p>
              </div>
            </div>

            <form id="profilePasswordForm">
              <div class="settings-grid">
                <div class="settings-group">
                  <label class="settings-label" for="currentPassword">Текущий пароль</label>
                  <input id="currentPassword" name="current_password" type="password" class="settings-input" autocomplete="current-password" required>
                </div>
                <div class="settings-group">
                  <label class="settings-label" for="newPassword">Новый пароль</label>
                  <input id="newPassword" name="new_password" type="password" class="settings-input" autocomplete="new-password" minlength="8" required>
                </div>
                <div class="settings-group">
                  <label class="settings-label" for="confirmPassword">Повтор нового пароля</label>
                  <input id="confirmPassword" name="confirm_password" type="password" class="settings-input" autocomplete="new-password" minlength="8" required>
                </div>
              </div>
              <div class="settings-row">
                <button type="submit" class="settings-save-btn">Обновить пароль</button>
              </div>
              <div class="settings-status" id="profilePasswordStatus"></div>
            </form>
          </section>
        </div>
      </div>
    `;

    bindProfileSettingsForm();
    bindPasswordForm();
  } catch (err) {
    console.error('profile load failed', err);
    target.innerHTML = `
      <div class="profile-loading">
        <div class="profile-loading-card profile-reveal" style="--delay: 20ms;">
          <p class="mb-1" style="color:#24242a; font-weight:600;">Не удалось загрузить профиль</p>
          <p class="mb-0" style="color:#8f7668;">Обновите страницу или войдите заново.</p>
        </div>
      </div>
    `;
  }
}

loadProfile();
