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
