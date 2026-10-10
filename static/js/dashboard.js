function toast(type, message) {
  if (window.nailisToast && typeof window.nailisToast[type] === 'function') {
    window.nailisToast[type](message);
    return;
  }
  if (type === 'error') alert(message);
}

document.addEventListener('click', async (event) => {
  const editBtn = event.target.closest('.js-edit-note-btn');
  if (editBtn) {
    event.preventDefault();
    startDashboardNoteEdit(editBtn);
    return;
  }

  const cancelBtn = event.target.closest('.js-cancel-note-edit');
  if (cancelBtn) {
    event.preventDefault();
    const card = cancelBtn.closest('.note-item-card');
    if (card) cancelDashboardNoteEdit(card);
    return;
  }

  const saveBtn = event.target.closest('.js-save-note-edit');
  if (saveBtn) {
    event.preventDefault();
    await saveDashboardNoteEdit(saveBtn);
    return;
  }

  const btn = event.target.closest('.js-delete-note-btn');
  if (!btn) return;

  event.preventDefault();
  const noteId = btn.dataset.noteId;
  const lessonId = btn.dataset.lessonId;
  if (!noteId || !lessonId) return;

  const confirmed = window.nailisConfirm
    ? await window.nailisConfirm({
        title: 'Удалить заметку?',
        message: 'Запись исчезнет из кабинета и урока. Это действие нельзя отменить.',
        confirmText: 'Удалить',
        cancelText: 'Оставить',
        danger: true,
      })
    : window.confirm('Удалить заметку?');
  if (!confirmed) return;

  const card = document.getElementById(`note-card-${noteId}`);
  if (card) card.classList.add('note-deleting');
  btn.disabled = true;

  try {
    const response = await fetch(`/lessons/${lessonId}/note/${noteId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`delete_failed_${response.status}`);
    }

    if (card) card.remove();
    const groupCard = document.getElementById(`note-group-${lessonId}`);
    if (groupCard && !groupCard.querySelector('.js-delete-note-btn')) {
      groupCard.remove();
    }
    toast('success', 'Заметка удалена');
    if (!document.querySelector('#dashboardNotesList .js-delete-note-btn')) {
      window.location.reload();
    }
  } catch (err) {
    console.error(err);
    toast('error', 'Не удалось удалить заметку');
    btn.disabled = false;
    if (card) card.classList.remove('note-deleting');
  }
});

function startDashboardNoteEdit(btn) {
  const noteId = btn.dataset.noteId;
  const lessonId = btn.dataset.lessonId;
  const card = document.getElementById(`note-card-${noteId}`);
  if (!card || card.classList.contains('is-editing')) return;

  const preview = card.querySelector('.note-content-preview');
  const actions = card.querySelector('.note-actions');
  if (!preview || !actions) return;

  const original = preview.textContent || '';
  card.classList.add('is-editing');
  card.dataset.originalContent = original;

  preview.hidden = true;
  const editor = document.createElement('div');
  editor.className = 'note-edit-panel';
  editor.innerHTML = `
    <textarea class="note-edit-textarea" rows="4"></textarea>
    <div class="note-edit-actions">
      <button type="button" class="note-save-btn js-save-note-edit" data-note-id="${noteId}" data-lesson-id="${lessonId}">Сохранить</button>
      <button type="button" class="note-cancel-btn js-cancel-note-edit">Отмена</button>
    </div>
  `;
  editor.querySelector('textarea').value = original;
  preview.insertAdjacentElement('afterend', editor);
  actions.hidden = true;
  editor.querySelector('textarea')?.focus();
}

function cancelDashboardNoteEdit(card) {
  const preview = card.querySelector('.note-content-preview');
  const panel = card.querySelector('.note-edit-panel');
  const actions = card.querySelector('.note-actions');
  if (panel) panel.remove();
  if (preview) preview.hidden = false;
  if (actions) actions.hidden = false;
  card.classList.remove('is-editing');
  delete card.dataset.originalContent;
}

async function saveDashboardNoteEdit(btn) {
  const noteId = btn.dataset.noteId;
  const lessonId = btn.dataset.lessonId;
  const card = document.getElementById(`note-card-${noteId}`);
  if (!card || !noteId || !lessonId) return;

  const textarea = card.querySelector('.note-edit-textarea');
  const content = (textarea?.value || '').trim();
  if (!content) {
    toast('error', 'Заметка не может быть пустой');
    return;
  }

  btn.disabled = true;
  try {
    const response = await fetch(`/lessons/${lessonId}/note/${noteId}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || 'Не удалось сохранить заметку');
    }

    const preview = card.querySelector('.note-content-preview');
    if (preview) preview.textContent = content;
    cancelDashboardNoteEdit(card);
    toast('success', 'Заметка обновлена');
  } catch (error) {
    console.error(error);
    toast('error', error.message || 'Не удалось сохранить заметку');
    btn.disabled = false;
  }
}
