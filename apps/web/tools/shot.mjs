// Screenshot the running console so you can SEE your work instead of guessing.
//
//   node tools/shot.mjs <out.png> [--t=33] [--port=3011] [--w=1920] [--h=1080]
//                       [--approve] [--reject] [--wait=2500] [--quality=low] [--clip=x,y,w,h]
//
// --t jumps to a second in the scripted scenario (see src/demo/mockEvents.ts):
//    3 call arrives · 14 address verified, amber · 24 facts confirmed
//   29 "he stopped breathing" → CRITICAL · 32 route proposed · 33 approval gate open
// --approve / --reject press A / R after loading, so you can capture post-decision states.
//
// It also prints every console error and page exception it saw — treat a non-empty
// "PAGE ERRORS" section as a failure even if the screenshot looks fine.
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const args = process.argv.slice(2);
const out = resolve(args.find((a) => !a.startsWith("--")) ?? "shot.png");
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const port = flag("port", "3011");
const width = Number(flag("w", 1920));
const height = Number(flag("h", 1080));
const settle = Number(flag("wait", 2500));
const t = flag("t", null);
const quality = flag("quality", null);
const clip = flag("clip", null);

const url = new URL(`http://localhost:${port}/`);
if (t !== null) url.searchParams.set("t", t);
if (quality) url.searchParams.set("quality", quality);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("pageerror", (e) => errors.push(`exception: ${e.message}`));

await page.goto(url.href, { waitUntil: "networkidle", timeout: 60_000 });
if (t === null) await page.keyboard.press("d").catch(() => {});
await page.waitForTimeout(settle);

if (has("approve")) {
  await page.keyboard.press("a");
  await page.waitForTimeout(Number(flag("after", 2600)));
} else if (has("reject")) {
  await page.keyboard.press("r");
  await page.waitForTimeout(Number(flag("after", 2600)));
}

// Frame budget over ~1s, measured with real deltas (this panel runs at 360 Hz, so never assume 60).
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => (performance.now() - t0 < 1000 ? (n++, requestAnimationFrame(tick)) : res(Math.round((n * 1000) / (performance.now() - t0))));
      requestAnimationFrame(tick);
    }),
);

await mkdir(dirname(out), { recursive: true });
const clipRect = clip ? (([x, y, w, h]) => ({ x: +x, y: +y, width: +w, height: +h }))(clip.split(",")) : undefined;
await page.screenshot({ path: out, clip: clipRect });

console.log(`saved ${out}  (${width}x${height}, ${url.search || "idle"}, ~${fps} fps)`);
if (errors.length) {
  console.log(`\nPAGE ERRORS (${errors.length}) — these are failures, fix them:`);
  for (const e of [...new Set(errors)].slice(0, 25)) console.log("  " + e);
} else {
  console.log("no console errors");
}

await browser.close();
