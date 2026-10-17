(() => {
  // Early safety for Chromium/Yandex: never leave reveal blocks invisible
  const forceVisibleSoon = () => {
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-visible"));
    document.documentElement.classList.remove("nh-reveal");
  };
  window.setTimeout(() => {
    const hidden = document.querySelector("[data-reveal]:not(.is-visible)");
    if (hidden) forceVisibleSoon();
  }, 3000);
})();

(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // AV1 при том же качестве примерно вдвое легче H.264. Берём его, только если браузер
  // играет его плавно, а на телефоне — ещё и аппаратно (иначе греется и садит батарею).
  let preferAv1 = false;
  const av1Check = (async () => {
    try {
      if (!navigator.mediaCapabilities?.decodingInfo) return false;
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: "file",
        video: {
          contentType: 'video/mp4; codecs="av01.0.08M.08"',
          width: 720,
          height: 1280,
          bitrate: 1200000,
          framerate: 60,
        },
      });
      const touchDevice = window.matchMedia("(pointer: coarse)").matches;
      return info.supported && info.smooth && (info.powerEfficient || !touchDevice);
    } catch (_) {
      return false;
    }
  })();
  av1Check.then((ok) => { preferAv1 = ok; });

  const ensureSource = (video) => {
    const src = (preferAv1 && video.dataset.srcAv1) || video.dataset.src;
    if (!src || video.dataset.loaded === "1") return;
    video.src = src;
    video.dataset.loaded = "1";
    video.load();
  };

  const playVideo = (video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    video.muted = true;
    video.playsInline = true;
    ensureSource(video);
    if (reducedMotion) return;
    video.play().catch(() => {});
  };

  const pauseVideo = (video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    try { video.pause(); } catch (_) {}
  };

  const observeVideos = (selector, rootMargin = "80px 0px") => {
    const videos = Array.from(document.querySelectorAll(selector));
    if (!videos.length) return;

    if (!("IntersectionObserver" in window)) {
      videos.slice(0, 2).forEach(playVideo);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (!(video instanceof HTMLVideoElement)) return;
        if (entry.isIntersecting && entry.intersectionRatio > 0.2) {
          playVideo(video);
        } else {
          pauseVideo(video);
        }
      });
    }, { threshold: [0, 0.2, 0.5], rootMargin });

    videos.forEach((video) => observer.observe(video));
  };

  // Лента на первом экране едет по кругу. Ролик грузим и запускаем, когда он
  // подъезжает к экрану (с запасом в 60% ширины по бокам), а не все сразу:
  // на телефоне видно полтора ролика из шести.
  const heroTape = document.querySelector("[data-hero-tape]");
  if (heroTape) {
    const heroVideos = Array.from(heroTape.querySelectorAll("video.hero-tape-video"));

    const startHeroTape = () => {
      if (!("IntersectionObserver" in window)) {
        heroVideos.forEach(playVideo);
        return;
      }
      const nearScreen = new Set();
      let tapeOnScreen = false;
      const sync = (video) => {
        if (tapeOnScreen && nearScreen.has(video)) playVideo(video);
        else pauseVideo(video);
      };
      // root — сама лента: её предки обрезают всё за краем экрана, и с корнем-окном
      // запас по бокам не сработал бы
      const clipObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) nearScreen.add(entry.target);
          else nearScreen.delete(entry.target);
          sync(entry.target);
        });
      }, { root: heroTape, rootMargin: "0px 60% 0px 60%" });
      const tapeObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          tapeOnScreen = entry.isIntersecting;
          heroVideos.forEach(sync);
        });
      }, { threshold: 0.05 });
      heroVideos.forEach((video) => clipObserver.observe(video));
      tapeObserver.observe(heroTape);
    };

    av1Check.then(startHeroTape);
  }

  // Works focus gallery
  const worksFocus = document.querySelector("[data-works-focus]");
  if (worksFocus instanceof HTMLElement) {
    const thumbs = Array.from(worksFocus.querySelectorAll("[data-works-thumb]"));
    const focusVideo = worksFocus.querySelector("[data-works-focus-video]");
    const focusImage = worksFocus.querySelector("[data-works-focus-image]");
    const swipeHint = worksFocus.querySelector("[data-works-swipe-hint]");
    const indexList = worksFocus.querySelector("[data-works-thumbs]");
    const stage = worksFocus.querySelector(".works-focus-stage");
    let activeIndex = Math.max(0, thumbs.findIndex((thumb) => thumb.classList.contains("is-active")));
    let timerId = null;
    // Пока наблюдатель не сказал, что галерея на экране, считаем её невидимой:
    // иначе её первый ролик качается сразу при открытии страницы, хотя блок далеко внизу.
    let sectionVisible = !("IntersectionObserver" in window);
    let paused = false;
    // Пока на телефоне экран блокировки (home-motion.js), работы не листаем.
    // Если анимации не загрузились (нет html.nh-motion), блокировки нет — снимаем флаг.
    let introLocked = !reducedMotion && Boolean(worksFocus.querySelector("[data-works-lock]"));

    const writeParam = (key, value) => {
      const url = new URL(window.location.href);
      if (value == null || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
      history.replaceState(null, "", url);
    };

    const requestedWork = Number(new URLSearchParams(window.location.search).get("work"));
    if (Number.isInteger(requestedWork) && requestedWork >= 1 && requestedWork <= thumbs.length) {
      activeIndex = requestedWork - 1;
    }

    const showFocus = (index, { fromUser = false } = {}) => {
      if (!thumbs.length) return;
      activeIndex = (index + thumbs.length) % thumbs.length;
      const thumb = thumbs[activeIndex];
      const type = thumb.getAttribute("data-type") || "image";
      const src = thumb.getAttribute("data-src") || "";
      const srcAv1 = thumb.getAttribute("data-src-av1") || "";
      const poster = thumb.getAttribute("data-poster") || src;

      thumbs.forEach((item, i) => {
        const on = i === activeIndex;
        item.classList.toggle("is-active", on);
        item.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (fromUser) {
        writeParam("work", activeIndex + 1);
        // человек уже листает — подсказка больше не нужна
        swipeHint?.classList.add("is-hidden");
      }

      if (type === "video" && focusVideo instanceof HTMLVideoElement) {
        if (focusImage instanceof HTMLImageElement) {
          focusImage.hidden = true;
          focusImage.classList.remove("is-active");
        }
        focusVideo.hidden = false;
        focusVideo.classList.add("is-active");
        focusVideo.poster = poster;

        if (focusVideo.dataset.currentSrc !== src) {
          pauseVideo(focusVideo);
          focusVideo.dataset.src = src;
          if (srcAv1) focusVideo.dataset.srcAv1 = srcAv1;
          else delete focusVideo.dataset.srcAv1;
          focusVideo.dataset.currentSrc = src;
          focusVideo.dataset.loaded = "0";
          focusVideo.removeAttribute("src");
        }

        if (sectionVisible && !document.hidden && !reducedMotion) {
          playVideo(focusVideo);
        } else {
          if (sectionVisible) ensureSource(focusVideo);
          pauseVideo(focusVideo);
        }
      } else if (focusImage instanceof HTMLImageElement) {
        if (focusVideo instanceof HTMLVideoElement) {
          pauseVideo(focusVideo);
          focusVideo.classList.remove("is-active");
          focusVideo.hidden = true;
        }
        focusImage.hidden = false;
        focusImage.classList.add("is-active");
        if (focusImage.getAttribute("src") !== src) focusImage.src = src;
        const name = thumb.querySelector(".works-thumb-name");
        focusImage.alt = name ? `Работа ученицы: ${name.textContent.trim().toLowerCase()}` : "Работа ученицы";
      }

      if (fromUser) {
        thumb.scrollIntoView({
          inline: "center",
          block: "nearest",
          behavior: reducedMotion ? "auto" : "smooth",
        });
      }
    };

    const stopAutoplay = () => {
      clearInterval(timerId);
      timerId = null;
    };

    const startAutoplay = () => {
      stopAutoplay();
      if (reducedMotion || thumbs.length < 2 || paused || introLocked) return;
      timerId = window.setInterval(() => {
        if (!sectionVisible || document.hidden || paused) return;
        showFocus(activeIndex + 1);
      }, 5000);
    };

    thumbs.forEach((thumb, index) => {
      thumb.addEventListener("click", () => {
        showFocus(index, { fromUser: true });
        stopAutoplay();
        startAutoplay();
      });
    });

    const step = (delta) => {
      worksFocus.dispatchEvent(new CustomEvent("nh:works-step", { detail: { direction: delta } }));
      showFocus(activeIndex + delta, { fromUser: true });
      stopAutoplay();
      startAutoplay();
    };


    if (indexList instanceof HTMLElement) {
      indexList.addEventListener("keydown", (event) => {
        const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
        const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
        if (!forward && !backward) return;
        event.preventDefault();
        const next = (activeIndex + (forward ? 1 : -1) + thumbs.length) % thumbs.length;
        showFocus(next, { fromUser: true });
        thumbs[next].focus();
      });
    }

    if (stage instanceof HTMLElement && window.PointerEvent) {
      let swipeId = null;
      let startX = 0;
      let startY = 0;
      stage.addEventListener("pointerdown", (event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        swipeId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
      });
      const endSwipe = (event) => {
        if (swipeId !== event.pointerId) return;
        swipeId = null;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
        step(dx < 0 ? 1 : -1);
      };
      stage.addEventListener("pointerup", endSwipe);
      stage.addEventListener("pointercancel", () => { swipeId = null; });
    }

    worksFocus.addEventListener("mouseenter", () => {
      paused = true;
      stopAutoplay();
    });
    worksFocus.addEventListener("mouseleave", () => {
      paused = false;
      startAutoplay();
    });
    worksFocus.addEventListener("focusin", () => {
      paused = true;
      stopAutoplay();
    });
    worksFocus.addEventListener("focusout", () => {
      paused = false;
      startAutoplay();
    });

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          sectionVisible = entry.isIntersecting;
          if (!sectionVisible) {
            if (focusVideo instanceof HTMLVideoElement) pauseVideo(focusVideo);
            stopAutoplay();
          } else {
            showFocus(activeIndex);
            startAutoplay();
          }
        });
      }, { threshold: 0.2 });
      observer.observe(worksFocus);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (focusVideo instanceof HTMLVideoElement) pauseVideo(focusVideo);
        stopAutoplay();
      } else if (sectionVisible) {
        showFocus(activeIndex);
        startAutoplay();
      }
    });

    worksFocus.addEventListener("nh:works-lock", (event) => {
      introLocked = Boolean(event.detail?.locked);
      if (introLocked) {
        stopAutoplay();
        return;
      }
      // разблокировали — показываем текущую работу с начала ролика
      if (focusVideo instanceof HTMLVideoElement && !focusVideo.hidden) {
        try { focusVideo.currentTime = 0; } catch (_) {}
      }
      startAutoplay();
    });
    window.setTimeout(() => {
      if (introLocked && !document.documentElement.classList.contains("nh-motion")) {
        introLocked = false;
        startAutoplay();
      }
    }, 2500);

    showFocus(activeIndex);
    startAutoplay();
  }

  document.addEventListener("visibilitychange", () => {
    const videos = document.querySelectorAll("video.hero-tape-video");
    if (document.hidden) {
      videos.forEach(pauseVideo);
    } else {
      videos.forEach((video) => {
        if (video.getBoundingClientRect().width > 0) {
          const rect = video.getBoundingClientRect();
          // и по горизонтали: ролики ленты стоят в ряд, за краем экрана их не грузим
          const visible = rect.bottom > 0 && rect.top < window.innerHeight
            && rect.right > 0 && rect.left < window.innerWidth;
          if (visible) playVideo(video);
        }
      });
    }
  });
})();

// Появление блоков [data-reveal] (для блоков без GSAP-анимаций из home-motion.js)
(() => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const revealItems = document.querySelectorAll("[data-reveal]");
  const revealAll = () => {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  };

  // Progressive enhancement: content is visible by default.
  // Only arm hide-until-visible after JS is ready, then reveal safely.
  const armReveal = () => {
    if (prefersReducedMotion) {
      revealAll();
      return;
    }
    document.documentElement.classList.add("nh-reveal");

    if (!("IntersectionObserver" in window)) {
      revealAll();
      return;
    }

    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.08,
      rootMargin: "0px 0px 0px 0px",
    });

    revealItems.forEach((item) => {
      // Already in viewport on load (Yandex/Chromium IO quirks)
      const rect = item.getBoundingClientRect();
      const inView = rect.bottom > 0 && rect.top < (window.innerHeight || 800);
      if (inView) {
        item.classList.add("is-visible");
      }
      revealObserver.observe(item);
    });

    // Hard fallback: never leave half the page invisible
    window.setTimeout(revealAll, 2500);
  };

  try {
    armReveal();
  } catch (err) {
    console.error("reveal init failed", err);
    document.documentElement.classList.remove("nh-reveal");
    revealAll();
  }
})();

// Окно тарифа: сводка + программа по вкладкам, переключение Junior/Middle,
// на телефоне — шторка снизу (смахнуть вниз = закрыть).
(() => {
  const dialog = document.querySelector("[data-tariff-dialog]");
  if (!(dialog instanceof HTMLDialogElement)) return;

  const card = dialog.querySelector("[data-tdialog-card]");
  const switchEl = dialog.querySelector("[data-tdialog-switch]");
  const chipsEl = dialog.querySelector("[data-tdialog-chips]");
  const titleEl = dialog.querySelector("[data-tdialog-title]");
  const priceEl = dialog.querySelector("[data-tdialog-price]");
  const monthlyEl = dialog.querySelector("[data-tdialog-monthly]");
  const pointsEl = dialog.querySelector("[data-tdialog-points]");
  const tabsEl = dialog.querySelector("[data-tdialog-tabs]");
  const panelsEl = dialog.querySelector("[data-tdialog-panels]");
  const ctaEl = dialog.querySelector("[data-tariff-dialog-cta]");
  const courseInput = dialog.querySelector("[data-tariff-dialog-course]");
  const closeBtn = dialog.querySelector("[data-tariff-close]");
  const grab = dialog.querySelector("[data-tdialog-grab]");
  const callbackPop = dialog.querySelector("[data-callback-pop]");
  const callbackPopOpenBtn = dialog.querySelector("[data-callback-pop-open]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const tariffs = Array.from(document.querySelectorAll("[data-tariff-card]")).flatMap((tariffCard) => {
    const btn = tariffCard.querySelector("[data-tariff-open]");
    if (!(btn instanceof HTMLElement)) return [];
    return [{
      id: tariffCard.dataset.tariffId || "",
      // короткое русское название для переключателя (Junior/Middle — только подпись в карточке)
      name: tariffCard.dataset.tariffShort || tariffCard.querySelector(".tariff-name")?.textContent.trim() || "",
      card: tariffCard,
      btn,
    }];
  });
  if (!tariffs.length) return;

  let current = null;
  let opener = null;

  const writeParam = (value) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("tariff", value);
    else url.searchParams.delete("tariff");
    history.replaceState(null, "", url);
  };

  const withTelegramPrefill = (href, text) => {
    try {
      const url = new URL(href, window.location.origin);
      if (!/(^|\.)t\.me$/i.test(url.hostname)) return href;
      url.searchParams.set("text", text);
      return url.toString();
    } catch (_) {
      return href;
    }
  };

  const setCallbackPopOpen = (openState) => {
    if (!(callbackPop instanceof HTMLElement)) return;
    callbackPop.hidden = !openState;
    callbackPopOpenBtn?.setAttribute("aria-expanded", openState ? "true" : "false");
    if (openState) {
      const nameInput = callbackPop.querySelector('input[name="name"]');
      if (nameInput instanceof HTMLInputElement) window.requestAnimationFrame(() => nameInput.focus());
    }
  };

  // --- вкладки программы
  const selectTab = (index, { focus = false } = {}) => {
    const tabs = Array.from(tabsEl?.querySelectorAll("[role='tab']") || []);
    const panels = Array.from(panelsEl?.querySelectorAll("[role='tabpanel']") || []);
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    panels.forEach((panel, i) => { panel.hidden = i !== index; });
    panelsEl?.scrollTo?.({ top: 0 });
  };

  const buildProgram = (tariff) => {
    tabsEl?.replaceChildren();
    panelsEl?.replaceChildren();
    const tpl = tariff.card.querySelector("template[data-tariff-detail]");
    if (!(tpl instanceof HTMLTemplateElement) || !tabsEl || !panelsEl) return;
    const days = Array.from(tpl.content.querySelectorAll(".tariff-program-day"));
    days.forEach((day, i) => {
      const tabId = `tdialog-tab-${tariff.id}-${i}`;
      const panelId = `tdialog-panel-${tariff.id}-${i}`;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tdialog-tab";
      tab.id = tabId;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panelId);
      tab.textContent = day.dataset.tab || `Часть ${i + 1}`;
      tab.addEventListener("click", () => selectTab(i));
      tabsEl.appendChild(tab);

      const panel = document.createElement("div");
      panel.className = "tdialog-panel";
      panel.id = panelId;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
      panel.tabIndex = 0;
      panel.appendChild(day.cloneNode(true));
      panelsEl.appendChild(panel);
    });
    selectTab(0);
  };

  tabsEl?.addEventListener("keydown", (event) => {
    const tabs = Array.from(tabsEl.querySelectorAll("[role='tab']"));
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (event.key in keys) {
      event.preventDefault();
      selectTab((index + keys[event.key] + tabs.length) % tabs.length, { focus: true });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      selectTab(event.key === "Home" ? 0 : tabs.length - 1, { focus: true });
    }
  });

  // свайп по программе на телефоне — соседняя вкладка
  if (panelsEl && window.PointerEvent) {
    let sx = 0;
    let sy = 0;
    let tracking = false;
    panelsEl.addEventListener("pointerdown", (event) => { tracking = true; sx = event.clientX; sy = event.clientY; });
    panelsEl.addEventListener("pointerup", (event) => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - sx;
      const dy = event.clientY - sy;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const tabs = Array.from(tabsEl.querySelectorAll("[role='tab']"));
      const index = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
      const next = index + (dx < 0 ? 1 : -1);
      if (next >= 0 && next < tabs.length) selectTab(next);
    });
    panelsEl.addEventListener("pointercancel", () => { tracking = false; });
  }

  // --- заполнение сводки
  const fill = (tariff) => {
    current = tariff;
    const { btn, card: tariffCard } = tariff;
    const courseTitle = (btn.dataset.tariffTitle || "").trim();

    if (chipsEl) {
      chipsEl.replaceChildren(
        ...[btn.dataset.tariffBadge, btn.dataset.tariffDuration, btn.dataset.tariffStatus]
          .filter(Boolean)
          .map((text) => {
            const chip = document.createElement("span");
            chip.className = "tariff-chip";
            chip.textContent = text;
            return chip;
          }),
      );
    }
    if (titleEl) titleEl.textContent = courseTitle;
    if (priceEl) priceEl.textContent = tariffCard.querySelector("[data-tariff-price]")?.textContent || "";
    if (monthlyEl) monthlyEl.textContent = tariffCard.querySelector(".tariff-monthly")?.textContent || "";
    if (pointsEl) {
      pointsEl.replaceChildren(
        ...Array.from(tariffCard.querySelectorAll(".tariff-points > li")).map((li) => li.cloneNode(true)),
      );
    }
    if (courseInput instanceof HTMLInputElement) courseInput.value = courseTitle;
    if (ctaEl instanceof HTMLAnchorElement) {
      const href = tariffCard.querySelector(".tariff-link")?.getAttribute("href") || ctaEl.href;
      const message = (btn.dataset.tariffCtaText || "").trim()
        || (courseTitle ? `Добрый день! Хочу записаться на курс «${courseTitle}»` : "Добрый день! Хочу записаться на курс");
      ctaEl.href = withTelegramPrefill(href, message);
    }
    switchEl?.querySelectorAll("button").forEach((item) => {
      item.setAttribute("aria-pressed", item.dataset.tariff === tariff.id ? "true" : "false");
    });
    buildProgram(tariff);
  };

  if (switchEl && tariffs.length > 1) {
    tariffs.forEach((tariff) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tdialog-switch-btn";
      item.dataset.tariff = tariff.id;
      item.textContent = tariff.name;
      item.addEventListener("click", () => {
        if (current === tariff) return;
        fill(tariff);
        writeParam(tariff.id);
      });
      switchEl.appendChild(item);
    });
  }

  // --- открытие / закрытие с анимацией
  let closing = false;
  const open = (tariff, trigger) => {
    opener = trigger || tariff.btn;
    fill(tariff);
    setCallbackPopOpen(false);
    closing = false;
    card?.style.removeProperty("transform");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    requestAnimationFrame(() => dialog.classList.add("is-open"));
    writeParam(tariff.id);
  };

  const finishClose = () => {
    dialog.classList.remove("is-open", "is-closing");
    card?.style.removeProperty("transform");
    card?.style.removeProperty("transition");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    closing = false;
    writeParam("");
    if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
  };

  const close = () => {
    if (closing || !dialog.open) return;
    closing = true;
    setCallbackPopOpen(false);
    dialog.classList.add("is-closing");
    dialog.classList.remove("is-open");
    if (reducedMotion) {
      finishClose();
      return;
    }
    window.setTimeout(finishClose, 280);
  };

  tariffs.forEach((tariff) => {
    tariff.btn.addEventListener("click", (event) => {
      event.preventDefault();
      open(tariff, tariff.btn);
    });
  });

  callbackPopOpenBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    setCallbackPopOpen(true);
  });
  dialog.querySelectorAll("[data-callback-pop-close]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      setCallbackPopOpen(false);
    });
  });

  // ссылка «оплата частями» в окне ведёт к калькулятору — окно закрываем
  monthlyEl?.addEventListener("click", () => close());

  closeBtn?.addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (callbackPop instanceof HTMLElement && !callbackPop.hidden) {
      setCallbackPopOpen(false);
      return;
    }
    close();
  });

  // --- шторка на телефоне: тянем за «ручку» вниз
  if (grab && card && window.PointerEvent) {
    let startY = 0;
    let dragging = false;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    grab.addEventListener("pointerdown", (event) => {
      dragging = true;
      startY = event.clientY;
      lastY = startY;
      lastT = performance.now();
      grab.setPointerCapture(event.pointerId);
      card.style.transition = "none";
    });
    grab.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const dy = Math.max(0, event.clientY - startY);
      const now = performance.now();
      velocity = (event.clientY - lastY) / Math.max(1, now - lastT);
      lastY = event.clientY;
      lastT = now;
      card.style.transform = `translateY(${dy}px)`;
    });
    const endDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      const dy = Math.max(0, event.clientY - startY);
      card.style.removeProperty("transition");
      if (dy > 120 || velocity > 0.8) {
        close();
      } else {
        card.style.removeProperty("transform");
      }
    };
    grab.addEventListener("pointerup", endDrag);
    grab.addEventListener("pointercancel", endDrag);
  }

  // ?tariff=junior — открыть сразу (ссылка из соцсетей/рассылки)
  const requested = new URLSearchParams(window.location.search).get("tariff");
  const match = tariffs.find((tariff) => tariff.id === requested);
  if (match) window.setTimeout(() => open(match, match.btn), 300);
})();

(() => {
  const forms = document.querySelectorAll("[data-callback-form]");
  if (!forms.length) return;

  const parseDetail = (payload) => {
    if (!payload) return "";
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail.map((item) => item.msg || item).join(", ");
    }
    return "";
  };

  forms.forEach((form) => {
    if (!(form instanceof HTMLFormElement)) return;
    const statusEl = form.querySelector("[data-callback-status]");
    const submitBtn = form.querySelector('button[type="submit"]');

    const clearFieldError = (input) => {
      const field = input.closest(".callback-field");
      const error = field?.querySelector("[data-field-error]");
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
      if (error instanceof HTMLElement) {
        error.hidden = true;
        error.textContent = "";
      }
    };

    const showFieldError = (input, message) => {
      const field = input.closest(".callback-field");
      const error = field?.querySelector("[data-field-error]");
      if (!(error instanceof HTMLElement)) return;
      if (!error.id) error.id = `${input.name}-error-${Math.random().toString(36).slice(2, 7)}`;
      error.hidden = false;
      error.textContent = message;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", error.id);
    };

    const fieldMessage = (input) => {
      const value = input.value.trim();
      if (input.name === "name") {
        if (!value) return "Введите имя.";
        if (value.length < 2) return "Имя должно быть не короче 2 букв.";
      }
      if (input.name === "phone") {
        const digits = value.replace(/\D/g, "");
        if (!value) return "Введите телефон.";
        if (digits.length < 10) return "Введите телефон в формате +7 …";
      }
      if (input.name === "comment" && value.length > 300) {
        return "Комментарий не длиннее 300 символов.";
      }
      return "";
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fields = [...form.querySelectorAll("input, textarea")].filter(
        (el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      );
      fields.forEach((input) => {
        if (input.type !== "hidden") clearFieldError(input);
      });
      const invalid = fields.filter((input) => input.type !== "hidden" && fieldMessage(input));
      if (invalid.length) {
        invalid.forEach((input) => showFieldError(input, fieldMessage(input)));
        invalid[0].focus();
        if (statusEl) {
          statusEl.textContent = "";
          statusEl.classList.remove("is-error", "is-success");
        }
        return;
      }
      if (statusEl) {
        statusEl.textContent = "Отправляем…";
        statusEl.classList.remove("is-error", "is-success");
      }
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;

      try {
        const payload = new FormData(form);
        if (!payload.get("source")) {
          payload.set("source", form.dataset.callbackSource || "site");
        }
        const courseField = form.querySelector("[data-tariff-dialog-course]");
        const keepCourse =
          courseField instanceof HTMLInputElement ? courseField.value : "";
        const response = await fetch("/api/callback", {
          method: "POST",
          body: payload,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(parseDetail(data) || "Не удалось отправить заявку");
        }
        form.reset();
        if (courseField instanceof HTMLInputElement) {
          courseField.value = keepCourse;
        }
        if (statusEl) {
          statusEl.textContent = data.detail || "Заявка отправлена";
          statusEl.classList.add("is-success");
        }
        if (window.nailisToast) {
          window.nailisToast.success(data.detail || "Заявка отправлена");
        }
        const pop = form.closest("[data-callback-pop]");
        if (pop instanceof HTMLElement) {
          window.setTimeout(() => {
            pop.hidden = true;
          }, 700);
        }
      } catch (error) {
        const message = error?.message || "Ошибка отправки";
        if (statusEl) {
          statusEl.textContent = message;
          statusEl.classList.add("is-error");
        }
        if (window.nailisToast) {
          window.nailisToast.error(message);
        }
      } finally {
        if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
      }
    });
  });
})();



(() => {
  const list = document.querySelector("[data-faq-list]");
  if (!list) return;
  const items = [...list.querySelectorAll("details.faq-item")];
  let syncing = false;

  const writeFaq = (value) => {
    const url = new URL(window.location.href);
    if (!value) url.searchParams.delete("faq");
    else url.searchParams.set("faq", value);
    history.replaceState(null, "", url);
  };

  const syncFrom = (item) => {
    if (syncing) return;
    if (item.open) {
      syncing = true;
      items.forEach((other) => {
        if (other !== item && other.open) {
          // home-motion.js подменяет мгновенное закрытие на анимированное
          if (typeof window.nhFaqClose === "function") window.nhFaqClose(other);
          else other.open = false;
        }
      });
      syncing = false;
      writeFaq(item.dataset.faq || "");
      return;
    }
    if (!items.some((other) => other.open)) writeFaq("");
  };

  items.forEach((item) => {
    item.addEventListener("toggle", () => syncFrom(item));
    item.querySelector("summary")?.addEventListener("click", () => {
      window.setTimeout(() => syncFrom(item), 0);
    });
  });

  const initial = new URLSearchParams(window.location.search).get("faq");
  const match = items.find((item) => item.dataset.faq === initial);
  if (match) {
    syncing = true;
    match.open = true;
    syncing = false;
  }
})();

(() => {
  const root = document.querySelector("[data-reveal]#installment-calc, #installment-calc");
  if (!(root instanceof HTMLElement)) return;

  const amountBtns = [...root.querySelectorAll("[data-installment-amount]")];
  const termBtns = [...root.querySelectorAll("[data-installment-months]")];
  const monthlyEl = root.querySelector("[data-installment-monthly]");
  const totalEl = root.querySelector("[data-installment-total]");
  const feeEl = root.querySelector("[data-installment-fee]");
  const termLabelEl = root.querySelector("[data-installment-term-label]");
  const ctaEl = root.querySelector("[data-installment-cta]");

  let amount = 40000;
  let months = 3;
  let rate = 5;

  const formatRub = (value) =>
    `${Math.round(value).toLocaleString("ru-RU")}\u00A0₽`;

  const termWord = (n) => {
    if (n === 1) return "1\u00A0месяц";
    if (n >= 2 && n <= 4) return `${n}\u00A0месяца`;
    return `${n}\u00A0месяцев`;
  };

  const writeCalcParams = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("amount", String(amount));
    url.searchParams.set("months", String(months));
    history.replaceState(null, "", url);
  };

  const selectAmount = (btn, { user = false } = {}) => {
    amount = Number(btn.getAttribute("data-installment-amount")) || amount;
    amountBtns.forEach((item) => {
      const active = item === btn;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", active ? "true" : "false");
    });
    render();
    if (user) writeCalcParams();
  };

  const selectTerm = (btn, { user = false } = {}) => {
    months = Number(btn.getAttribute("data-installment-months")) || months;
    rate = Number(btn.getAttribute("data-installment-rate")) || rate;
    termBtns.forEach((item) => {
      const active = item === btn;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-checked", active ? "true" : "false");
      item.tabIndex = active ? 0 : -1;
    });
    render();
    if (user) writeCalcParams();
  };

  const render = () => {
    const total = amount * (1 + rate / 100);
    const fee = total - amount;
    const monthly = total / months;

    if (monthlyEl) monthlyEl.textContent = formatRub(monthly);
    if (totalEl) totalEl.textContent = formatRub(total);
    if (feeEl) feeEl.textContent = formatRub(fee);
    if (termLabelEl) termLabelEl.textContent = termWord(months);

    if (ctaEl instanceof HTMLAnchorElement) {
      const message =
        `Добрый день! Хочу оформить обучение с оплатой частями на ${termWord(months)} ` +
        `(сумма курса ${formatRub(amount)}, платёж ~${formatRub(monthly)}/мес). Подскажите условия.`;
      try {
        const url = new URL(ctaEl.href, window.location.origin);
        url.searchParams.set("text", message);
        ctaEl.href = url.toString();
      } catch (_) {
        /* keep existing href */
      }
    }
  };

  amountBtns.forEach((btn) => {
    btn.addEventListener("click", () => selectAmount(btn, { user: true }));
  });

  termBtns.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      selectTerm(btn, { user: true });
      btn.focus();
    });
    btn.addEventListener("keydown", (event) => {
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
      if (!forward && !backward) return;
      event.preventDefault();
      const next = termBtns[(index + (forward ? 1 : -1) + termBtns.length) % termBtns.length];
      selectTerm(next, { user: true });
      next.focus();
    });
  });

  const params = new URLSearchParams(window.location.search);
  const urlAmount = amountBtns.find(
    (btn) => btn.getAttribute("data-installment-amount") === params.get("amount")
  );
  const urlTerm = termBtns.find(
    (btn) => btn.getAttribute("data-installment-months") === params.get("months")
  );
  if (urlAmount) selectAmount(urlAmount);
  else {
    const activeAmount = amountBtns.find((btn) => btn.classList.contains("is-active"));
    if (activeAmount) selectAmount(activeAmount);
  }
  if (urlTerm) selectTerm(urlTerm);
  else {
    const activeTerm = termBtns.find((btn) => btn.classList.contains("is-active"));
    if (activeTerm) selectTerm(activeTerm);
  }
  render();

  const navOffset = () => {
    const nav = document.querySelector(".navbar.site-navbar");
    const shell = nav?.querySelector(".navbar-shell");
    const height = (shell || nav)?.getBoundingClientRect().height || 72;
    return Math.ceil(height + 20);
  };

  const scrollToCalc = () => {
    root.classList.add("is-visible");
    document.getElementById("formats")?.classList.add("is-visible");
    const top = root.getBoundingClientRect().top + window.scrollY - navOffset();
    // При плавном скролле (Lenis из home-motion.js) нативный scrollTo с ним конфликтует
    if (window.nhLenis) window.nhLenis.scrollTo(Math.max(0, top));
    else window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  document.querySelectorAll('a[href="#installment-calc"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToCalc();
      const url = new URL(window.location.href);
      url.hash = "installment-calc";
      history.pushState(null, "", url);
    });
  });

  if (window.location.hash === "#installment-calc") {
    window.requestAnimationFrame(() => {
      window.setTimeout(scrollToCalc, 50);
    });
  }
})();

(() => {
  const gallery = document.querySelector("[data-certs-gallery]");
  const dialog = document.querySelector("[data-cert-lightbox]");
  const dialogImg = dialog?.querySelector("[data-cert-lightbox-img]");
  const closeBtn = dialog?.querySelector("[data-cert-close]");
  const prevBtn = dialog?.querySelector("[data-cert-prev]");
  const nextBtn = dialog?.querySelector("[data-cert-next]");
  const countEl = dialog?.querySelector("[data-cert-count]");
  if (!(gallery instanceof HTMLElement) || !(dialog instanceof HTMLDialogElement) || !(dialogImg instanceof HTMLImageElement)) {
    return;
  }

  const slides = Array.from(gallery.querySelectorAll("[data-cert-open]")).flatMap((btn) => {
    const img = btn.querySelector("img");
    if (!(img instanceof HTMLImageElement) || !img.src) return [];
    return [{
      btn,
      src: img.currentSrc || img.src,
      alt: img.alt || "Работа",
      width: Number(img.getAttribute("width")) || img.naturalWidth || 720,
      height: Number(img.getAttribute("height")) || img.naturalHeight || 1280,
    }];
  });

  let index = 0;
  let pointerId = null;
  let startX = 0;
  let startY = 0;

  const show = (i) => {
    if (!slides.length) return;
    index = (i + slides.length) % slides.length;
    const slide = slides[index];
    dialogImg.src = slide.src;
    dialogImg.alt = slide.alt;
    dialogImg.width = slide.width;
    dialogImg.height = slide.height;
    if (countEl instanceof HTMLElement) {
      countEl.textContent = `${index + 1}\u00A0из\u00A0${slides.length}`;
    }
  };

  const open = (i) => {
    show(i);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  };

  const close = () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    dialogImg.removeAttribute("src");
    pointerId = null;
  };

  const prev = () => show(index - 1);
  const next = () => show(index + 1);

  slides.forEach((slide, i) => {
    slide.btn.addEventListener("click", () => open(i));
  });

  prevBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    prev();
  });
  nextBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    next();
  });
  closeBtn?.addEventListener("click", close);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      prev();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    }
  });

  dialog.addEventListener("pointerdown", (event) => {
    if (!(event.target instanceof Element) || event.target.closest("button")) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
  });
  dialog.addEventListener("pointerup", (event) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) next();
    else prev();
  });
  dialog.addEventListener("pointercancel", () => {
    pointerId = null;
  });
})();

// Отзывы-мессенджер: переключение переписок (role="tab").
// Анимацию «печатает…» при открытии чата делает home-motion.js (событие nh:msgr-open).
(() => {
  const root = document.querySelector("[data-msgr]");
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll("[data-msgr-tab]"));
  const chats = Array.from(root.querySelectorAll("[data-msgr-chat]"));
  if (!tabs.length || tabs.length !== chats.length) return;

  const select = (index, { focus = false } = {}) => {
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    chats.forEach((chat, i) => { chat.hidden = i !== index; });
    tabs[index].scrollIntoView({ block: "nearest", inline: "nearest" });
    root.dispatchEvent(new CustomEvent("nh:msgr-open", { detail: { chat: chats[index] } }));
  };

  tabs.forEach((tab, i) => tab.addEventListener("click", () => select(i)));
  root.querySelector("[data-msgr-list]")?.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (event.key in keys) {
      event.preventDefault();
      select((index + keys[event.key] + tabs.length) % tabs.length, { focus: true });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      select(event.key === "Home" ? 0 : tabs.length - 1, { focus: true });
    }
  });

  // без JS видны все переписки подряд; с JS — только выбранная
  chats.forEach((chat, i) => { chat.hidden = i !== 0; });

  // «Оригинал» и фото в сообщениях — крупно
  const lightbox = root.parentElement?.querySelector("[data-msgr-lightbox]");
  const lightboxImg = lightbox?.querySelector("[data-msgr-lightbox-img]");
  if (lightbox instanceof HTMLDialogElement && lightboxImg instanceof HTMLImageElement) {
    let opener = null;
    const close = () => {
      lightbox.close();
      lightboxImg.removeAttribute("src");
      opener?.focus({ preventScroll: true });
    };
    root.addEventListener("click", (event) => {
      const trigger = event.target.closest?.("[data-msgr-zoom]");
      if (!trigger) return;
      opener = trigger;
      lightboxImg.src = trigger.dataset.msgrZoom;
      lightboxImg.alt = trigger.dataset.msgrZoomAlt || "";
      lightbox.showModal();
    });
    lightbox.querySelector("[data-msgr-lightbox-close]")?.addEventListener("click", close);
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) close();
    });
    lightbox.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
  }
})();
