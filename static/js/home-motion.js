/*
 * Анимации главной: плавный скролл (Lenis) + сцены на GSAP ScrollTrigger.
 * Первый экран (hero) не трогаем. При prefers-reduced-motion или без GSAP
 * ничего не делаем — страница остаётся статичной и полностью читаемой.
 */
(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (reducedMotion || !gsap || !ScrollTrigger) return;

  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add("nh-motion");

  const finePointer = window.matchMedia("(pointer: fine)").matches;

  // ---------- Плавный скролл ----------
  let lenis = null;
  if (window.Lenis && finePointer) {
    lenis = new window.Lenis({
      lerp: 0.11,
      smoothWheel: true,
      prevent: (node) => Boolean(node.closest?.("dialog, [data-lenis-prevent], .works-index")),
    });
    window.nhLenis = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    // Якорные ссылки (#formats, #faq …) — через Lenis, с отступом под шапку
    document.addEventListener("click", (event) => {
      // свой обработчик у ссылки (калькулятор рассрочки) уже сам прокрутил страницу
      if (event.defaultPrevented) return;
      const link = event.target.closest?.('a[href^="#"]');
      if (!link) return;
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      lenis.scrollTo(target, { offset: -90 });
      history.replaceState(null, "", id);
    });

    // Модалки (тарифы, лайтбокс): пока открыты — страницу не скроллим
    const syncDialogs = () => {
      const anyOpen = document.querySelector("dialog[open]");
      if (anyOpen) lenis.stop();
      else lenis.start();
    };
    document.querySelectorAll("dialog").forEach((dialog) => {
      new MutationObserver(syncDialogs).observe(dialog, { attributes: true, attributeFilter: ["open"] });
    });
  }

  const mm = gsap.matchMedia();
  const DESKTOP = "(min-width: 900px)";

  // Обёртка над from(): конечные значения задаём явно. Обычный from()
  // запоминает «текущее» состояние как финальное, и если ScrollTrigger.refresh
  // (догрузились картинки) попадает на старт анимации, элемент так и
  // остаётся с opacity: 0.
  const TWEEN_OPTIONS = new Set([
    "duration", "ease", "stagger", "delay", "clearProps", "scrollTrigger",
    "transformOrigin", "transformPerspective", "onComplete",
  ]);
  const NEUTRAL = {
    x: 0, y: 0, xPercent: 0, yPercent: 0, rotate: 0, rotateX: 0, rotateY: 0,
    scale: 1, scaleX: 1, scaleY: 1, autoAlpha: 1, clipPath: "inset(0% 0% 0% 0%)",
  };
  const from = (targets, vars, timeline, position) => {
    const start = {};
    const end = {};
    Object.entries(vars).forEach(([key, value]) => {
      if (TWEEN_OPTIONS.has(key)) {
        end[key] = value;
      } else {
        start[key] = value;
        end[key] = NEUTRAL[key];
      }
    });
    return (timeline || gsap).fromTo(targets, start, end, position);
  };

  // ---------- Заголовки секций: проявление из-под маски ----------
  document.querySelectorAll(".home-shell-v2 > .home-section .section-head").forEach((head) => {
    const title = head.querySelector("h2");
    const kicker = head.querySelector(".kicker");
    const tl = gsap.timeline({
      scrollTrigger: { trigger: head, start: "top 85%", toggleActions: "play none none none" },
    });
    if (kicker) from(kicker, { y: 14, autoAlpha: 0, duration: 0.6, ease: "power2.out" }, tl);
    if (title) {
      tl.fromTo(
        title,
        { clipPath: "inset(0% 0% 100% 0%)", y: 36 },
        { clipPath: "inset(0% 0% -20% 0%)", y: 0, duration: 1.1, ease: "expo.out" },
        kicker ? "-=0.35" : 0,
      );
    }
  });

  // ---------- Об инструкторе: слои с разной скоростью ----------
  const depthScene = document.querySelector("[data-depth-scene]");
  if (depthScene) {
    depthScene.querySelectorAll("[data-depth]").forEach((layer) => {
      const depth = Number(layer.dataset.depth || 0);
      gsap.fromTo(
        layer,
        { yPercent: depth * -40 },
        {
          yPercent: depth * 40,
          ease: "none",
          scrollTrigger: { trigger: depthScene, start: "top bottom", end: "bottom top", scrub: true },
        },
      );
    });
    // Арка «вырастает» снизу при первом появлении
    from(depthScene.querySelector(".about-depth-arch"), {
      scaleY: 0.2,
      transformOrigin: "50% 100%",
      duration: 1.4,
      ease: "expo.out",
      scrollTrigger: { trigger: depthScene, start: "top 80%", toggleActions: "play none none none" },
    });
    from(depthScene.querySelector(".about-depth-figure"), {
      autoAlpha: 0,
      y: 60,
      duration: 1.3,
      delay: 0.15,
      ease: "power3.out",
      scrollTrigger: { trigger: depthScene, start: "top 80%", toggleActions: "play none none none" },
    });
  }

  const deck = document.querySelector("[data-certs-deck]");
  if (deck) {
    from(deck.children, {
      rotateY: -75,
      x: -40,
      autoAlpha: 0,
      duration: 0.9,
      ease: "power3.out",
      stagger: 0.08,
      clearProps: "transform", // вернуть CSS-ховер карточкам
      scrollTrigger: { trigger: deck, start: "top 90%", toggleActions: "play none none none" },
    });
  }

  // ---------- Что вы получите: линии прорисовываются, пункты проявляются ----------
  const benefits = document.querySelector("[data-benefits]");
  if (benefits) {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: benefits, start: "top 80%", toggleActions: "play none none none" },
    });
    from(benefits.querySelectorAll(".benefit-rule"), {
      scaleX: 0, duration: 0.9, ease: "power3.inOut", stagger: 0.12,
    }, tl);
    from(benefits.querySelectorAll(".benefit-icon"), {
      scale: 0.4, autoAlpha: 0, rotate: -40, duration: 0.6, ease: "back.out(2)", stagger: 0.12,
    }, tl, 0.25);
    from(benefits.querySelectorAll(".benefit-copy"), {
      x: 24, autoAlpha: 0, duration: 0.7, ease: "power3.out", stagger: 0.12,
    }, tl, 0.3);
  }

  // ---------- Бегущая строка: наклон от скорости скролла ----------
  const marquees = gsap.utils.toArray(".home-marquee");
  if (marquees.length) {
    const skewTo = marquees.map((el) => gsap.quickTo(el, "skewX", { duration: 0.5, ease: "power3.out" }));
    ScrollTrigger.create({
      onUpdate: (self) => {
        const skew = gsap.utils.clamp(-10, 10, self.getVelocity() / -250);
        skewTo.forEach((fn) => fn(skew));
      },
    });
  }

  // ---------- Тарифы: появление карточек и счётчик цены ----------
  const tariffCards = gsap.utils.toArray("[data-tariff-card]");
  if (tariffCards.length) {
    from(tariffCards, {
      y: 60,
      autoAlpha: 0,
      duration: 1,
      ease: "expo.out",
      stagger: 0.12,
      clearProps: "transform",
      scrollTrigger: { trigger: "[data-tariff-grid]", start: "top 82%", toggleActions: "play none none none" },
    });

    document.querySelectorAll("[data-tariff-price]").forEach((node) => {
      const raw = node.textContent || "";
      const target = Number(raw.replace(/\D/g, ""));
      if (!target) return;
      const format = (value) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, "\u00a0")}\u00a0₽`;
      const state = { value: 0 };
      gsap.to(state, {
        value: target,
        duration: 1.6,
        ease: "power3.out",
        snap: { value: 500 },
        onUpdate: () => { node.textContent = format(state.value); },
        onComplete: () => { node.textContent = raw; },
        scrollTrigger: { trigger: node, start: "top 90%", toggleActions: "play none none none" },
      });
    });
  }

  // ---------- Результаты: экран блокировки iPhone снимается при прокрутке ----------
  const phone = document.querySelector("[data-works-phone]");
  if (phone) {
    const lock = phone.querySelector("[data-works-lock]");
    if (lock) {
      const timeEl = lock.querySelector("[data-lock-time]");
      const dateEl = lock.querySelector("[data-lock-date]");
      const countEl = lock.querySelector("[data-lock-count]");
      const surface = lock.querySelector("[data-works-unlock]");

      const tickClock = () => {
        const now = new Date();
        if (timeEl) {
          timeEl.textContent = now.toLocaleTimeString("ru-RU", { hour: "numeric", minute: "2-digit" });
        }
        if (dateEl) {
          dateEl.textContent = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
        }
      };
      tickClock();
      window.setInterval(tickClock, 30 * 1000);

      const total = document.querySelectorAll("[data-works-thumb]").length;
      if (countEl && total) {
        const word = new Intl.PluralRules("ru-RU").select(total);
        const forms = { one: "работа", few: "работы", many: "работ", other: "работы" };
        countEl.textContent = `${total} ${forms[word] || "работ"} учениц с базового курса`;
      }

      const content = lock.querySelectorAll(".works-lock-date, .works-lock-time, .works-lock-note, .works-lock-hint");
      // index-page.js держит автопрокрутку галереи на паузе, пока экран заблокирован
      const gallery = phone.closest("[data-works-focus]");
      const announce = (locked) => {
        gallery?.dispatchEvent(new CustomEvent("nh:works-lock", { detail: { locked } }));
      };
      // Разблокировка одноразовая: раньше экран снова блокировался при малейшей
      // прокрутке вверх и «моргал», пока человек листал работы.
      let unlocked = false;
      const unlock = ({ pause = true } = {}) => {
        if (unlocked) return;
        unlocked = true;
        gsap
          .timeline({
            delay: pause ? 0.6 : 0, // даём рассмотреть экран блокировки
            onStart: () => lock.classList.add("is-unlocked"), // дужка замка откидывается (CSS)
            onComplete: () => {
              lock.hidden = true; // убираем слой совсем, чтобы ничего не перекрывал
              announce(false);
            },
          })
          .to(content, { y: -40, autoAlpha: 0, duration: 0.45, ease: "power2.in", stagger: 0.04 }, 0.3)
          .to(lock, { yPercent: -102, duration: 0.75, ease: "power3.inOut" }, 0.55);
      };

      surface?.addEventListener("click", () => unlock({ pause: false }));
      // выбрали работу в списке или стрелкой, пока экран заблокирован, — открываем
      gallery?.querySelectorAll("[data-works-thumb], [data-works-prev], [data-works-next]").forEach((control) => {
        control.addEventListener("click", () => unlock({ pause: false }));
      });

      // Открываем, когда телефон открыт на экране: его центр поднялся до 55% высоты
      // окна (телефон по высоте ограничен в CSS, так что он целиком виден).
      // Граница не зависит от высоты телефона — не «прыгает» при смене высоты окна.
      ScrollTrigger.create({
        trigger: phone,
        start: "center 55%",
        onEnter: () => unlock(),
        onLeave: () => unlock({ pause: false }),
        // страницу открыли уже ниже телефона (обновление, якорь) — сразу без замка
        onRefresh: (self) => {
          if (self.progress > 0) unlock({ pause: false });
        },
      });
    }

    const stage = phone.querySelector(".works-focus-stage");
    const flip = (direction) => {
      if (!stage) return;
      gsap.fromTo(
        stage,
        { rotateY: 28 * direction, autoAlpha: 0.4, transformPerspective: 1000 },
        { rotateY: 0, autoAlpha: 1, duration: 0.7, ease: "power3.out", clearProps: "transform" },
      );
    };
    document.querySelector("[data-works-next]")?.addEventListener("click", () => flip(1));
    document.querySelector("[data-works-prev]")?.addEventListener("click", () => flip(-1));
    const thumbs = Array.from(document.querySelectorAll("[data-works-thumb]"));
    thumbs.forEach((thumb) => {
      thumb.addEventListener("click", () => {
        const current = thumbs.findIndex((item) => item.classList.contains("is-active"));
        flip(thumbs.indexOf(thumb) >= current ? 1 : -1);
      }, true); // capture: читаем активную работу до того, как её сменит index-page.js
    });

    const listItems = document.querySelectorAll(".works-index > li");
    if (listItems.length) {
      from(listItems, {
        x: 40,
        autoAlpha: 0,
        duration: 0.6,
        ease: "power2.out",
        stagger: 0.05,
        scrollTrigger: { trigger: ".works-index", start: "top 85%", toggleActions: "play none none none" },
      });
    }
  }

  // ---------- Отзывы-мессенджер: сообщения «приходят» с «печатает…» ----------
  const msgr = document.querySelector("[data-msgr]");
  if (msgr) {
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const played = new WeakSet();
    let sectionSeen = false;
    let runId = 0;

    const scrollFeed = (feed) => {
      if (feed) feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
    };

    const showAll = (chat) => {
      chat.querySelectorAll("[data-msgr-msg]").forEach((row) => {
        row.classList.remove("is-typing");
        row.classList.add("is-shown");
      });
      played.add(chat);
    };

    const play = async (chat) => {
      if (!chat || played.has(chat)) return;
      played.add(chat);
      const id = ++runId;
      const feed = chat.querySelector(".msgr-feed");
      const rows = Array.from(chat.querySelectorAll("[data-msgr-msg]"));
      for (const row of rows) {
        // переключились на другой чат — этот дорисовываем сразу
        if (id !== runId) {
          showAll(chat);
          return;
        }
        const incoming = row.classList.contains("msgr-row--in");
        row.classList.add("is-typing");
        scrollFeed(feed);
        await wait(incoming ? 700 : 500);
        row.classList.remove("is-typing");
        row.classList.add("is-shown");
        gsap.fromTo(
          row.querySelector(".msgr-bubble"),
          { scale: 0.85, autoAlpha: 0, y: 8 },
          { scale: 1, autoAlpha: 1, y: 0, duration: 0.4, ease: "back.out(1.7)", clearProps: "transform,opacity,visibility" },
        );
        scrollFeed(feed);
        await wait(260);
      }
    };

    const activeChat = () => msgr.querySelector("[data-msgr-chat]:not([hidden])");

    msgr.addEventListener("nh:msgr-open", (event) => {
      const chat = event.detail?.chat;
      runId += 1; // прервать проигрывание прошлого чата
      if (sectionSeen) play(chat);
    });

    ScrollTrigger.create({
      trigger: msgr,
      start: "top 70%",
      onEnter: () => {
        sectionSeen = true;
        play(activeChat());
      },
      onEnterBack: () => {
        sectionSeen = true;
        play(activeChat());
      },
      // проскочили мимо (якорь, быстрая прокрутка) — показываем без анимации
      onLeave: () => {
        sectionSeen = true;
        runId += 1; // если чат ещё «печатается» — дорисовываем сразу
        const chat = activeChat();
        if (chat) showAll(chat);
      },
    });
    const revealIfPassed = () => {
      const rect = msgr.getBoundingClientRect();
      if (rect.bottom < 0) {
        sectionSeen = true;
        const chat = activeChat();
        if (chat && !played.has(chat)) showAll(chat);
      }
    };
    ScrollTrigger.addEventListener("refresh", revealIfPassed);
    window.setTimeout(revealIfPassed, 0);
  }

  // ---------- FAQ: плавное раскрытие + параллакс фото ----------
  const faqItems = Array.from(document.querySelectorAll("[data-faq-list] details.faq-item"));
  const animating = new WeakSet();

  const closeFaq = (item) => {
    const answer = item.querySelector(".faq-answer");
    if (!item.open || animating.has(item) || !answer) {
      if (!answer) item.open = false;
      return;
    }
    animating.add(item);
    gsap.fromTo(
      answer,
      { height: answer.offsetHeight },
      {
        height: 0,
        autoAlpha: 0,
        duration: 0.45,
        ease: "power2.inOut",
        onComplete: () => {
          item.open = false;
          gsap.set(answer, { clearProps: "height,opacity,visibility" });
          animating.delete(item);
        },
      },
    );
  };
  // index-page.js закрывает соседние вопросы через этот хук
  window.nhFaqClose = closeFaq;

  faqItems.forEach((item) => {
    const summary = item.querySelector("summary");
    const answer = item.querySelector(".faq-answer");
    if (!summary || !answer) return;
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (animating.has(item)) return;
      if (item.open) {
        closeFaq(item);
        return;
      }
      item.open = true;
      animating.add(item);
      gsap.fromTo(
        answer,
        { height: 0, autoAlpha: 0 },
        {
          height: "auto",
          autoAlpha: 1,
          duration: 0.55,
          ease: "power3.out",
          onComplete: () => {
            gsap.set(answer, { clearProps: "height,opacity,visibility" });
            animating.delete(item);
          },
        },
      );
    });
  });

  if (faqItems.length) {
    from(faqItems, {
      y: 24,
      autoAlpha: 0,
      duration: 0.6,
      ease: "power2.out",
      stagger: 0.07,
      scrollTrigger: { trigger: "[data-faq-list]", start: "top 85%", toggleActions: "play none none none" },
    });
  }

  const faqVisual = document.querySelector("[data-faq-visual]");
  if (faqVisual) {
    mm.add(DESKTOP, () => {
      gsap.fromTo(
        faqVisual,
        { yPercent: -8 },
        {
          yPercent: 0,
          ease: "none",
          scrollTrigger: { trigger: ".faq-section", start: "top bottom", end: "bottom top", scrub: true },
        },
      );
      from(".faq-visual-frame", {
        clipPath: "inset(100% 0% 0% 0%)",
        duration: 1.3,
        ease: "expo.out",
        scrollTrigger: { trigger: ".faq-section", start: "top 70%", toggleActions: "play none none none" },
      });
    });
  }

  // ---------- Финал: фото раскрывается из окна, заголовок по буквам ----------
  const ctaWindow = document.querySelector("[data-cta-window]");
  const ctaSection = document.querySelector(".final-cta");
  if (ctaWindow && ctaSection) {
    const photo = ctaWindow.querySelector("[data-cta-photo]");
    const veil = ctaWindow.querySelector(".final-cta-veil");
    mm.add(DESKTOP, () => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: ctaSection, start: "top 90%", end: "top 15%", scrub: 0.7 },
      });
      tl.fromTo(
        ctaWindow,
        { clipPath: "inset(14% 8% 14% 56% round 400px 400px 0px 0px)" },
        { clipPath: "inset(0% 0% 0% 0% round 0px 0px 0px 0px)", ease: "power2.inOut" },
        0,
      );
      if (photo) tl.fromTo(photo, { scale: 1.2 }, { scale: 1, ease: "power2.inOut" }, 0);
      if (veil) tl.fromTo(veil, { opacity: 0.2 }, { opacity: 1, ease: "none" }, 0);
    });
  }

  document.querySelectorAll("[data-split-chars]").forEach((heading) => {
    const text = heading.textContent.trim();
    heading.setAttribute("aria-label", text);
    heading.textContent = "";
    text.split(" ").forEach((word, wordIndex, words) => {
      const wordEl = document.createElement("span");
      wordEl.className = "nh-word";
      wordEl.setAttribute("aria-hidden", "true");
      Array.from(word).forEach((char) => {
        const charEl = document.createElement("span");
        charEl.className = "nh-char";
        charEl.textContent = char;
        wordEl.appendChild(charEl);
      });
      heading.appendChild(wordEl);
      if (wordIndex < words.length - 1) heading.appendChild(document.createTextNode(" "));
    });
    from(heading.querySelectorAll(".nh-char"), {
      yPercent: 110,
      rotateX: -80,
      autoAlpha: 0,
      transformPerspective: 600,
      duration: 0.9,
      ease: "back.out(1.6)",
      stagger: 0.035,
      scrollTrigger: { trigger: heading, start: "top 85%", toggleActions: "play none none none" },
    });
  });

  // Картинки, видео и шрифты догружаются и меняют высоту страницы —
  // без пересчёта триггеры срабатывают на сотни пикселей раньше/позже.
  let lastHeight = document.body.scrollHeight;
  let refreshTimer = 0;
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      const height = document.body.scrollHeight;
      if (Math.abs(height - lastHeight) < 2) return;
      lastHeight = height;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 200);
    }).observe(document.body);
  }
  // Ссылка с якорем (/#faq, /#formats): браузер прыгает к блоку до загрузки
  // картинок и шрифтов, потом вёрстка вырастает и страница оказывается не там.
  // После загрузки доводим до якоря ещё раз.
  const settleHash = () => {
    const id = window.location.hash;
    if (!id || id === "#installment-calc") return; // калькулятор index-page.js доводит сам
    let target = null;
    try { target = document.querySelector(id); } catch (_) { return; }
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 90;
    if (lenis) lenis.scrollTo(top, { immediate: true, force: true });
    else window.scrollTo(0, top);
    ScrollTrigger.update();
  };
  window.addEventListener("load", () => {
    ScrollTrigger.refresh();
    settleHash();
    document.fonts?.ready.then(() => window.setTimeout(settleHash, 50));
  });
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
})();
