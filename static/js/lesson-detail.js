/* Lesson page interactions */

const $ = (sel) => document.querySelector(sel);

function sourceMimeByExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "mov" || e === "m4v" || e === "mp4") return "video/mp4";
  if (e === "webm") return "video/webm";
  if (e === "ogg" || e === "ogv") return "video/ogg";
  if (["720p", "1080p", "720", "1080"].includes(e)) return "video/mp4";
  return "video/mp4";
}

function extensionFromSrc(src) {
  const path = String(src || "").split("?")[0];
  const tail = path.split("/").pop() || "";
  if (["720p", "1080p", "720", "1080"].includes(tail.toLowerCase())) return "mp4";
  if (path.includes("/media/lessons/")) return "mp4";
  const parts = tail.split(".");
  return parts.length > 1 ? parts.pop() : "mp4";
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTimecode(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

const lessonPage = document.getElementById("lessonPage");
const lessonId = lessonPage?.dataset.lessonId || "";
const lessonVideoUrl = lessonPage?.dataset.videoUrl || "";
const storageKey = lessonId ? `nailis:lesson-progress:${lessonId}` : "";

let plyrPlayer = null;
let videoInitialized = false;
let currentSource = lessonVideoUrl || null;
let saveTimer = null;

function bootLessonPage() {
  bindNoteUI();
  loadNotes();
  initCompletion();
  initQualitySwitcher();
  initVideoPlayer().catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootLessonPage);
} else {
  bootLessonPage();
}

function updateVideoOrientation(videoEl) {
  const frame = $("#videoFrame");
  if (!frame || !videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;
  // Класс только для семантики/отладки: размер сцены всегда 16:9,
  // ориентация вписывается через object-fit: contain.
  const portrait = videoEl.videoHeight > videoEl.videoWidth;
  frame.classList.toggle("is-portrait", portrait);
  frame.dataset.orientation = portrait ? "portrait" : "landscape";
}

function bindOrientationTracking(videoEl) {
  if (!videoEl) return;
  const sync = () => updateVideoOrientation(videoEl);
  videoEl.addEventListener("loadedmetadata", sync);
  videoEl.addEventListener("loadeddata", sync);
  if (videoEl.readyState >= 1) sync();
}

function getCurrentTime() {
  if (plyrPlayer && Number.isFinite(plyrPlayer.currentTime)) return plyrPlayer.currentTime;
  const videoEl = $("#lessonVideo");
  return videoEl && Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
}

function restoreSavedPosition(playerOrVideo) {
  if (!storageKey || !playerOrVideo) return;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const saved = Number(raw);
    if (!Number.isFinite(saved) || saved < 3) return;
    const apply = () => {
      const duration = playerOrVideo.duration;
      const target =
        Number.isFinite(duration) && duration > 0
          ? Math.min(saved, Math.max(0, duration - 1))
          : saved;
      playerOrVideo.currentTime = target;
    };
    if (playerOrVideo.readyState >= 1) apply();
    else playerOrVideo.addEventListener("loadedmetadata", apply, { once: true });
  } catch (_) {
    /* ignore */
  }
}

function persistPosition() {
  if (!storageKey) return;
  try {
    const t = getCurrentTime();
    if (!Number.isFinite(t) || t < 2) return;
    localStorage.setItem(storageKey, String(Math.floor(t)));
  } catch (_) {
    /* ignore */
  }
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistPosition, 700);
}

async function initVideoPlayer() {
  const videoEl = $("#lessonVideo");
  if (!videoEl || videoInitialized) return;
  videoInitialized = true;

  const frame = $("#videoFrame");
  const loading = document.createElement("div");
  loading.className = "loading-overlay";
  loading.textContent = "Загрузка видео…";
  if (frame) frame.appendChild(loading);

  try {
    plyrPlayer = new Plyr(videoEl, {
      controls: [
        "play",
        "progress",
        "current-time",
        "mute",
        "volume",
        "settings",
        "fullscreen",
        "pip",
        "airplay",
      ],
      settings: ["speed"],
    });
    bindOrientationTracking(videoEl);
    restoreSavedPosition(plyrPlayer);
    plyrPlayer.on("timeupdate", schedulePersist);
    plyrPlayer.on("pause", persistPosition);
    plyrPlayer.on("ended", () => {
      try {
        localStorage.removeItem(storageKey);
      } catch (_) {
        /* ignore */
      }
    });
    bindAutoCompleteTracking();
    videoEl.addEventListener(
      "loadedmetadata",
      () => {
        if (loading.parentNode) loading.parentNode.removeChild(loading);
      },
      { once: true }
    );
  } catch (err) {
    console.error("Plyr init failed", err);
  } finally {
    if (loading.parentNode) loading.parentNode.removeChild(loading);
  }
}

async function initializeNewVideoPlayer(src, ext) {
  const frame = $("#videoFrame");
  if (!frame) throw new Error("videoFrame missing");
  frame.style.minHeight = `${frame.getBoundingClientRect().height}px`;
  frame.innerHTML = `<video id="lessonVideo" class="plyr__video" controls crossorigin playsinline preload="metadata"><source src="${src}" type="${sourceMimeByExt(ext)}"></video>`;
  videoInitialized = false;
  await initVideoPlayer();
  setTimeout(() => {
    frame.style.minHeight = "";
  }, 450);
}

function initQualitySwitcher() {
  const sel = document.getElementById("videoQualitySelect");
  if (!sel) return;

  sel.addEventListener("change", async function onQualityChange() {
    const newSrc = this.value;
    if (!newSrc) return;
    const frame = $("#videoFrame");
    this.disabled = true;
    if (frame) frame.style.minHeight = `${frame.getBoundingClientRect().height}px`;

    try {
      await switchVideoSource(newSrc);
    } catch (err) {
      console.error("Quality switch failed", err);
    } finally {
      this.disabled = false;
      setTimeout(() => {
        if (frame) frame.style.minHeight = "";
      }, 450);
    }
  });
}

async function switchVideoSource(newSrc) {
  const ext = extensionFromSrc(newSrc);
  const curTime = getCurrentTime();
  const wasPlaying = plyrPlayer && !plyrPlayer.paused && !plyrPlayer.ended;
  const frame = $("#videoFrame");
  if (frame) frame.classList.remove("is-portrait");
  currentSource = newSrc;

  if (!videoInitialized) {
    await initializeNewVideoPlayer(newSrc, ext);
  } else {
    try {
      plyrPlayer.source = {
        type: "video",
        sources: [{ src: newSrc, type: sourceMimeByExt(ext) }],
      };
    } catch (err) {
      console.warn("plyr update unsuccessful, recreating video element", err);
      await initializeNewVideoPlayer(newSrc, ext);
    }
  }

  if (plyrPlayer) {
    try {
      plyrPlayer.currentTime = curTime;
      if (wasPlaying) await plyrPlayer.play().catch(() => {});
    } catch (e) {
      console.warn("restore playback state failed", e);
    }
  }
}

async function loadNotes() {
  const container = $("#notesContainer");
  if (!container) return;
  container.innerHTML =
    '<div class="note-item"><div class="note-body"><div class="note-text muted">Загрузка…</div></div></div>';

  try {
    const res = await fetch(`/lessons/${lessonId}/notes`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (res.redirected && res.url && res.url.includes("/login")) {
      container.innerHTML =
        '<div class="notes-empty"><strong>Нужен вход</strong><span>Заметки доступны после авторизации.</span></div>';
      return;
    }
    if (res.status === 204) {
      renderNotes([]);
      return;
    }
    if (!res.ok) {
      container.innerHTML =
        '<div class="notes-empty"><strong>Не удалось загрузить</strong><span>Попробуйте обновить страницу.</span></div>';
      return;
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const text = await res.text().catch(() => null);
      if (!text) {
        renderNotes([]);
        return;
      }
      container.innerHTML =
        '<div class="notes-empty"><strong>Не удалось загрузить</strong><span>Ожидался JSON от сервера.</span></div>';
      return;
    }

    const payload = await res.json();
    let notes;
    if (Array.isArray(payload)) notes = payload;
    else if (payload && Array.isArray(payload.notes)) notes = payload.notes;
    else if (payload && Array.isArray(payload.data)) notes = payload.data;
    else notes = [];
    renderNotes(notes);
  } catch (err) {
    console.error("[notes] fetch error", err);
    container.innerHTML =
      '<div class="notes-empty"><strong>Сетевая ошибка</strong><span>Проверьте соединение и попробуйте снова.</span></div>';
  }
}

function renderNotes(notes) {
  const container = $("#notesContainer");
  if (!container) return;
  if (!Array.isArray(notes) || notes.length === 0) {
    container.innerHTML = `
      <div class="notes-empty">
        <strong>Заметок пока нет</strong>
        <span>Нажмите «Вставить таймкод», затем «Добавить заметку».</span>
      </div>`;
    return;
  }

  container.innerHTML = notes
    .map((n, idx) => {
      const id = n.id ?? "";
      const content = escapeHtml(n.content ?? "");
      const created = n.created_at ? new Date(n.created_at).toLocaleString() : "";
      return `
      <div class="note-item note-enter" style="animation-delay:${Math.min(idx * 55, 380)}ms" data-note-id="${id}">
        <div class="note-body">
          <div class="note-text">${content}</div>
          <div class="note-meta">${created}</div>
        </div>
        <div class="note-actions">
          <button class="btn btn-outline note-edit-btn" data-note-id="${id}" aria-label="Редактировать"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-outline note-delete-btn" data-note-id="${id}" aria-label="Удалить"><i class="bi bi-trash"></i></button>
        </div>
      </div>`;
    })
    .join("");
}

document.addEventListener("click", (ev) => {
  const edit = ev.target.closest(".note-edit-btn");
  if (edit) {
    startInlineEdit(edit.dataset.noteId);
    ev.preventDefault();
    return;
  }
  const del = ev.target.closest(".note-delete-btn");
  if (del) {
    deleteNote(del.dataset.noteId);
    ev.preventDefault();
  }
});

async function startInlineEdit(noteId) {
  const item = document.querySelector(`.note-item[data-note-id="${noteId}"]`);
  if (!item || item.querySelector("textarea")) return;
  const body = item.querySelector(".note-body");
  const orig = body.querySelector(".note-text")?.textContent || "";
  const ta = document.createElement("textarea");
  ta.className = "notes-textarea";
  ta.value = orig;
  ta.rows = 4;
  body.innerHTML = "";
  body.appendChild(ta);

  const actions = item.querySelector(".note-actions");
  actions.innerHTML = "";

  const save = document.createElement("button");
  save.className = "btn btn-complete";
  save.innerHTML = '<i class="bi bi-check-lg"></i>';
  save.addEventListener("click", async () => {
    const newContent = ta.value.trim();
    if (!newContent) {
      alert("Заметка не может быть пустой");
      return;
    }
    save.disabled = true;
    try {
      const res = await fetch(`/lessons/${lessonId}/note/${noteId}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      if (!res.ok) throw new Error("update failed");
      showNoteStatus("Заметка обновлена");
      await loadNotes();
    } catch (err) {
      console.error(err);
      alert("Ошибка при обновлении заметки");
      save.disabled = false;
    }
  });

  const cancel = document.createElement("button");
  cancel.className = "btn btn-outline";
  cancel.innerHTML = '<i class="bi bi-x-lg"></i>';
  cancel.addEventListener("click", () => loadNotes());

  actions.appendChild(save);
  actions.appendChild(cancel);
}

function updateTimestampPreview() {
  const preview = document.getElementById("timestampPreview");
  if (preview) preview.textContent = formatTimecode(getCurrentTime());
}

async function saveNote() {
  const ta = document.getElementById("noteContent");
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) {
    alert("Заметка не может быть пустой");
    return;
  }
  if (!lessonId) {
    alert("Не удалось определить урок");
    return;
  }
  const btn = document.getElementById("saveNoteBtn");
  const prev = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "Сохранение…";
  }
  try {
    const res = await fetch(`/lessons/${lessonId}/note`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
    ta.value = "";
    showNoteStatus("Заметка добавлена");
    await loadNotes();
  } catch (err) {
    console.error(err);
    alert("Ошибка при сохранении заметки");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = prev;
    }
  }
}

function insertTimestamp() {
  const ta = document.getElementById("noteContent");
  if (!ta) return;
  updateTimestampPreview();
  const stamp = `[${formatTimecode(getCurrentTime())}] `;
  const start = Number.isFinite(ta.selectionStart) ? ta.selectionStart : ta.value.length;
  const end = Number.isFinite(ta.selectionEnd) ? ta.selectionEnd : ta.value.length;
  ta.value = `${ta.value.slice(0, start)}${stamp}${ta.value.slice(end)}`;
  const caret = start + stamp.length;
  ta.focus();
  try {
    ta.setSelectionRange(caret, caret);
  } catch (_) {
    /* ignore */
  }
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  showNoteStatus(`Таймкод ${stamp.trim()} вставлен`);
}

async function deleteNote(id) {
  const confirmed = window.nailisConfirm
    ? await window.nailisConfirm({
        title: "Удалить заметку?",
        message: "Запись будет удалена из этого урока. Отменить действие нельзя.",
        confirmText: "Удалить",
        cancelText: "Оставить",
        danger: true,
      })
    : window.confirm("Удалить заметку?");
  if (!confirmed) return;
  try {
    const res = await fetch(`/lessons/${lessonId}/note/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error("delete failed");
    showNoteStatus("Заметка удалена");
    await loadNotes();
  } catch (err) {
    console.error(err);
    alert("Ошибка при удалении заметки");
  }
}

function showNoteStatus(msg) {
  const el = document.getElementById("noteStatus");
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

function markLessonCompletedUI() {
  const btn = document.getElementById("completeLessonBtn");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-done");
    btn.innerHTML = '<i class="bi bi-check2-circle" aria-hidden="true"></i><span>Урок пройден</span>';
  }
  if (lessonPage) lessonPage.dataset.lessonCompleted = "1";
}

let completionInFlight = false;

function isLessonMarkedCompleted() {
  return lessonPage?.dataset.lessonCompleted === "1";
}

async function completeLesson({ silent = false } = {}) {
  if (!lessonId || isLessonMarkedCompleted() || completionInFlight) return false;
  completionInFlight = true;
  const btn = document.getElementById("completeLessonBtn");
  const prev = btn ? btn.innerHTML : "";
  if (btn && !silent) {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split" aria-hidden="true"></i><span>Отмечаем…</span>';
  }
  try {
    const r = await fetch(`/lessons/${lessonId}/complete`, {
      method: "PUT",
      credentials: "same-origin",
    });
    if (!r.ok) throw new Error("completion failed");
    markLessonCompletedUI();
    showNoteStatus(silent ? "Урок завершён по просмотру видео" : "Урок отмечен как пройденный");
    return true;
  } catch (e) {
    console.error(e);
    if (btn && !isLessonMarkedCompleted()) {
      btn.disabled = false;
      btn.innerHTML = prev;
    }
    if (!silent) alert("Ошибка при отметке урока");
    return false;
  } finally {
    completionInFlight = false;
  }
}

/** Порог автозавершения: как у большинства LMS (не 100%, конец часто не досматривают). */
const AUTO_COMPLETE_RATIO = 0.95;
let maxWatchedRatio = 0;

function maybeAutoCompleteFromProgress() {
  if (isLessonMarkedCompleted() || completionInFlight) return;
  const duration =
    (plyrPlayer && Number.isFinite(plyrPlayer.duration) && plyrPlayer.duration > 0
      ? plyrPlayer.duration
      : null) ||
    (() => {
      const v = $("#lessonVideo");
      return v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    })();
  if (!duration || duration < 5) return;

  const current = getCurrentTime();
  if (!Number.isFinite(current)) return;
  const ratio = Math.min(1, Math.max(0, current / duration));
  maxWatchedRatio = Math.max(maxWatchedRatio, ratio);

  if (maxWatchedRatio >= AUTO_COMPLETE_RATIO) {
    completeLesson({ silent: true });
  }
}

function bindAutoCompleteTracking() {
  if (!plyrPlayer) return;
  plyrPlayer.on("timeupdate", maybeAutoCompleteFromProgress);
  plyrPlayer.on("ended", () => {
    maxWatchedRatio = 1;
    completeLesson({ silent: true });
  });
}

function initCompletion() {
  const btn = document.getElementById("completeLessonBtn");
  if (!btn) return;

  if (isLessonMarkedCompleted()) {
    markLessonCompletedUI();
  } else {
    (async () => {
      try {
        const r = await fetch(`/lessons/${lessonId}/complete`, { credentials: "same-origin" });
        if (r.ok) {
          const d = await r.json();
          if (d.completed) markLessonCompletedUI();
        }
      } catch (_) {
        /* ignore */
      }
    })();
  }

  btn.addEventListener("click", async () => {
    if (btn.disabled || isLessonMarkedCompleted()) return;
    await completeLesson({ silent: false });
  });
}

function bindNoteUI() {
  document.getElementById("saveNoteBtn")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    saveNote();
  });
  document.getElementById("clearNoteBtn")?.addEventListener("click", () => {
    const t = document.getElementById("noteContent");
    if (t) t.value = "";
  });
  document.getElementById("insertTimestampBtn")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    insertTimestamp();
  });

  updateTimestampPreview();
  setInterval(updateTimestampPreview, 400);

  window.nailisInsertTimestamp = insertTimestamp;
  window.nailisSaveNote = saveNote;
}

window.addEventListener(
  "error",
  (ev) => {
    const t = ev.target;
    if (t && (t.tagName === "VIDEO" || t.tagName === "SOURCE")) {
      const frame = $("#videoFrame");
      if (frame) frame.innerHTML = '<div class="video-empty">Ошибка загрузки видео</div>';
    }
  },
  true
);

window.addEventListener("beforeunload", persistPosition);
