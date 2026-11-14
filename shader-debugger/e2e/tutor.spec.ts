import { expect, test } from '@playwright/test';
import { mockTutor, openExercise, setCode } from './helpers';

test('hint ladder: a hint arrives with the checks, and is kept with progress', async ({ page }) => {
  const requests = await mockTutor(page, { hint: 'Look at `bandY` on its own.' });
  await page.goto('/');
  await openExercise(page, '03-step/03-rectangle');
  await expect(page.locator('.checks-summary')).toHaveText(/of/); // the checklist has run
  await page.locator('.hint-btn').click();
  await expect(page.locator('.hint')).toContainText('Look at bandY on its own.');
  await expect(page.locator('.hint-btn')).toHaveText('Still stuck: explain the idea');
  const hint = requests.find((r) => r.kind === 'hint')!;
  expect(hint.context.exerciseId).toBe('03-step/03-rectangle');
  expect(hint.context.checks?.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('.hint')).toContainText('Look at bandY on its own.');
});

test('error explainer: Explain on a compile error shows the answer under it', async ({ page }) => {
  await mockTutor(page, { error: 'A float needs a decimal point.' });
  await page.goto('/');
  await page.locator('#mode-switch button[data-mode="sandbox"]').click();
  await setCode(page, 'precision highp float;\nout vec4 fragColor;\nvoid main() {\n  float x = 1;\n  fragColor = vec4(x);\n}\n');
  await page.locator('.explain-btn').first().click();
  await expect(page.locator('.problem-explain')).toContainText('A float needs a decimal point.');
});
