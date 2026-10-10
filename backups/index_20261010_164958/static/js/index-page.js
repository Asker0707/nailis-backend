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

  const ensureSource = (video) => {
    const src = video.dataset.src;
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

  // Hero tape: keep all 6 clips playing while the hero is on screen
  const heroTape = document.querySelector("[data-hero-tape]");
  if (heroTape) {
    const heroVideos = Array.from(heroTape.querySelectorAll("video.hero-tape-video"));
    const playAllHero = () => heroVideos.forEach(playVideo);
    const pauseAllHero = () => heroVideos.forEach(pauseVideo);

    if (!("IntersectionObserver" in window)) {
      playAllHero();
    } else {
      const tapeObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) playAllHero();
          else pauseAllHero();
        });
      }, { threshold: 0.05 });
      tapeObserver.observe(heroTape);
    }
  }

  // Works focus gallery
  const worksFocus = document.querySelector("[data-works-focus]");
  if (worksFocus instanceof HTMLElement) {
    const thumbs = Array.from(worksFocus.querySelectorAll("[data-works-thumb]"));
    const focusVideo = worksFocus.querySelector("[data-works-focus-video]");
    const focusImage = worksFocus.querySelector("[data-works-focus-image]");
    const pauseBtn = worksFocus.querySelector("[data-works-pause]");
    const prevBtn = worksFocus.querySelector("[data-works-prev]");
    const nextBtn = worksFocus.querySelector("[data-works-next]");
    const counterEl = worksFocus.querySelector("[data-works-counter]");
    const indexList = worksFocus.querySelector("[data-works-thumbs]");
    const stage = worksFocus.querySelector(".works-focus-stage");
    let activeIndex = Math.max(0, thumbs.findIndex((thumb) => thumb.classList.contains("is-active")));
    let timerId = null;
    let sectionVisible = true;
    let paused = false;
    let userPaused = false;

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
      const poster = thumb.getAttribute("data-poster") || src;

      thumbs.forEach((item, i) => {
        const on = i === activeIndex;
        item.classList.toggle("is-active", on);
        item.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (fromUser) writeParam("work", activeIndex + 1);
      if (counterEl instanceof HTMLElement) {
        counterEl.textContent = `${activeIndex + 1}\u00A0из\u00A0${thumbs.length}`;
      }

      if (pauseBtn instanceof HTMLButtonElement) pauseBtn.hidden = type !== "video";

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
          focusVideo.dataset.currentSrc = src;
          focusVideo.dataset.loaded = "0";
          focusVideo.removeAttribute("src");
        }

        if (sectionVisible && !document.hidden && !reducedMotion && !userPaused) {
          playVideo(focusVideo);
        } else {
          ensureSource(focusVideo);
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
      if (reducedMotion || thumbs.length < 2 || paused || userPaused) return;
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
      showFocus(activeIndex + delta, { fromUser: true });
      stopAutoplay();
      startAutoplay();
    };

    if (prevBtn instanceof HTMLButtonElement) prevBtn.addEventListener("click", () => step(-1));
    if (nextBtn instanceof HTMLButtonElement) nextBtn.addEventListener("click", () => step(1));

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

    if (pauseBtn instanceof HTMLButtonElement) {
      pauseBtn.addEventListener("click", () => {
        userPaused = !userPaused;
        pauseBtn.setAttribute("aria-pressed", userPaused ? "true" : "false");
        pauseBtn.textContent = userPaused ? "Смотреть" : "Пауза";
        if (userPaused) {
          stopAutoplay();
          if (focusVideo instanceof HTMLVideoElement) pauseVideo(focusVideo);
          return;
        }
        if (sectionVisible && !document.hidden) {
          if (focusVideo instanceof HTMLVideoElement && !focusVideo.hidden) playVideo(focusVideo);
          startAutoplay();
        }
      });
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
          const visible = rect.bottom > 0 && rect.top < window.innerHeight;
          if (visible) playVideo(video);
        }
      });
    }
  });
})();

  const cohortDateEl = document.getElementById("cohort-date");
  if (cohortDateEl) {
    const nextCohort = new Date();
    nextCohort.setDate(nextCohort.getDate() + 10);
    cohortDateEl.textContent = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
    }).format(nextCohort);
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const proofCards = Array.from(document.querySelectorAll(".proof-card"));
  const proofCanvasStates = new WeakMap();
  const sectionRevealStates = new WeakMap();
  const canvasEffectsEnabled = false;
  const liquidLightEnabled = !prefersReducedMotion && window.innerWidth >= 1024;
  const cursorTrailEnabled = !prefersReducedMotion && finePointer && window.innerWidth >= 1024;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const fitCanvas = (canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, rect };
  };

  const parseDurationMs = (value) => {
    const source = String(value || "").trim();
    if (!source) return 0;
    if (source.endsWith("ms")) return Number.parseFloat(source) || 0;
    if (source.endsWith("s")) return (Number.parseFloat(source) || 0) * 1000;
    return Number.parseFloat(source) || 0;
  };

  const initSceneLiquidCanvas = () => {
    const canvas = document.querySelector("[data-scene-liquid]");
    if (!(canvas instanceof HTMLCanvasElement) || !liquidLightEnabled) return;

    const blobs = [
      { x: 0.14, y: 0.18, r: 0.2, hue: "255, 244, 236", alpha: 0.34, drift: 0.95, depth: 0.04, phase: 0.2 },
      { x: 0.82, y: 0.22, r: 0.17, hue: "245, 219, 206", alpha: 0.24, drift: 1.15, depth: 0.06, phase: 1.4 },
      { x: 0.66, y: 0.74, r: 0.22, hue: "255, 248, 243", alpha: 0.2, drift: 0.74, depth: 0.05, phase: 2.1 },
    ];
    let lastFrameAt = 0;
    const minFrameGap = 1000 / 14;

    const render = (now) => {
      if (now - lastFrameAt < minFrameGap) {
        requestAnimationFrame(render);
        return;
      }
      lastFrameAt = now;

      const setup = fitCanvas(canvas);
      if (!setup) {
        requestAnimationFrame(render);
        return;
      }

      const { ctx, rect } = setup;
      const scrollY = window.scrollY || 0;

      ctx.globalCompositeOperation = "screen";
      blobs.forEach((blob, index) => {
        const px = rect.width * blob.x + Math.sin(now * 0.00012 * blob.drift + blob.phase) * rect.width * 0.03;
        const py = rect.height * blob.y + Math.cos(now * 0.00016 * blob.drift + blob.phase * 1.2) * rect.height * 0.045 - scrollY * blob.depth;
        const radius = rect.width * blob.r * (0.92 + Math.sin(now * 0.00019 + index) * 0.06);
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
        gradient.addColorStop(0, `rgba(${blob.hue}, ${blob.alpha})`);
        gradient.addColorStop(0.44, `rgba(${blob.hue}, ${blob.alpha * 0.42})`);
        gradient.addColorStop(1, `rgba(${blob.hue}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  };

  const initCursorTrailCanvas = () => {
    const canvas = document.querySelector("[data-cursor-trail]");
    if (!(canvas instanceof HTMLCanvasElement) || !cursorTrailEnabled) return;

    const trail = [];
    const sparks = [];
    let pointerX = window.innerWidth * 0.5;
    let pointerY = window.innerHeight * 0.5;
    let visible = false;

    window.addEventListener("pointermove", (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      visible = true;
      trail.push({ x: pointerX, y: pointerY, life: 1 });
      for (let index = 0; index < 2; index += 1) {
        sparks.push({
          x: pointerX + (Math.random() - 0.5) * 12,
          y: pointerY + (Math.random() - 0.5) * 12,
          vx: (Math.random() - 0.5) * 0.7,
          vy: (Math.random() - 0.5) * 0.7,
          life: 0.85,
          size: 1.2 + Math.random() * 1.8,
        });
      }
      if (trail.length > 24) trail.shift();
      if (sparks.length > 80) sparks.splice(0, sparks.length - 80);
    }, { passive: true });

    window.addEventListener("pointerleave", () => { visible = false; });

    const render = () => {
      const setup = fitCanvas(canvas);
      if (!setup) {
        requestAnimationFrame(render);
        return;
      }

      const { ctx, rect } = setup;
      if (visible && trail.length > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let index = 1; index < trail.length; index += 1) {
          const prev = trail[index - 1];
          const point = trail[index];
          const alpha = index / trail.length;
          ctx.strokeStyle = `rgba(255, 245, 238, ${alpha * 0.19})`;
          ctx.lineWidth = 4 + alpha * 10;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
          point.life *= 0.96;
        }
      }

      for (let index = trail.length - 1; index >= 0; index -= 1) {
        if (trail[index].life <= 0.04) trail.splice(index, 1);
      }

      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.life -= 0.028;
        if (spark.life <= 0) {
          sparks.splice(index, 1);
          continue;
        }

        const gradient = ctx.createRadialGradient(spark.x, spark.y, 0, spark.x, spark.y, spark.size * 6);
        gradient.addColorStop(0, `rgba(255, 250, 246, ${spark.life * 0.82})`);
        gradient.addColorStop(1, "rgba(255, 250, 246, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, spark.size * 7.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 255, 255, ${spark.life * 0.94})`;
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (visible) {
        const pulse = 16 + Math.sin(performance.now() * 0.01) * 2;
        const glow = ctx.createRadialGradient(pointerX, pointerY, 0, pointerX, pointerY, pulse);
        glow.addColorStop(0, "rgba(255, 255, 255, 0.32)");
        glow.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pointerX, pointerY, pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  };

  const initHeroAtmosphereCanvas = () => {
    const canvas = document.querySelector("[data-hero-atmos]");
    const host = canvas?.closest(".hero-stage");
    if (!(canvas instanceof HTMLCanvasElement) || !(host instanceof HTMLElement) || !canvasEffectsEnabled) return;

    const particles = Array.from({ length: 38 }, (_, index) => ({
      x: Math.random(),
      y: Math.random(),
      size: 1.2 + Math.random() * 2.8,
      speed: 0.3 + Math.random() * 0.9,
      alpha: 0.18 + Math.random() * 0.32,
      phase: index * 0.35,
    }));
    const pointer = { x: 0.58, y: 0.34, active: false };

    if (finePointer) {
      host.addEventListener("pointermove", (event) => {
        const rect = host.getBoundingClientRect();
        pointer.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        pointer.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
        pointer.active = true;
      });
      host.addEventListener("pointerleave", () => { pointer.active = false; });
    }

    const render = (now) => {
      const setup = fitCanvas(canvas);
      if (!setup) {
        requestAnimationFrame(render);
        return;
      }

      const { ctx, rect } = setup;
      const photo = host.querySelector(".stage-photo");
      const photoRect = photo instanceof HTMLElement ? photo.getBoundingClientRect() : null;
      const hostRect = host.getBoundingClientRect();
      const scrollFactor = (window.scrollY || 0) * 0.04;

      if (photoRect) {
        const localX = photoRect.left - hostRect.left;
        const localY = photoRect.top - hostRect.top;
        const glareX = localX + photoRect.width * (pointer.active ? pointer.x : 0.66);
        const glareY = localY + photoRect.height * (pointer.active ? pointer.y : 0.28);
        const glare = ctx.createRadialGradient(glareX, glareY, 0, glareX, glareY, Math.max(photoRect.width, photoRect.height) * 0.42);
        glare.addColorStop(0, "rgba(255, 255, 255, 0.22)");
        glare.addColorStop(0.4, "rgba(255, 247, 242, 0.12)");
        glare.addColorStop(1, "rgba(255, 247, 242, 0)");
        ctx.fillStyle = glare;
        ctx.beginPath();
        ctx.rect(localX, localY, photoRect.width, photoRect.height);
        ctx.fill();
      }

      particles.forEach((particle, index) => {
        const px = rect.width * particle.x + Math.sin(now * 0.00035 * particle.speed + particle.phase) * 18;
        const py = rect.height * particle.y + Math.cos(now * 0.00028 * particle.speed + particle.phase * 1.8) * 24 - scrollFactor * (0.2 + particle.speed * 0.18);
        const glow = ctx.createRadialGradient(px, py, 0, px, py, particle.size * 7.5);
        glow.addColorStop(0, `rgba(255, 251, 246, ${particle.alpha})`);
        glow.addColorStop(1, "rgba(255, 251, 246, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, particle.size * 7.5, 0, Math.PI * 2);
        ctx.fill();

        if (index % 6 === 0) {
          ctx.strokeStyle = `rgba(255, 255, 255, ${particle.alpha * 0.28})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px - 8, py);
          ctx.lineTo(px + 8, py);
          ctx.moveTo(px, py - 8);
          ctx.lineTo(px, py + 8);
          ctx.stroke();
        }
      });

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  };

  const createSectionRevealCanvas = (host) => {
    if (!(host instanceof HTMLElement) || host.querySelector(".section-reveal-canvas")) return;
    host.classList.add("canvas-reveal-host");
    const canvas = document.createElement("canvas");
    canvas.className = "section-reveal-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);
  };

  const triggerSectionRevealCanvas = (host) => {
    if (!(host instanceof HTMLElement) || !canvasEffectsEnabled) return;
    if (sectionRevealStates.get(host)?.started) return;

    const canvas = host.querySelector(".section-reveal-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return;

    const particles = Array.from({ length: 42 }, (_, index) => ({
      x: (index % 7) / 6,
      y: Math.random(),
      drift: (Math.random() - 0.5) * 0.18,
      size: 2.4 + Math.random() * 4,
      alpha: 0.14 + Math.random() * 0.22,
    }));

    const state = { started: true, rafId: 0, startAt: 0 };
    sectionRevealStates.set(host, state);
    host.classList.add("canvas-reveal-running");

    const tick = (now) => {
      if (!state.startAt) state.startAt = now;
      const progress = clamp((now - state.startAt) / 1080, 0, 1);
      const setup = fitCanvas(canvas);
      if (!setup) {
        state.rafId = requestAnimationFrame(tick);
        return;
      }

      const { ctx, rect } = setup;
      const wipeY = rect.height * (1 - progress);
      ctx.fillStyle = `rgba(249, 243, 238, ${0.58 * (1 - progress)})`;
      ctx.fillRect(0, 0, rect.width, rect.height);

      ctx.globalCompositeOperation = "destination-out";
      const wipe = ctx.createLinearGradient(0, wipeY - 90, 0, wipeY + 140);
      wipe.addColorStop(0, "rgba(0,0,0,0)");
      wipe.addColorStop(0.32, "rgba(0,0,0,0.38)");
      wipe.addColorStop(0.64, "rgba(0,0,0,0.96)");
      wipe.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = wipe;
      ctx.fillRect(0, wipeY - 90, rect.width, 230);

      particles.forEach((particle, index) => {
        const px = rect.width * particle.x + Math.sin(progress * 8 + index) * 22;
        const py = wipeY + (particle.y - 0.5) * 80 + Math.cos(progress * 10 + index) * 8;
        const radius = particle.size * (0.6 + (1 - progress) * 0.6);
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.globalCompositeOperation = "screen";
      const flare = ctx.createLinearGradient(0, wipeY - 40, 0, wipeY + 40);
      flare.addColorStop(0, "rgba(255,255,255,0)");
      flare.addColorStop(0.5, `rgba(255,250,246,${0.34 * (1 - progress * 0.4)})`);
      flare.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = flare;
      ctx.fillRect(0, wipeY - 40, rect.width, 80);

      if (progress < 1) {
        state.rafId = requestAnimationFrame(tick);
      } else {
        host.classList.remove("canvas-reveal-running");
      }
    };

    state.rafId = requestAnimationFrame(tick);
  };

  const initMaskRevealCanvases = () => {
    if (!canvasEffectsEnabled) return;
    document.querySelectorAll(".home-section[data-reveal='mask'], .hero-panel[data-reveal='mask']").forEach(createSectionRevealCanvas);
  };

  const initFormatPowderCanvases = () => {
    return;
    document.querySelectorAll(".format-card").forEach((card) => {
      if (!(card instanceof HTMLElement) || card.querySelector(".format-powder-canvas")) return;
      const canvas = document.createElement("canvas");
      canvas.className = "format-powder-canvas";
      canvas.setAttribute("aria-hidden", "true");
      card.appendChild(canvas);

      const state = {
        activeUntil: 0,
        hoverX: 0.5,
        hoverY: 0.4,
        particles: [],
      };

      const burst = (count = 10) => {
        for (let index = 0; index < count; index += 1) {
          state.particles.push({
            x: state.hoverX,
            y: state.hoverY,
            vx: (Math.random() - 0.5) * 0.006,
            vy: -0.003 - Math.random() * 0.004,
            size: 1 + Math.random() * 2.2,
            alpha: 0.18 + Math.random() * 0.3,
          });
        }
        if (state.particles.length > 64) state.particles.splice(0, state.particles.length - 64);
      };

      card.addEventListener("pointerenter", (event) => {
        const rect = card.getBoundingClientRect();
        state.hoverX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        state.hoverY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
        state.activeUntil = performance.now() + 1200;
        burst(14);
      });

      card.addEventListener("pointermove", (event) => {
        const rect = card.getBoundingClientRect();
        state.hoverX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        state.hoverY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
        state.activeUntil = performance.now() + 420;
        burst(3);
      });

      const render = (now) => {
        const setup = fitCanvas(canvas);
        if (!setup) {
          requestAnimationFrame(render);
          return;
        }

        const { ctx, rect } = setup;
        const active = now < state.activeUntil;
        if (active) {
          const px = rect.width * state.hoverX;
          const py = rect.height * state.hoverY;
          const shimmer = ctx.createRadialGradient(px, py, 0, px, py, Math.max(rect.width, rect.height) * 0.35);
          shimmer.addColorStop(0, "rgba(255,255,255,0.18)");
          shimmer.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = shimmer;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(rect.width, rect.height) * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }

        for (let index = state.particles.length - 1; index >= 0; index -= 1) {
          const particle = state.particles[index];
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.alpha -= 0.012;
          particle.vx *= 0.992;
          particle.vy += 0.0002;
          if (particle.alpha <= 0) {
            state.particles.splice(index, 1);
            continue;
          }

          const px = rect.width * particle.x;
          const py = rect.height * particle.y;
          const glow = ctx.createRadialGradient(px, py, 0, px, py, particle.size * 5.2);
          glow.addColorStop(0, `rgba(255, 250, 244, ${particle.alpha})`);
          glow.addColorStop(1, "rgba(255, 250, 244, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(px, py, particle.size * 5.2, 0, Math.PI * 2);
          ctx.fill();
        }

        requestAnimationFrame(render);
      };

      requestAnimationFrame(render);
    });
  };

  const initWorkGlossCanvas = () => {
    const canvas = document.querySelector("[data-work-gloss]");
    const stage = canvas?.closest(".work-stage");
    return;

    const render = (now) => {
      const setup = fitCanvas(canvas);
      if (!setup) {
        requestAnimationFrame(render);
        return;
      }

      const { ctx, rect } = setup;
      const activeSlide = stage.querySelector(".work-slide.is-active");
      if (activeSlide instanceof HTMLElement) {
        const stageRect = stage.getBoundingClientRect();
        const slideRect = activeSlide.getBoundingClientRect();
        const x = slideRect.left - stageRect.left;
        const y = slideRect.top - stageRect.top;
        const centerX = x + slideRect.width * 0.52;
        const centerY = y + slideRect.height * 0.26;

        const halo = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, slideRect.width * 0.72);
        halo.addColorStop(0, "rgba(255,255,255,0.18)");
        halo.addColorStop(0.5, "rgba(255,248,242,0.08)");
        halo.addColorStop(1, "rgba(255,248,242,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.roundRect(x - 22, y - 16, slideRect.width + 44, slideRect.height + 32, 36);
        ctx.fill();

        const sweepX = x - slideRect.width * 0.18 + ((now * 0.00022) % 1) * slideRect.width * 1.36;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, slideRect.width, slideRect.height, 28);
        ctx.clip();
        const sweep = ctx.createLinearGradient(sweepX - 120, y, sweepX + 120, y + slideRect.height);
        sweep.addColorStop(0, "rgba(255,255,255,0)");
        sweep.addColorStop(0.45, "rgba(255,255,255,0.12)");
        sweep.addColorStop(0.55, "rgba(255,245,238,0.28)");
        sweep.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = sweep;
        ctx.fillRect(x - 40, y, slideRect.width + 80, slideRect.height);
        ctx.restore();

        for (let index = 0; index < 18; index += 1) {
          const px = x + slideRect.width * ((index * 53 % 100) / 100);
          const py = y + slideRect.height * ((index * 37 % 100) / 100);
          const twinkle = 0.08 + Math.sin(now * 0.004 + index) * 0.04;
          ctx.fillStyle = `rgba(255,255,255,${twinkle})`;
          ctx.beginPath();
          ctx.arc(px, py, 1.2 + (index % 3) * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  };

  let proofFrezaImagePromise = null;
  const loadProofFrezaImage = () => {
    if (proofFrezaImagePromise) return proofFrezaImagePromise;
    proofFrezaImagePromise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = "/static/images/freza.png";
    });
    return proofFrezaImagePromise;
  };

  const wrapProofText = (ctx, text, maxWidth) => {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";

    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    });

    if (line) lines.push(line);
    return lines;
  };

  const spawnProofDust = (state, rect, cutterX, cutterY, lineY, intensity = 1) => {
    if (!state.particles) state.particles = [];
    const count = Math.max(8, Math.round(16 * intensity));
    const baseY = Math.min(rect.height - 18, lineY + 10);

    for (let index = 0; index < count; index += 1) {
      if (state.particles.length > 320) break;

      const wideBurst = index % 5 === 0;
      const sourceX = wideBurst
        ? rect.width * (0.08 + Math.random() * 0.84)
        : cutterX + (Math.random() - 0.5) * (34 + rect.width * 0.08);
      const sourceY = wideBurst
        ? baseY + (Math.random() - 0.5) * 22
        : cutterY + 10 + (Math.random() - 0.5) * 16;
      const size = 0.9 + Math.random() * 2.7;
      const spreadX = wideBurst ? 220 : 150;
      const driftY = wideBurst ? 45 : 80;

      state.particles.push({
        x: sourceX,
        y: sourceY,
        vx: (Math.random() - 0.5) * spreadX,
        vy: -35 + Math.random() * driftY,
        size,
        alpha: 0.42 + Math.random() * 0.34,
        gravity: 510 + Math.random() * 250,
        fade: 0.15 + Math.random() * 0.08,
        seed: Math.random() * Math.PI * 2,
      });
    }
  };

  const updateProofDust = (state, rect, deltaSeconds, progressMs, isCutting) => {
    if (!state.particles?.length) return;

    const breezeBase = Math.sin(progressMs * 0.0034) * 5;
    const nextParticles = [];

    state.particles.forEach((particle) => {
      const phaseDrift = Math.sin(progressMs * 0.004 + particle.seed) * 10;
      particle.vx += (breezeBase + phaseDrift) * deltaSeconds;
      particle.vy += particle.gravity * deltaSeconds;
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.vx *= isCutting ? 0.994 : 0.989;
      particle.vy *= 0.997;
      particle.alpha -= particle.fade * deltaSeconds * (progressMs > 1750 ? 0.48 : 0.22);

      if (
        particle.alpha <= 0.03 ||
        particle.x < -36 ||
        particle.x > rect.width + 36 ||
        particle.y > rect.height + 54
      ) {
        return;
      }

      nextParticles.push(particle);
    });

    state.particles = nextParticles;
  };
  const drawProofDust = (ctx, state) => {
    if (!state.particles?.length) return;

    state.particles.forEach((particle) => {
      const glow = ctx.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        particle.size * 4.8
      );
      glow.addColorStop(0, `rgba(250, 241, 236, ${particle.alpha})`);
      glow.addColorStop(0.35, `rgba(244, 229, 221, ${particle.alpha * 0.72})`);
      glow.addColorStop(1, "rgba(244, 229, 221, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * 4.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255, 248, 244, ${Math.min(0.92, particle.alpha + 0.12)})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const drawProofCanvasFrame = (card, state, image, question, progressMs, deltaSeconds) => {
    const canvas = card.querySelector(".proof-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return false;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const introEnd = 240;
    const cutStart = 720;
    const cutEnd = 1560;
    const contentOpenAt = 1640;
    const settleEnd = 2860;
    const outroEnd = 3180;

    const textOpacity = progressMs <= 0
      ? 0
      : progressMs < introEnd
        ? Math.min(progressMs / introEnd, 1)
        : progressMs < cutStart
          ? 1
          : Math.max(0, 1 - ((progressMs - cutStart) / (cutEnd - cutStart)) * 1.14);

    const cutProgress = Math.max(0, Math.min((progressMs - cutStart) / (cutEnd - cutStart), 1));
    const surfaceFade = progressMs < cutEnd
      ? 1
      : Math.max(0, 1 - (progressMs - cutEnd) / (contentOpenAt - cutEnd + 120));
    const cutterOpacity = progressMs < cutEnd
      ? 1
      : Math.max(0, 1 - (progressMs - cutEnd) / 180);
    const dustFade = progressMs < settleEnd
      ? 1
      : Math.max(0, 1 - (progressMs - settleEnd) / (outroEnd - settleEnd));
    const isCutting = cutProgress > 0 && progressMs < cutEnd;

    const lineY = rect.height - rect.height * cutProgress;

    if (textOpacity > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, rect.width, Math.max(0, lineY));
      ctx.clip();

      ctx.globalAlpha = textOpacity;
      ctx.fillStyle = "#2f2524";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(28, rect.width * 0.074)}px Lora, serif`;

      const lines = wrapProofText(ctx, question, rect.width * 0.78);
      const lineHeight = Math.max(36, rect.width * 0.086);
      const startY = rect.height / 2 - ((lines.length - 1) * lineHeight) / 2;

      ctx.shadowColor = "rgba(255,255,255,0.5)";
      ctx.shadowBlur = 18;
      lines.forEach((line, index) => {
        ctx.fillText(line, rect.width / 2, startY + index * lineHeight);
      });
      ctx.restore();
    }

    if (cutProgress > 0) {
      const passHeight = rect.height * cutProgress;

      if (surfaceFade > 0) {
        ctx.save();
        ctx.globalAlpha = surfaceFade;
        const passGradient = ctx.createLinearGradient(0, lineY, 0, rect.height);
        passGradient.addColorStop(0, "rgba(255,247,241,0.10)");
        passGradient.addColorStop(0.12, "rgba(255,247,241,0.78)");
        passGradient.addColorStop(0.52, "rgba(243,230,222,0.96)");
        passGradient.addColorStop(1, "rgba(238,224,216,0.98)");
        ctx.fillStyle = passGradient;
        ctx.fillRect(0, lineY, rect.width, passHeight);

        const grooveGradient = ctx.createLinearGradient(0, lineY - 8, 0, lineY + 10);
        grooveGradient.addColorStop(0, "rgba(255,245,238,0)");
        grooveGradient.addColorStop(0.25, "rgba(255,245,238,0.96)");
        grooveGradient.addColorStop(0.5, "rgba(236,198,178,0.92)");
        grooveGradient.addColorStop(0.75, "rgba(255,245,238,0.96)");
        grooveGradient.addColorStop(1, "rgba(255,245,238,0)");
        ctx.fillStyle = grooveGradient;
        ctx.fillRect(0, lineY - 4, rect.width, 8);

        ctx.strokeStyle = "rgba(230, 196, 176, 0.8)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(244,220,206,0.72)";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        for (let x = 0; x <= rect.width; x += 18) {
          const jitter = Math.sin((x / rect.width) * Math.PI * 4 + cutProgress * 12) * 1.8;
          ctx.lineTo(x, lineY + jitter);
        }
        ctx.stroke();
        ctx.restore();
      }

      const cutterX = rect.width * 0.52 + Math.sin(cutProgress * Math.PI * 6) * 5;
      const cutterY = rect.height + 28 - (rect.height + 110) * cutProgress;
      const cutterW = Math.min(rect.width * 0.42, 170);
      const cutterH = cutterW * (image.naturalHeight / image.naturalWidth || 0.42);

      if (isCutting) {
        spawnProofDust(state, rect, cutterX, cutterY, lineY, 1.15);
      }

      if (cutterOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = cutterOpacity;
        ctx.translate(cutterX, cutterY);
        ctx.rotate(-1.08 + Math.sin(cutProgress * Math.PI * 14) * 0.02);
        ctx.shadowColor = "rgba(82,55,49,0.28)";
        ctx.shadowBlur = 18;
        ctx.drawImage(image, -cutterW / 2, -cutterH / 2, cutterW, cutterH);
        ctx.restore();

        const plume = ctx.createRadialGradient(cutterX, cutterY + 10, 0, cutterX, cutterY + 10, 52);
        plume.addColorStop(0, "rgba(244, 233, 225, 0.68)");
        plume.addColorStop(0.48, "rgba(244, 233, 225, 0.28)");
        plume.addColorStop(1, "rgba(244, 233, 225, 0)");
        ctx.fillStyle = plume;
        ctx.beginPath();
        ctx.arc(cutterX, cutterY + 10, 52, 0, Math.PI * 2);
        ctx.fill();

        for (let streak = 0; streak < 18; streak += 1) {
          const sx = rect.width * (0.04 + streak * 0.055) + Math.sin(cutProgress * 9 + streak) * 10;
          const sy = lineY + Math.sin(cutProgress * 14 + streak) * 5 + (streak % 3) * 4;
          const smoke = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34);
          smoke.addColorStop(0, "rgba(243, 232, 224, 0.26)");
          smoke.addColorStop(1, "rgba(243, 232, 224, 0)");
          ctx.fillStyle = smoke;
          ctx.beginPath();
          ctx.arc(sx, sy, 34, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    updateProofDust(state, rect, deltaSeconds, progressMs, isCutting);

    if (dustFade > 0) {
      ctx.save();
      ctx.globalAlpha = dustFade;
      drawProofDust(ctx, state);
      ctx.restore();
    }

    return progressMs < outroEnd;
  };

  const triggerProofCanvas = async (card) => {
    if (!(card instanceof HTMLElement) || prefersReducedMotion) return;
    if (proofCanvasStates.get(card)?.started) return;

    const canvas = card.querySelector(".proof-canvas");
    const stage = card.querySelector(".proof-question-stage");
    if (!(canvas instanceof HTMLCanvasElement) || !(stage instanceof HTMLElement)) return;

    let image;
    try {
      image = await loadProofFrezaImage();
    } catch (error) {
      console.error("proof canvas image load failed", error);
      return;
    }

    const state = {
      started: true,
      rafId: 0,
      lastFrameAt: 0,
      particles: [],
      contentOpened: false,
    };
    proofCanvasStates.set(card, state);
    card.classList.add("canvas-active");

    const question = stage.dataset.question || card.querySelector(".proof-question-text")?.textContent?.trim() || "";
    const sequenceDelay = parseDurationMs(getComputedStyle(card).getPropertyValue("--proof-sequence-delay"));
    let startedAt = 0;

    const tick = (now) => {
      if (!startedAt) startedAt = now;
      const deltaSeconds = state.lastFrameAt
        ? Math.min((now - state.lastFrameAt) / 1000, 0.05)
        : 1 / 60;
      state.lastFrameAt = now;
      const elapsed = now - startedAt;
      const progressMs = Math.max(0, elapsed - sequenceDelay);
      if (!state.contentOpened && progressMs >= 1640) {
        state.contentOpened = true;
        card.classList.add("canvas-content-open");
      }
      const shouldContinue = drawProofCanvasFrame(card, state, image, question, progressMs, deltaSeconds);

      if (shouldContinue) {
        state.rafId = requestAnimationFrame(tick);
      } else {
        card.classList.add("canvas-content-open");
        card.classList.add("canvas-finished");
      }
    };

    state.rafId = requestAnimationFrame(tick);
  };

  loadProofFrezaImage().catch(() => {});
  initSceneLiquidCanvas();
  initCursorTrailCanvas();
  if (canvasEffectsEnabled) {
    initMaskRevealCanvases();
    initHeroAtmosphereCanvas();
  }

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
        if (entry.target.classList.contains("proof-card")) {
          triggerProofCanvas(entry.target);
        }
        if (entry.target.matches(".home-section[data-reveal='mask'], .hero-panel[data-reveal='mask']")) {
          try { triggerSectionRevealCanvas(entry.target); } catch (_) {}
        }
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

  const counterElements = document.querySelectorAll("[data-count-to]");
  const animateCounter = (element) => {
    if (element.dataset.animated === "true") return;
    element.dataset.animated = "true";

    const target = Number(element.dataset.countTo || "0");
    const start = performance.now();
    const duration = 1400;

    const updateValue = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = Math.round(target * eased);
      if (progress < 1) {
        requestAnimationFrame(updateValue);
      }
    };

    requestAnimationFrame(updateValue);
  };

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    counterElements.forEach(animateCounter);
  } else {
    const counterObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.45,
    });

    counterElements.forEach((element) => counterObserver.observe(element));
  }

  const scrollNodes = document.querySelectorAll("[data-scroll-speed]");
  const updateScrollDepth = () => {
    if (prefersReducedMotion) {
      scrollNodes.forEach((node) => node.style.setProperty("--scroll-shift", "0px"));
      return;
    }

    const viewportCenter = window.innerHeight / 2;
    scrollNodes.forEach((node) => {
      const speed = Number(node.dataset.scrollSpeed || "0");
      const rect = node.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const distance = elementCenter - viewportCenter;
      const shift = distance * speed * -0.18;
      node.style.setProperty("--scroll-shift", `${shift.toFixed(2)}px`);
    });
  };

  updateScrollDepth();

  if (!prefersReducedMotion) {
    let scrollTicking = false;
    const onScroll = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        updateScrollDepth();
        scrollTicking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }

  const tiltCards = document.querySelectorAll("[data-tilt-card]");
  if (!prefersReducedMotion && finePointer) {
    tiltCards.forEach((card) => {
      const resetTilt = () => {
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
        card.style.setProperty("--glare-x", "50%");
        card.style.setProperty("--glare-y", "50%");
      };

      card.addEventListener("pointermove", (event) => {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const tiltY = (x - 0.5) * 10;
        const tiltX = (0.5 - y) * 10;

        card.style.setProperty("--tilt-x", `${tiltX.toFixed(2)}deg`);
        card.style.setProperty("--tilt-y", `${tiltY.toFixed(2)}deg`);
        card.style.setProperty("--glare-x", `${(x * 100).toFixed(1)}%`);
        card.style.setProperty("--glare-y", `${(y * 100).toFixed(1)}%`);
      });

      card.addEventListener("pointerleave", resetTilt);
      card.addEventListener("pointercancel", resetTilt);
      card.addEventListener("blur", resetTilt, true);
      resetTilt();
    });
  }

  const cursorLight = document.querySelector("[data-cursor-light]");
  if (!prefersReducedMotion && finePointer && cursorLight) {
    const moveLight = (event) => {
      cursorLight.classList.remove("is-hidden");
      cursorLight.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0) translate(-50%, -50%)`;
    };

    window.addEventListener("pointermove", moveLight, { passive: true });
    window.addEventListener("pointerleave", () => {
      cursorLight.classList.add("is-hidden");
    });
    window.addEventListener("pointerenter", () => {
      cursorLight.classList.remove("is-hidden");
    });
  } else if (cursorLight) {
    cursorLight.classList.add("is-hidden");
  }

  const workCarousel = document.querySelector("[data-work-carousel]");
  if (workCarousel) {
    const slides = Array.from(workCarousel.querySelectorAll(".work-slide"));
    const prevBtn = workCarousel.querySelector("[data-work-prev]");
    const nextBtn = workCarousel.querySelector("[data-work-next]");
    const dotsWrap = workCarousel.querySelector("[data-work-dots]");
    const stage = workCarousel.querySelector(".work-stage");
    let activeIndex = 0;
    let timerId = null;

    const norm = (value, modulo) => (value % modulo + modulo) % modulo;

    const syncWorkStageHeight = () => {
      if (!(stage instanceof HTMLElement) || slides.length === 0) return;

      let maxHeight = 0;
      slides.forEach((slide) => {
        const height = slide.offsetHeight || 0;
        maxHeight = Math.max(maxHeight, height);
      });

      const sideShift = window.innerWidth <= 860 ? 42 : 28;
      const activeScale = window.innerWidth <= 1180 ? 1 : 1.04;
      const nextHeight = Math.max(420, Math.ceil(maxHeight * activeScale + sideShift + 12));
      stage.style.setProperty("--work-stage-height", `${nextHeight}px`);
    };

    const renderSlides = () => {
      slides.forEach((slide, index) => {
        const delta = norm(index - activeIndex, slides.length);
        slide.classList.remove("is-active", "is-left", "is-right", "is-back");

        if (delta === 0) {
          slide.classList.add("is-active");
        } else if (delta === 1) {
          slide.classList.add("is-right");
        } else if (delta === slides.length - 1) {
          slide.classList.add("is-left");
        } else {
          slide.classList.add("is-back");
        }
      });

      if (!dotsWrap) return;
      dotsWrap.querySelectorAll(".work-dot").forEach((dot, index) => {
        dot.classList.toggle("is-active", index === activeIndex);
      });
    };

    const goTo = (nextIndex) => {
      activeIndex = norm(nextIndex, slides.length);
      renderSlides();
    };

    const startAutoplay = () => {
      if (prefersReducedMotion || slides.length < 2) return;
      clearInterval(timerId);
      timerId = window.setInterval(() => goTo(activeIndex + 1), 4200);
    };

    const stopAutoplay = () => {
      clearInterval(timerId);
      timerId = null;
    };

    if (dotsWrap) {
      slides.forEach((_, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "work-dot";
        dot.setAttribute("aria-label", `Перейти к работе ${index + 1}`);
        dot.addEventListener("click", () => goTo(index));
        dotsWrap.appendChild(dot);
      });
    }

    prevBtn?.addEventListener("click", () => goTo(activeIndex - 1));
    nextBtn?.addEventListener("click", () => goTo(activeIndex + 1));

    workCarousel.addEventListener("mouseenter", stopAutoplay);
    workCarousel.addEventListener("mouseleave", startAutoplay);
    workCarousel.addEventListener("focusin", stopAutoplay);
    workCarousel.addEventListener("focusout", startAutoplay);
    window.addEventListener("resize", syncWorkStageHeight);
    slides.forEach((slide) => {
      slide.querySelectorAll("video, img").forEach((media) => {
        media.addEventListener("loadedmetadata", syncWorkStageHeight);
        media.addEventListener("load", syncWorkStageHeight);
      });
    });

    renderSlides();
    syncWorkStageHeight();
    startAutoplay();
  }

(() => {
  const dialog = document.querySelector("[data-tariff-dialog]");
  if (!(dialog instanceof HTMLDialogElement)) return;

  const badgeEl = dialog.querySelector("[data-tariff-dialog-badge]");
  const durationEl = dialog.querySelector("[data-tariff-dialog-duration]");
  const statusEl = dialog.querySelector("[data-tariff-dialog-status]");
  const titleEl = dialog.querySelector("[data-tariff-dialog-title]");
  const priceEl = dialog.querySelector("[data-tariff-dialog-price]");
  const bodyEl = dialog.querySelector("[data-tariff-dialog-body]");
  const ctaEl = dialog.querySelector("[data-tariff-dialog-cta]");
  const courseInput = dialog.querySelector("[data-tariff-dialog-course]");
  const closeBtn = dialog.querySelector("[data-tariff-close]");

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

  const fill = (btn) => {
    const card = btn.closest(".format-card");
    const detail = card?.querySelector("template[data-tariff-detail]");
    const courseTitle = (btn.dataset.tariffTitle || btn.getAttribute("data-tariff-title") || "").trim();
    if (badgeEl) {
      const badge = btn.dataset.tariffBadge || "";
      badgeEl.textContent = badge;
      badgeEl.hidden = !badge;
    }
    if (durationEl) {
      const duration = btn.dataset.tariffDuration || "";
      durationEl.textContent = duration;
      durationEl.hidden = !duration;
    }
    if (statusEl) {
      const status = btn.dataset.tariffStatus || "";
      statusEl.textContent = status;
      statusEl.hidden = !status;
    }
    if (titleEl) titleEl.textContent = courseTitle;
    if (priceEl) priceEl.textContent = btn.dataset.tariffPrice || "";
    if (courseInput instanceof HTMLInputElement) {
      courseInput.value = courseTitle;
    }
    if (bodyEl) {
      bodyEl.replaceChildren();
      if (detail instanceof HTMLTemplateElement) {
        bodyEl.appendChild(detail.content.cloneNode(true));
      }
    }
    if (ctaEl instanceof HTMLAnchorElement) {
      const href = btn.dataset.tariffCtaHref || btn.getAttribute("data-tariff-cta-href") || "#";
      const customText = (
        btn.dataset.tariffCtaText ||
        btn.getAttribute("data-tariff-cta-text") ||
        ""
      ).trim();
      const message =
        customText ||
        (courseTitle
          ? `Добрый день! Хочу записаться на курс «${courseTitle}»`
          : "Добрый день! Хочу записаться на курс");
      ctaEl.href = withTelegramPrefill(href, message);
      ctaEl.textContent =
        btn.dataset.tariffCtaLabel ||
        btn.getAttribute("data-tariff-cta-label") ||
        "Записаться в Telegram";
      const isExternal =
        btn.dataset.tariffCtaExternal === "1" ||
        btn.getAttribute("data-tariff-cta-external") === "1";
      if (isExternal) {
        ctaEl.target = "_blank";
        ctaEl.rel = "noopener noreferrer";
      } else {
        ctaEl.removeAttribute("target");
        ctaEl.removeAttribute("rel");
      }
    }
  };

  const open = (btn) => {
    fill(btn);
    setCallbackPopOpen(false);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  };

  const callbackPop = dialog.querySelector("[data-callback-pop]");
  const callbackPopOpenBtn = dialog.querySelector("[data-callback-pop-open]");

  const setCallbackPopOpen = (openState) => {
    if (!(callbackPop instanceof HTMLElement)) return;
    callbackPop.hidden = !openState;
    if (callbackPopOpenBtn instanceof HTMLElement) {
      callbackPopOpenBtn.setAttribute("aria-expanded", openState ? "true" : "false");
    }
    if (openState) {
      const nameInput = callbackPop.querySelector('input[name="name"]');
      if (nameInput instanceof HTMLInputElement) {
        window.requestAnimationFrame(() => nameInput.focus());
      }
    }
  };

  const close = () => {
    setCallbackPopOpen(false);
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };

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

  document.querySelectorAll("[data-tariff-open]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      open(btn);
    });
  });

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
  const grid = document.querySelector(".formats-grid-v2[data-format-cards]");
  if (!(grid instanceof HTMLElement)) return;

  const selectors = [
    ".format-course-name",
    ".format-title-row",
    ".format-price",
    ".format-installment",
    ".format-copy > .format-block:nth-child(1)",
    ".format-copy > .format-block:nth-child(2)",
  ];

  const clearHeights = (cards) => {
    cards.forEach((card) => {
      selectors.forEach((selector) => {
        const el = card.querySelector(selector);
        if (el instanceof HTMLElement) el.style.minHeight = "";
      });
    });
  };

  const equalize = (cards) => {
    if (cards.length < 2) return;
    selectors.forEach((selector) => {
      const nodes = cards
        .map((card) => card.querySelector(selector))
        .filter((el) => el instanceof HTMLElement);
      if (nodes.length < 2) return;
      nodes.forEach((el) => {
        el.style.minHeight = "";
      });
      const max = Math.max(...nodes.map((el) => el.offsetHeight));
      nodes.forEach((el) => {
        el.style.minHeight = `${max}px`;
      });
    });
  };

  const alignTariffRows = () => {
    const cards = Array.from(grid.querySelectorAll(".format-card--tariff")).filter(
      (card) => card instanceof HTMLElement
    );
    clearHeights(cards);

    // На узком экране карточки в одну колонку — выравнивание не нужно
    if (window.matchMedia("(max-width: 640px)").matches) return;

    const columns = window.matchMedia("(max-width: 980px)").matches ? 2 : 3;
    for (let i = 0; i < cards.length; i += columns) {
      equalize(cards.slice(i, i + columns));
    }
  };

  let frame = 0;
  const schedule = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(alignTariffRows);
  };

  schedule();
  window.addEventListener("resize", schedule, { passive: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(schedule).catch(() => {});
  }
})();

(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  // Soft 3D tilt for tariff cards
  if (!reducedMotion && finePointer) {
    document.querySelectorAll(".formats-grid-v2 .format-card").forEach((card) => {
      if (!(card instanceof HTMLElement)) return;
      const maxTilt = card.classList.contains("featured") ? 14 : 11;

      card.addEventListener("pointermove", (event) => {
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        card.style.transition = "box-shadow 0.25s ease, border-color 0.25s ease, opacity 0.55s ease";
        card.style.setProperty("--tilt-y", `${(x * maxTilt).toFixed(2)}deg`);
        card.style.setProperty("--tilt-x", `${(-y * maxTilt).toFixed(2)}deg`);
      });

      card.addEventListener("pointerleave", () => {
        card.style.transition = "";
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
      });
    });
  }

  // Light parallax for about portrait + final CTA
  if (!reducedMotion) {
    const layers = Array.from(document.querySelectorAll("[data-parallax]"));
    if (layers.length) {
      let ticking = false;
      const update = () => {
        const viewH = window.innerHeight || 800;
        layers.forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          const speed = Number(el.dataset.parallaxSpeed || 0.08);
          const rect = el.getBoundingClientRect();
          const center = rect.top + rect.height / 2;
          const offset = ((center - viewH / 2) / viewH) * -160 * speed;
          el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0) scale(1.14)`;
        });
        ticking = false;
      };
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      update();
    }
  }
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
        if (other !== item && other.open) other.open = false;
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

  let amount = 45000;
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
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
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
