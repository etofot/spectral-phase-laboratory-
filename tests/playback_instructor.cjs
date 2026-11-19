/* Focused regression: continuous A/B, apply-after-listen, live modal EQ and re-analysis review. */
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const send = (body) => fetch(base + "/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const session = () => fetch(base + "/api/session").then((r) => r.json());

(async () => {
  const initial = await session(), prior = initial.report.key, oldAnchors = initial.anchors || {};
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  try {
    await send({ action: "reset" });
    for (const id of ["kick", "bass_guitar", "sub_synth", "lead_synth"]) await send({ action: "anchors", id, anchors: { prefer: [], avoid: [] } });
    await page.goto(base, { waitUntil: "networkidle" });

    // Double-click opens a real modal parametric EQ; audio continues while dragging.
    await page.locator(".channel-name", { hasText: "Lead Synth" }).dblclick();
    await page.locator(".instructor").waitFor();
    await page.getByRole("button", { name: "Play · цикл" }).click();
    await page.waitForFunction(() => document.querySelector(".instructor-position")?.dataset.playing === "true");
    const svg = page.locator(".instructor-plot svg"), box = await svg.boundingBox();
    const X = (f) => box.x + (box.width * (48 + (Math.log(f / 20) / Math.log(1000)) * 900)) / 1000;
    const Y = (g) => box.y + (box.height * (30 + ((12 - g) / 30) * 306)) / 370;
    await page.mouse.click(X(1000), Y(5));
    await page.mouse.click(X(3000), Y(4));
    await page.mouse.click(X(220), Y(-6)); // below the zero line → disliked band
    assert.equal(await page.locator(".instructor-node.prefer").count(), 2);
    assert.equal(await page.locator(".instructor-node.avoid").count(), 1);
    assert.equal(await page.locator(".eq-response path").count(), 3, "EQ curve plus good/bad fills must be visible");
    const node = await page.locator(".instructor-node").first().boundingBox();
    await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2);
    await page.mouse.down();
    const stamps = [];
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(node.x + node.width / 2 + i * 15, node.y + node.height / 2 - i * 6);
      await page.waitForTimeout(220);
      stamps.push(Number(await page.locator(".instructor-position").getAttribute("data-position")));
    }
    await page.mouse.up();
    // Position must keep moving while dragging; one wrap at the loop boundary is legitimate.
    const steps = stamps.slice(1).map((t, i) => t - stamps[i]);
    assert(steps.filter((d) => d > 0.05).length >= steps.length - 1, `looped audio must advance during EQ drag: ${stamps.join(", ")}`);
    assert.equal(await page.locator(".instructor-position").getAttribute("data-playing"), "true");
    await page.getByLabel("Длина цикла").selectOption("4");
    await page.getByRole("button", { name: "EQ: вкл" }).click();
    assert(await page.getByRole("button", { name: "EQ: обход" }).isVisible());

    // Saving never renders audio; it opens the requested re-analysis confirmation.
    const before = (await session()).report.key;
    await page.getByRole("button", { name: "Сохранить точки", exact: true }).click();
    await page.getByRole("heading", { name: "Анализ с выбранными частотами" }).waitFor();
    assert.equal((await session()).report.key, before);
    assert.equal((await session()).anchors.lead_synth.prefer.length, 2);
    assert.equal((await session()).anchors.lead_synth.avoid.length, 1);
    await page.getByRole("button", { name: "Да, анализ и перенастройка" }).click();
    await page.locator(".preview-status").waitFor({ timeout: 180000 });
    assert((await session()).report.priorities.total >= 2);

    // Preloaded Web Audio A/B: no aborted media requests, position advances, apply stays enabled.
    assert.equal(await page.getByRole("button", { name: "Применить коррекции", exact: true }).isDisabled(), false);
    for (let i = 0; i < 8; i++) {
      await page.getByRole("button", { name: i % 2 ? "A · Исходный" : "B · Обработка", exact: true }).click();
      await page.waitForTimeout(450);
      assert.equal(await page.locator(".transport").getAttribute("data-playing"), "true");
      assert.equal(await page.getByRole("button", { name: "Применить коррекции", exact: true }).isDisabled(), false);
    }
    await page.waitForTimeout(1200);
    assert(Number(await page.locator(".transport").getAttribute("data-position")) > 0);
    assert.equal(failed.filter((x) => x.includes("/api/audio") && x.includes("ERR_ABORTED")).length, 0);
    await page.getByRole("button", { name: "Применить коррекции", exact: true }).click();
    await page.waitForSelector("dialog", { state: "detached" });
    assert((await session()).report.meter.truePeak <= -1);
    assert.deepEqual(errors, []);
    console.log("PASS: good+bad anchors / glitch-free preloaded A/B / apply after listening / modal EQ live loop / drag while playing / visible curve / save without render / anchored re-analysis");
  } finally {
    for (const id of ["kick", "bass_guitar", "sub_synth", "lead_synth"]) await send({ action: "anchors", id, anchors: oldAnchors[id] || { prefer: [], avoid: [] } });
    await send({ action: "restore", key: prior });
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
