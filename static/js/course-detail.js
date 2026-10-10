const coursePage = document.querySelector('.course-page');
const courseId = coursePage?.dataset.courseId || '';
const assessmentStorageKey = `course-assessment:${courseId}`;
const homeworkStorageKey = `course-homework:${courseId}`;

/*
 Client-side improvements:
 - Управление автоплеем для превью: autoplay только на десктопах/non-touch.
 - IntersectionObserver: воспроизводить превью только если виден элемент (экономия CPU).
 - Обрабатываем не все видео одновременно.
*/
document.addEventListener('DOMContentLoaded', () => {
  try {
    initPreviewVideos();
    initLessonSearch();
    initCourseAssessment();
    initHomeworkSubmission();
  } catch (e) {
    console.error('preview init error', e);
  }
});

function isTouchDevice() {
  return (('ontouchstart' in window) || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0);
}

let previewObserver = null;
let previewPolicy = null;
let resizeTick = null;
let resizeBound = false;

function allowPreviewAutoplay() {
  return !isTouchDevice() && window.innerWidth >= 900;
}

function ensurePreviewLoaded(videoEl) {
  if (!videoEl || !videoEl.dataset.previewSrc) return;
  if (videoEl.dataset.loaded === '1') return;
  const src = videoEl.dataset.previewSrc;
  const source = videoEl.querySelector('source');
  if (source && source.getAttribute('src') !== src) {
    source.setAttribute('src', src);
  }
  if (videoEl.getAttribute('src') !== src) {
    videoEl.setAttribute('src', src);
  }
  videoEl.dataset.loaded = '1';
  videoEl.load();
}

function markPreviewOrientation(videoEl) {
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;
  videoEl.classList.toggle('is-portrait', videoEl.videoHeight > videoEl.videoWidth);
}

function getPreviewLimit(videoEl) {
  const limit = Number(videoEl?.dataset.previewLimit || 7);
  return Number.isFinite(limit) && limit > 0 ? limit : 7;
}

function resetPreview(videoEl) {
  if (!videoEl) return;
  try {
    videoEl.pause();
    if (videoEl.currentTime > 0) {
      videoEl.currentTime = 0;
    }
  } catch (e) {}
}

function keepPreviewInRange(videoEl) {
  if (!videoEl || videoEl.readyState < 1) return;
  const limit = Math.min(getPreviewLimit(videoEl), videoEl.duration || getPreviewLimit(videoEl));
  if (videoEl.currentTime >= limit) {
    videoEl.currentTime = 0;
    if (!videoEl.paused) {
      videoEl.play().catch(() => {});
    }
  }
}

function playPreview(videoEl) {
  if (!videoEl) return;
  if (videoEl.readyState >= 1) {
    const limit = Math.min(getPreviewLimit(videoEl), videoEl.duration || getPreviewLimit(videoEl));
    if (videoEl.currentTime >= limit) {
      videoEl.currentTime = 0;
    }
  }
  videoEl.play().catch(() => {});
}

function initPreviewVideos() {
  const videos = Array.from(document.querySelectorAll('.lesson-preview-video'));
  if (!videos.length) return;

  if (previewObserver) {
    previewObserver.disconnect();
  }
  previewPolicy = allowPreviewAutoplay();

  previewObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const v = entry.target;
      if (!(v instanceof HTMLVideoElement)) return;

      if (entry.isIntersecting && entry.intersectionRatio > 0.35) {
        ensurePreviewLoaded(v);
        if (previewPolicy) {
          playPreview(v);
        } else {
          resetPreview(v);
        }
      } else {
        resetPreview(v);
      }
    });
  }, { threshold: [0.35, 0.6] });

  videos.forEach(v => {
    v.muted = true;
    v.playsInline = true;
    v.preload = 'none';
    v.addEventListener('loadedmetadata', () => markPreviewOrientation(v), { once: true });
    v.addEventListener('timeupdate', () => keepPreviewInRange(v));
    v.addEventListener('ended', () => {
      v.currentTime = 0;
      if (previewPolicy) {
        v.play().catch(() => {});
      }
    });
    if (v.readyState >= 1) {
      markPreviewOrientation(v);
    }
    previewObserver.observe(v);
  });

  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener('resize', () => {
      if (resizeTick) window.clearTimeout(resizeTick);
      resizeTick = window.setTimeout(() => {
        const nowPolicy = allowPreviewAutoplay();
        if (nowPolicy !== previewPolicy) {
          initPreviewVideos();
        }
      }, 220);
    });
  }
}

function initLessonSearch() {
  const cards = Array.from(document.querySelectorAll('[data-lesson-card]'));
  const searchInput = document.getElementById('lessonSearch');
  const clearButton = document.getElementById('clearLessonSearch');
  const countEl = document.getElementById('lessonsCount');
  const emptyEl = document.getElementById('lessonSearchEmpty');
  if (!cards.length || !searchInput) return;

  const updateState = () => {
    const visible = cards.filter((card) => card.style.display !== 'none').length;
    if (countEl) countEl.textContent = String(visible);
    if (emptyEl) emptyEl.classList.toggle('is-visible', visible === 0);
  };

  const applySearch = () => {
    const query = searchInput.value.trim().toLowerCase();
    cards.forEach((card) => {
      const haystack = card.dataset.search || '';
      card.style.display = !query || haystack.includes(query) ? '' : 'none';
    });
    updateState();
  };

  searchInput.addEventListener('input', applySearch);
  clearButton?.addEventListener('click', () => {
    searchInput.value = '';
    applySearch();
    searchInput.focus();
  });

  updateState();
}

function setFeedbackState(element, message, kind = '') {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('is-success', 'is-error');
  if (kind) element.classList.add(kind);
}

function initCourseAssessment() {
  const form = document.getElementById('courseAssessmentForm');
  const statusEl = document.getElementById('assessmentFormStatus');
  const assessmentPayload = getAssessmentPayload();
  if (!form) return hydrateAssessmentState();
  hydrateAssessmentState();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFeedbackState(statusEl, 'Проверяем ответы...', '');

    try {
      const formData = new FormData(form);
      if (!assessmentPayload.length) {
        throw new Error('Тест пока недоступен для этого курса');
      }

      const answers = {};
      assessmentPayload.forEach((question) => {
        answers[question.id] = String(formData.get(question.id) || '').trim();
      });

      if (Object.values(answers).some((value) => !value)) {
        throw new Error('Ответь на все вопросы теста');
      }

      const response = await fetch(`/api/courses/${courseId}/assessment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ answers }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(data.detail)
          ? data.detail.map((item) => item.msg || item).join(', ')
          : (data.detail || 'Не удалось проверить тест');
        throw new Error(detail);
      }

      const savedAttempt = {
        score: data.score,
        total_questions: data.total_questions,
        passed: data.passed,
        created_at: data.created_at || formatNow(),
      };

      localStorage.setItem(assessmentStorageKey, JSON.stringify(savedAttempt));
      renderAssessmentCard(savedAttempt);

      const resultText = `Результат: ${savedAttempt.score}/${savedAttempt.total_questions}. ${savedAttempt.passed ? 'Тест зачтён.' : 'Есть ошибки, можно пройти ещё раз.'}`;
      setFeedbackState(statusEl, resultText, savedAttempt.passed ? 'is-success' : 'is-error');
    } catch (error) {
      setFeedbackState(statusEl, error.message || 'Ошибка при отправке теста', 'is-error');
    }
  });
}

function getAssessmentPayload() {
  const node = document.getElementById('assessmentPayload');
  if (!node) return [];
  try {
    return JSON.parse(node.textContent || '[]');
  } catch (error) {
    console.warn('assessment payload parse failed', error);
    return [];
  }
}

function initHomeworkSubmission() {
  const form = document.getElementById('courseHomeworkForm');
  const statusEl = document.getElementById('homeworkFormStatus');
  if (!form) return hydrateHomeworkState();
  hydrateHomeworkState();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFeedbackState(statusEl, 'Отправляем работу...', '');

    try {
      const formData = new FormData(form);
      const deliveryChannel = String(formData.get('delivery_channel') || 'email');
      const resourceUrl = String(formData.get('resource_url') || '').trim();
      const message = String(formData.get('message') || '').trim();
      const fileInput = form.querySelector('input[type="file"]');
      const fileName = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0].name : '';

      if (!resourceUrl && !message && !fileName) {
        throw new Error('Добавь ссылку, описание или файл домашней работы');
      }

      const payload = new FormData();
      payload.append('delivery_channel', deliveryChannel);
      payload.append('resource_url', resourceUrl);
      payload.append('message', message);
      if (fileInput && fileInput.files && fileInput.files[0]) {
        payload.append('homework_file', fileInput.files[0]);
      }

      const response = await fetch(`/api/courses/${courseId}/homework`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        body: payload,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(data.detail)
          ? data.detail.map((item) => item.msg || item).join(', ')
          : (data.detail || 'Не удалось отправить домашнюю работу');
        throw new Error(detail);
      }

      const savedSubmission = {
        delivery_channel: data.delivery_channel || deliveryChannel,
        delivery_status: data.delivery_status || 'queued',
        created_at: data.created_at || formatNow(),
        resource_url: data.resource_url || resourceUrl || null,
        file_name: data.file_name || fileName || null,
      };

      localStorage.setItem(homeworkStorageKey, JSON.stringify(savedSubmission));
      renderHomeworkCard(savedSubmission);

      setFeedbackState(
        statusEl,
        'Домашняя работа отправлена.',
        'is-success'
      );
      if (window.nailisToast) {
        window.nailisToast.success('Домашняя работа отправлена');
      }
      form.reset();
    } catch (error) {
      setFeedbackState(statusEl, error.message || 'Ошибка при отправке работы', 'is-error');
      if (window.nailisToast) {
        window.nailisToast.error(error.message || 'Ошибка при отправке работы');
      }
    }
  });
}

function renderAssessmentCard(attempt) {
  const cardEl = document.getElementById('assessmentStatusCard');
  if (!cardEl || !attempt) return;
  cardEl.innerHTML = `
    <span class="status-card-label">Статус теста</span>
    <strong>${attempt.score}/${attempt.total_questions}</strong>
    <p>${attempt.passed ? 'Последняя попытка засчитана.' : 'Попытка сохранена локально. Можно пройти тест повторно.'}</p>
    <span class="status-card-meta">${attempt.created_at || ''}</span>
  `;
}

function renderHomeworkCard(submission) {
  const cardEl = document.getElementById('homeworkStatusCard');
  if (!cardEl || !submission) return;
  const extras = [submission.delivery_channel];
  if (submission.file_name) extras.push(submission.file_name);
  cardEl.innerHTML = `
    <span class="status-card-label">Статус домашней работы</span>
    <strong>${submission.delivery_status}</strong>
    <p>Отправлено. Канал: ${extras.join(' · ')}.</p>
    <span class="status-card-meta">${submission.created_at || ''}</span>
  `;
}

function hydrateAssessmentState() {
  try {
    const raw = localStorage.getItem(assessmentStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    renderAssessmentCard(parsed);
    setFeedbackState(
      document.getElementById('assessmentFormStatus'),
      `Последний локальный результат: ${parsed.score}/${parsed.total_questions}.`,
      parsed.passed ? 'is-success' : 'is-error'
    );
  } catch (error) {
    console.warn('assessment hydrate failed', error);
  }
}

function hydrateHomeworkState() {
  try {
    const raw = localStorage.getItem(homeworkStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    renderHomeworkCard(parsed);
    setFeedbackState(
      document.getElementById('homeworkFormStatus'),
      'Последняя отправка сохранена в этом браузере.',
      'is-success'
    );
  } catch (error) {
    console.warn('homework hydrate failed', error);
  }
}

function formatNow() {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}
