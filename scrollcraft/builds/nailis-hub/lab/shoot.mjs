import pkg from "/home/asker/.cache/yarn/v6/npm-playwright-core-1.55.1-5d3bb1846bc4289d364ea1a9dcb33f14545802e9-integrity/node_modules/playwright-core/index.js";
const { chromium } = pkg;
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2];
const outDir = process.argv[3];
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 900);
const reduced = process.argv.includes("--reduced");
const executablePath = "/home/asker/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-features=PointerLock"],
});
const context = await browser.newContext({
  viewport: { width, height },
  reducedMotion: reduced ? "reduce" : "no-preference",
  deviceScaleFactor: 1,
});
await context.addInitScript(() => {
  Element.prototype.requestPointerLock = function () { return Promise.resolve(); };
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};
});
const page = await context.newPage();
const logs = [];
page.on("console", (msg) => {
  if (msg.type() === "error") logs.push("console: " + msg.text());
});
page.on("pageerror", (err) => logs.push("pageerror: " + err.message));
page.on("requestfailed", (req) => {
  const url = req.url();
  if (url.includes("/api/callback")) return;
  logs.push("failed: " + url + " " + (req.failure() && req.failure().errorText));
});

await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(600);

const report = await page.evaluate(() => {
  const rail = document.querySelector(".tariff-rail");
  const acts = Array.from(document.querySelectorAll("[data-sc-act]")).map((el) => {
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY;
    return {
      id: el.id,
      act: el.getAttribute("data-sc-act"),
      top,
      height: el.offsetHeight,
    };
  });
  return {
    acts,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    panOver: rail ? rail.scrollWidth - window.innerWidth : null,
    railWidth: rail ? rail.scrollWidth : null,
    title: document.querySelector("h1")?.innerText || "",
    h1Opacity: getComputedStyle(document.querySelector("h1")).opacity,
  };
});

const shots = [];
let n = 0;
for (const act of report.acts) {
  const travel = Math.max(act.height - height, 1);
  const fracs = act.act === "flow" ? [0.15, 0.55, 0.85] : [0.05, 0.25, 0.5, 0.75, 0.95];
  for (const f of fracs) {
    const y = act.act === "flow"
      ? Math.max(0, act.top - height * (1 - f))
      : act.top + travel * f;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(act.act === "scrub" ? 450 : 180);
    const meta = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const video = document.querySelector("video[data-sc-scrub]");
      const kinetic = document.querySelector("#hush h2");
      const reveal = document.querySelector(".unease-reveal");
      return {
        y: window.scrollY,
        h1: h1 ? getComputedStyle(h1).opacity : null,
        videoTime: video && video.currentTime ? Number(video.currentTime.toFixed(2)) : null,
        videoOpacity: video ? getComputedStyle(video).opacity : null,
        kineticOpacity: kinetic ? getComputedStyle(kinetic).opacity : null,
        revealClip: reveal ? getComputedStyle(reveal).clipPath : null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const file = path.join(outDir, String(n).padStart(2, "0") + "-" + act.id + "-" + String(f).replace(".", "") + ".png");
    await page.screenshot({ path: file });
    shots.push({ file: path.basename(file), act: act.id, ...meta });
    n += 1;
  }
}

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
const nameBefore = await page.locator("[data-daycard-name]").innerText();
await page.fill("[data-daycard-input]", "Ася");
await page.waitForTimeout(100);
const nameAfter = await page.locator("[data-daycard-name]").innerText();

await page.click("[data-installment-months='6']");
await page.waitForTimeout(80);
const monthly = await page.locator("[data-installment-monthly]").innerText();

await page.click("[data-zoom-open]");
await page.waitForTimeout(200);
const dialogOpen = await page.locator("dialog[open]").count();
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
const dialogAfter = await page.locator("dialog[open]").count();

await page.locator(".skip").focus();
const focusOrder = [];
for (let i = 0; i < 8; i++) {
  focusOrder.push(await page.evaluate(() => {
    const el = document.activeElement;
    return el ? (el.innerText || el.getAttribute("aria-label") || el.tagName).replace(/\s+/g, " ").slice(0, 60) : "";
  }));
  await page.keyboard.press("Tab");
}

await page.screenshot({ path: path.join(outDir, "hero.png") });

fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({
  width, height, reduced, logs, report, shots, nameBefore, nameAfter, monthly, dialogOpen, dialogAfter, focusOrder,
}, null, 2));

await browser.close();
console.log(JSON.stringify({
  shots: shots.length,
  logs,
  overflow: report.overflow,
  panOver: report.panOver,
  railWidth: report.railWidth,
  title: report.title,
  nameBefore, nameAfter, monthly, dialogOpen, dialogAfter,
  videoTimes: shots.filter((s) => s.act === "works").map((s) => s.videoTime),
  kinetic: shots.filter((s) => s.act === "hush").map((s) => s.kineticOpacity),
}, null, 2));
