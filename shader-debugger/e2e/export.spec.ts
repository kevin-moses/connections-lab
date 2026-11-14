import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { lessonFile } from './helpers';

const P5_JS = readFileSync('node_modules/p5/lib/p5.min.js', 'utf8');

/** Shaders whose image doesn't depend on time or the mouse (p5's millis() and mouse differ from ours). */
const VTEX_P5 = `precision highp float;
uniform vec2 u_resolution;
varying vec2 vTexCoord;
void main() {
  gl_FragColor = vec4(vTexCoord, gl_FragCoord.x / u_resolution.x, 1.0);
}`;
const VTEX_ES300 = `precision highp float;
uniform vec2 u_resolution;
in vec2 vTexCoord;
out vec4 color;
void main() {
  color = vec4(vTexCoord, gl_FragCoord.x / u_resolution.x, 1.0);
}`;

const cases: { name: string; code: () => string; size: [number, number]; style: 'es300' | 'es100' | 'shadertoy' }[] = [
  { name: '03-step/02-bands as a Shadertoy shader', code: () => lessonFile('03-step/02-bands', 'reference.glsl'), size: [400, 400], style: 'shadertoy' },
  { name: 'vTexCoord, p5 style', code: () => VTEX_P5, size: [200, 100], style: 'es100' },
  { name: 'vTexCoord, ES 3.00', code: () => VTEX_ES300, size: [200, 100], style: 'es300' },
  { name: '03-step/03-rectangle in p5 style', code: () => lessonFile('03-step/03-rectangle', 'reference.glsl'), size: [400, 400], style: 'es100' },
  { name: '01-coordinates/04-aspect-ratio as written (ES 3.00)', code: () => lessonFile('01-coordinates/04-aspect-ratio', 'reference.glsl'), size: [600, 300], style: 'es300' },
  { name: '02-color/04-out-of-range in p5 style', code: () => lessonFile('02-color/04-out-of-range', 'reference.glsl'), size: [400, 400], style: 'es100' },
];

/** Points to compare, in canvas pixels from the top-left. */
const POINTS: [number, number][] = [
  [0.02, 0.02], [0.5, 0.02], [0.98, 0.02], [0.02, 0.5], [0.33, 0.41], [0.5, 0.5], [0.71, 0.66], [0.98, 0.98], [0.02, 0.98], [0.25, 0.75],
];

/** The sketch (and the app's own render of the same code) from inside the app, so it uses the app's modules. */
async function exportAndRender(page: Page, code: string, size: [number, number], style: 'es300' | 'es100' | 'shadertoy') {
  return page.evaluate(
    async ({ code, size, style }) => {
      // Vite serves the app's modules; load them by URL (typed loosely, they're the app's own).
      const load = (url: string) => import(/* @vite-ignore */ url) as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { convertStyle } = await load('/src/dialects/convert.ts');
      const { exportP5 } = await load('/src/dialects/export.ts');
      const { OffscreenRenderer } = await load('/src/render/offscreen.ts');
      const src: string = convertStyle(code, style)!;
      const [w, h] = size;
      const r = new OffscreenRenderer().render({ source: src, width: w, height: h, time: 0, mouse: [0, h] });
      if (!r.ok) throw new Error(r.error);
      return { html: exportP5(src, { width: w, height: h, title: 'test' }).html as string, src, app: Array.from(r.image.data as Uint8ClampedArray) };
    },
    { code, size, style },
  );
}

for (const c of cases) {
  test(`export runs in real p5 ${'2.4.0'} and matches the app: ${c.name}`, async ({ page, context }) => {
    await page.goto('/');
    const { html, src, app } = await exportAndRender(page, c.code(), c.size, c.style);
    expect(src.includes('gl_FragColor')).toBe(c.style === 'es100');
    expect(src.includes('mainImage')).toBe(c.style === 'shadertoy');

    const sketch = await context.newPage();
    const errors: string[] = [];
    sketch.on('pageerror', (e) => errors.push(e.message));
    sketch.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} ${m.location().url}`));
    // No network: p5 from node_modules. p5 also fetches a translations file
    // for the browser's language, which jsDelivr doesn't have (a harmless 404
    // in real sketches); answer it with an empty set.
    await sketch.route('https://cdn.jsdelivr.net/**', (route) =>
      route.request().url().endsWith('/lib/p5.min.js')
        ? route.fulfill({ body: P5_JS, contentType: 'text/javascript' })
        : route.fulfill({ json: {} }),
    );
    await sketch.setContent(html);
    await sketch.waitForFunction(() => (window as unknown as { frameCount?: number }).frameCount! > 2);

    const [w, h] = c.size;
    const pts = POINTS.map(([u, v]) => [Math.min(w - 1, Math.floor(u * w)), Math.min(h - 1, Math.floor(v * h))] as const);
    const p5px = await sketch.evaluate((pts) => pts.map(([x, y]) => [...(window as unknown as { get(x: number, y: number): number[] }).get(x, y)].slice(0, 3)), pts);
    for (const [i, [x, y]] of pts.entries()) {
      const k = ((h - 1 - y) * w + x) * 4; // app image rows start at the bottom
      const mine = app.slice(k, k + 3);
      for (let ch = 0; ch < 3; ch++) expect(Math.abs(p5px[i][ch] - mine[ch]), `pixel (${x}, ${y}) channel ${ch}: p5 ${p5px[i]} vs app ${mine}`).toBeLessThanOrEqual(3);
    }
    expect(errors).toEqual([]);
  });
}

// ---------- three.js ----------

const THREE_BUILD = 'node_modules/three/build/';

/** Typical three.js ShaderMaterial code: no precision line (three adds it), vUv from the vertex shader. */
const VUV_THREE = `uniform vec2 u_resolution;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(vUv, gl_FragCoord.x / u_resolution.x, 1.0);
}`;

const threeCases: { name: string; code: () => string; size: [number, number]; style: 'es300' | 'es100' | 'shadertoy' }[] = [
  { name: 'vUv, three.js style (no precision)', code: () => VUV_THREE, size: [200, 100], style: 'es100' },
  { name: 'vTexCoord, ES 3.00 (GLSL3)', code: () => VTEX_ES300, size: [200, 100], style: 'es300' },
  { name: '03-step/03-rectangle as written (ES 3.00)', code: () => lessonFile('03-step/03-rectangle', 'reference.glsl'), size: [400, 400], style: 'es300' },
  { name: '02-color/04-out-of-range in p5 style', code: () => lessonFile('02-color/04-out-of-range', 'reference.glsl'), size: [400, 400], style: 'es100' },
  { name: '01-coordinates/04-aspect-ratio as a Shadertoy shader', code: () => lessonFile('01-coordinates/04-aspect-ratio', 'reference.glsl'), size: [600, 300], style: 'shadertoy' },
];

for (const c of threeCases) {
  test(`export runs in real three.js r187 and matches the app: ${c.name}`, async ({ page, context }) => {
    await page.goto('/');
    const { src, app, html } = await page.evaluate(
      async ({ code, size, style }) => {
        const load = (url: string) => import(/* @vite-ignore */ url) as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const { convertStyle } = await load('/src/dialects/convert.ts');
        const { exportThree } = await load('/src/dialects/export.ts');
        const { OffscreenRenderer } = await load('/src/render/offscreen.ts');
        const src: string = convertStyle(code, style) ?? code;
        const [w, h] = size;
        const r = new OffscreenRenderer().render({ source: src, width: w, height: h, time: 0, mouse: [0, 0] });
        if (!r.ok) throw new Error(r.error);
        const e = exportThree(src, { width: w, height: h, title: 'test' });
        if (!e.ok) throw new Error(e.reason);
        return { src, app: Array.from(r.image.data as Uint8ClampedArray), html: e.html as string };
      },
      { code: c.code(), size: c.size, style: c.style },
    );
    if (c.name.includes('no precision')) expect(src).not.toContain('precision');

    const sketch = await context.newPage();
    const errors: string[] = [];
    sketch.on('pageerror', (e) => errors.push(e.message));
    sketch.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await sketch.route('https://cdn.jsdelivr.net/npm/three@*/build/*', (route) => {
      const file = new URL(route.request().url()).pathname.split('/').pop()!;
      return route.fulfill({ body: readFileSync(THREE_BUILD + file, 'utf8'), contentType: 'text/javascript' });
    });
    await sketch.setContent(html);
    await sketch.waitForFunction(() => !!document.querySelector('canvas'));
    await sketch.waitForTimeout(300);

    const [w, h] = c.size;
    const pts = POINTS.map(([u, v]) => [Math.min(w - 1, Math.floor(u * w)), Math.min(h - 1, Math.floor(v * h))] as const);
    // Read what three drew from a screenshot of its canvas (its drawing buffer isn't kept between frames).
    const png = (await sketch.locator('canvas').screenshot()).toString('base64');
    const threePx = await sketch.evaluate(
      async ({ png, pts }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const ctx = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }).getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
      },
      { png, pts },
    );
    for (const [i, [x, y]] of pts.entries()) {
      const k = ((h - 1 - y) * w + x) * 4; // app image rows start at the bottom
      const mine = app.slice(k, k + 3);
      for (let ch = 0; ch < 3; ch++) expect(Math.abs(threePx[i][ch] - mine[ch]), `pixel (${x}, ${y}) channel ${ch}: three ${threePx[i]} vs app ${mine}`).toBeLessThanOrEqual(3);
    }
    expect(errors).toEqual([]);
  });
}
