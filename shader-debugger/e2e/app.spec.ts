import { expect, test } from '@playwright/test';
import { cursorToLine, lessonFile, mockTutor, openExercise, setCode } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockTutor(page);
});

test('boots, compiles on the GPU and parses for the debugger, without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.locator('#status-compile')).toHaveText(/GPU ✓/);
  await expect(page.locator('#status-ast')).toHaveText(/AST ✓/);
  expect(errors).toEqual([]);
});

test('self-test: the CPU interpreter agrees with the GPU on the whole corpus', async ({ page }) => {
  await page.goto('/selftest.html');
  const rows = await page.waitForFunction(() => (window as unknown as { __selfTest?: { name: string; pixels: number; passed: number }[] }).__selfTest);
  const results = (await rows.jsonValue())!;
  expect(results.length).toBeGreaterThan(3);
  for (const r of results) expect(`${r.name}: ${r.passed}/${r.pixels}`).toBe(`${r.name}: ${r.pixels}/${r.pixels}`);
});

test('lesson checks: the starter fails, the reference passes', async ({ page }) => {
  const id = '03-step/03-rectangle';
  await page.goto('/');
  await openExercise(page, id);
  await expect(page.locator('.checks-summary')).toHaveText(/of/);
  await expect(page.locator('.checks-banner')).toBeHidden();
  await setCode(page, lessonFile(id, 'reference.glsl'));
  await expect(page.locator('.checks-banner')).toContainText('Exercise complete');
});

test('debugger: clicking a pixel traces it, and the GPU agrees', async ({ page }) => {
  await page.goto('/');
  await openExercise(page, '01-coordinates/01-red-ramp');
  await expect(page.locator('#status-compile')).toHaveText(/GPU ✓/);
  await page.locator('#view').click();
  await expect(page.locator('#dbg-check')).toHaveText('GPU ✓ agrees');
  await expect(page.locator('#dbg-count')).not.toHaveText('0 / 0');
});

test('inspect values: the cursor line is shown across the canvas', async ({ page }) => {
  const id = '01-coordinates/01-red-ramp';
  await page.goto('/');
  await openExercise(page, id);
  const line = lessonFile(id, 'starter.glsl').split('\n').findIndex((l) => /^\s*float \w+ =/.test(l)) + 1;
  expect(line).toBeGreaterThan(0);
  await cursorToLine(page, line);
  await page.locator('#inspect').click();
  await expect(page.locator('#probe-expr')).not.toHaveText('–');
  await expect(page.locator('#probe-message')).not.toContainText("Can't");
});

test('hover docs and completion come from the GLSL reference', async ({ page }) => {
  await page.goto('/');
  await openExercise(page, '03-step/03-rectangle');
  const at = await page.evaluate(() => {
    const v = window.__sd.editor.view;
    const c = v.coordsAtPos(v.state.doc.toString().indexOf('step(') + 1)!;
    return { x: c.left + 2, y: (c.top + c.bottom) / 2 };
  });
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.cm-glsl-sig')).toContainText('step(genType edge, genType x)');

  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const v = window.__sd.editor.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
    v.focus();
  });
  await page.keyboard.type('\nsmooth');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('smoothstep');
});

test('a selection on the cursor line is visible', async ({ page }) => {
  await page.goto('/');
  await openExercise(page, '01-coordinates/01-red-ramp');
  await cursorToLine(page, 1);
  await page.evaluate(() => window.__sd.editor.view.focus());
  await page.keyboard.press('Shift+End');
  const sel = page.locator('.cm-selectionBackground').first();
  await expect(sel).toBeVisible();
  expect((await sel.boundingBox())!.width).toBeGreaterThan(20);
  // The active line is painted over the selection layer, so it must be see-through.
  const alpha = await page.locator('.cm-activeLine').evaluate((el) => {
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
    const parts = m ? m[1].split(',').map(Number) : [];
    return parts.length === 4 ? parts[3] : 1;
  });
  expect(alpha).toBeLessThan(0.2);
});

test('p5 style: the toggle converts lesson code, and checks, Inspect values and the Debugger all work on it', async ({ page }) => {
  const id = '03-step/03-rectangle';
  await page.goto('/');
  await openExercise(page, id);
  await page.locator('#style-select').selectOption('es100');
  const code = () => page.evaluate(() => window.__sd.editor.view.state.doc.toString());
  expect(await code()).toContain('gl_FragColor = ');
  expect(await code()).not.toContain('out vec4');

  // The reference, in p5 style, passes.
  const p5 = await page.evaluate(async (src) => {
    const url = '/src/dialects/convert.ts'; // served by Vite
    const { convertStyle } = (await import(/* @vite-ignore */ url)) as { convertStyle(s: string, to: string): string };
    return convertStyle(src, 'es100');
  }, lessonFile(id, 'reference.glsl'));
  await setCode(page, p5);
  await expect(page.locator('.checks-banner')).toContainText('Exercise complete');

  const line = p5.split('\n').findIndex((l) => l.includes('float bandY')) + 1;
  await cursorToLine(page, line);
  await page.locator('#inspect').click();
  await expect(page.locator('#probe-expr')).toHaveText('bandY');
  await page.locator('#inspect').click();

  await page.locator('#view').click();
  await expect(page.locator('#dbg-check')).toHaveText('GPU ✓ agrees');

  // Back to ES 3.00, and the choice is remembered.
  await page.locator('#style-select').selectOption('es300');
  expect(await code()).toContain('out vec4 fragColor;');
  await page.reload();
  await expect(page.locator('#style-select')).toHaveValue('es300');
});

test('export: the dialog shows a p5 sketch and a three.js page for the current code', async ({ page }) => {
  await page.goto('/');
  await openExercise(page, '01-coordinates/01-red-ramp');
  await page.locator('#export').click();
  await expect(page.locator('#export-dialog')).toBeVisible();
  await expect(page.locator('#export-code')).toContainText('createShader(vert, frag)');
  await expect(page.locator('#export-code')).toContainText("setUniform('u_resolution'");
  const download = page.waitForEvent('download');
  await page.locator('#export-download').click();
  expect((await download).suggestedFilename()).toBe('01-coordinates-01-red-ramp.html');

  await page.locator('#export-target [data-target="three"]').click();
  await expect(page.locator('#export-code')).toContainText('new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, glslVersion: THREE.GLSL3 })');
  await expect(page.locator('#export-copy')).toHaveText('Copy main.js');
  const threeDownload = page.waitForEvent('download');
  await page.locator('#export-download').click();
  expect((await threeDownload).suggestedFilename()).toBe('01-coordinates-01-red-ramp-three.html');
});

const SHADERTOY_TEMPLATE = `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));

    // Output to screen
    fragColor = vec4(col,1.0);
}`;

test('Shadertoy: paste a shader and debug it as is', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mode-switch [data-mode="sandbox"]').click();
  await setCode(page, SHADERTOY_TEMPLATE);
  await expect(page.locator('#status-compile')).toHaveText(/GPU ✓/);
  await expect(page.locator('#status-ast')).toHaveText(/AST ✓/);

  await cursorToLine(page, 7);
  await page.locator('#inspect').click();
  await expect(page.locator('#probe-expr')).toHaveText('col');
  await expect(page.locator('#probe-message')).toHaveText('');
  await page.locator('#inspect').click();

  await page.locator('#view').click();
  await expect(page.locator('#dbg-check')).toHaveText('GPU ✓ agrees');
  await expect(page.locator('#dbg-now')).toContainText('mainImage(');

  // Export opens on the Shadertoy tab; p5 is one click away.
  await page.locator('#export').click();
  await expect(page.locator('#export-target .active')).toHaveText('Shadertoy');
  await expect(page.locator('#export-code')).toContainText('void mainImage(');
  await page.locator('#export-target [data-target="p5"]').click();
  await expect(page.locator('#export-code')).toContainText('uniform float u_time;');
});

test('Shadertoy toggle: a lesson shows as mainImage and still passes', async ({ page }) => {
  const id = '02-color/03-mix';
  await page.goto('/');
  await openExercise(page, id);
  await page.locator('#style-select').selectOption('shadertoy');
  const code = await page.evaluate(() => window.__sd.editor.view.state.doc.toString());
  expect(code).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
  expect(code).not.toContain('u_resolution');
  const toy = await page.evaluate(async (src) => {
    const url = '/src/dialects/convert.ts'; // served by Vite
    const { convertStyle } = (await import(/* @vite-ignore */ url)) as { convertStyle(s: string, to: string): string };
    return convertStyle(src, 'shadertoy');
  }, lessonFile(id, 'reference.glsl'));
  await setCode(page, toy);
  await expect(page.locator('.checks-banner')).toContainText('Exercise complete');
});

test("language dropdown: code that can't be converted keeps its language, and says why", async ({ page }) => {
  await page.goto('/');
  await page.locator('#mode-switch [data-mode="sandbox"]').click();
  await setCode(page, 'out vec4 c;\nvoid main() { c = vec4(1.0) }'); // missing ;
  let message = '';
  page.once('dialog', (d) => {
    message = d.message();
    void d.accept();
  });
  await page.locator('#style-select').selectOption('shadertoy');
  await expect.poll(() => message).toContain("Can't switch styles");
  await expect(page.locator('#style-select')).toHaveValue('es300');
});
