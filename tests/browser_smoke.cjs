/* Run against a local test instance with a test database. The prior snapshot and anchors are restored. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const session = () => fetch(base + "/api/session").then((r) => r.json());
const send = (route, body) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const idle = (page) => page.waitForFunction(() => !document.querySelector(".analysis-trigger").disabled, null, { timeout: 180000 });

(async () => {
  const initial = await session();
  const prior = initial.report.key, priorAnchors = initial.anchors || {};
  const b = await chromium.launch({ headless: true });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await send("/api/session", { action: "reset" });
    for (const id of ["kick", "bass_guitar", "sub_synth", "lead_synth"]) await send("/api/session", { action: "anchors", id, anchors: { prefer: [], avoid: [] } });
    await page.goto(base, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".channel").count(), 4);

    // Spectrum basics
    await page.getByRole("button", { name: "Спектрограмма", exact: true }).click();
    assert(await page.locator(".heatmap-wrap canvas").isVisible());
    await page.getByRole("button", { name: "Спектр", exact: true }).click();

    // 1. Named import from disk → analysis → automatic fit preview (A/B, not auto-applied)
    await page.getByRole("button", { name: "Импортировать WAV", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles(path.resolve("fixtures/lead_synth.wav"));
    await page.getByLabel("Название дорожки").fill("Гитара");
    await page.getByLabel("Роль в миксе").selectOption("melodic");
    await page.getByRole("button", { name: "Добавить в микс", exact: true }).click();
    await page.locator(".preview-status").waitFor({ timeout: 180000 });
    let s = await session();
    assert.equal(s.report.channels.length, 5);
    const guitar = s.report.channels.find((c) => c.name === "Гитара");
    assert(guitar && guitar.role === "melodic");
    await page.getByRole("button", { name: "Оставить исходный", exact: true }).click();
    assert.equal((await session()).report.key, s.report.key, "preview must not commit");

    // 2. Anchors on the spectrum: audition, drag, save; audio is not changed
    await page.getByRole("button", { name: /Ориентиры/ }).click();
    await page.locator(".focus-chips button", { hasText: "Lead Synth" }).click();
    const svg = page.locator(".spectrum-panel .plot-stage svg");
    const box = await svg.boundingBox();
    await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.45);
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    const p1 = page.locator(".eq-point").first();
    const pb = await p1.boundingBox();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2 + 25, pb.y - 30, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.locator(".eq-point").count(), 1);
    await page.getByRole("button", { name: "Слушать инструмент" }).click();
    await page.getByRole("button", { name: "Остановить прослушивание" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "EQ: вкл" }).click();
    await page.getByRole("button", { name: "Остановить прослушивание" }).click();
    const before = (await session()).report.key;
    await page.getByRole("button", { name: "Сохранить ориентиры" }).click();
    await page.waitForFunction(() => document.querySelector(".toast")?.textContent?.includes("Звук не изменён"));
    s = await session();
    assert.equal(s.anchors.lead_synth.prefer.length, 1);
    assert.equal(s.report.key, before, "anchors must not render audio");

    // Sub gets exactly one point
    await page.locator(".focus-chips button", { hasText: "Sub Synth" }).click();
    await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.4);
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.4);
    assert.equal(await page.locator(".eq-point").count(), 1);
    assert((await page.locator(".anchor-readout").textContent()).length > 0);
    await page.getByRole("button", { name: "Сохранить ориентиры" }).click();
    await page.waitForFunction(() => document.querySelector(".toast")?.textContent?.includes("Sub Synth"));
    assert.equal((await session()).anchors.sub_synth.prefer.length, 1);
    const rejected = await send("/api/session", { action: "anchors", id: "sub_synth", anchors: { prefer: [{ freq: 45, gain: 3, q: 2 }, { freq: 60, gain: 3, q: 2 }], avoid: [] } });
    assert.equal(rejected.status, 400);

    // Analysis uses anchors; the agent protects and pursues them
    await page.getByRole("button", { name: /Анализ с ориентирами/ }).click();
    await idle(page);
    s = await session();
    assert.equal(s.report.priorities.total, 2);
    await page.getByRole("button", { name: /Ориентиры/ }).first().click();
    await page.getByRole("button", { name: "Подобрать коррекции", exact: true }).click();
    await page.locator(".preview-status").waitFor({ timeout: 180000 });
    assert(await page.locator(".comparison", { hasText: "Полезные ясны" }).isVisible());
    await page.getByRole("button", { name: "Применить коррекции", exact: true }).click();
    await page.waitForSelector("dialog", { state: "detached" });
    s = await session();
    assert(s.report.meter.truePeak <= -1);

    // Channel editor: rename + remove the imported track
    await page.locator(".channel-name", { hasText: "Гитара" }).click();
    await page.getByRole("button", { name: "Инспектор канала", exact: true }).click();
    await page.getByRole("button", { name: "Удалить канал из сессии" }).click();
    await page.getByRole("button", { name: "Удалить канал", exact: true }).click();
    await idle(page);
    assert.equal((await session()).report.channels.length, 4);

    // Existing coverage: 12 modules, aligned probe, export, history, validation, mobile
    await page.getByRole("button", { name: "Анализаторы", exact: true }).click();
    assert.equal(await page.locator(".module-nav>button").count(), 12);
    await page.locator(".module-nav>button").nth(6).click();
    const probe = await fetch(base + (await page.locator(".probe-player audio").getAttribute("src")));
    assert.equal(probe.status, 200);
    await page.getByRole("button", { name: "Журнал", exact: true }).click();
    assert((await page.locator(".journal-row").count()) > 2);
    const zip = await fetch(`${base}/api/audio?key=${(await session()).report.key}&format=zip`);
    assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), "PK");
    const invalid = await send("/api/analyze", { channels: [{ ...s.report.channels[0], gain: 99999 }], fft: 8192 });
    assert.equal(invalid.status, 400);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base, { waitUntil: "networkidle" });
    assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    assert.deepEqual(errors, []);
    console.log("PASS: named import / auto-fit preview isolation / anchor edit+drag / live audition / bypass / save without render / sub limit / anchor-aware analysis + agent / remove channel / analyzers / export / history / validation / mobile / no page errors");
  } finally {
    for (const id of ["kick", "bass_guitar", "sub_synth", "lead_synth"]) await send("/api/session", { action: "anchors", id, anchors: priorAnchors[id] || { prefer: [], avoid: [] } });
    await send("/api/session", { action: "restore", key: prior });
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
