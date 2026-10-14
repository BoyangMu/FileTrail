import { test, expect, Page } from '@playwright/test';
import path from 'node:path';

async function register(page: Page) {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 0) > 700) {
    await page.screenshot({ path: 'test-results/login-english-blue.png', fullPage: true });
  }
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.locator('.auth-form .primary')).toHaveCSS(
    'background-color',
    'rgb(37, 99, 235)',
  );
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Full name').fill('Browser QA');
  await page.getByLabel('Email address').fill(`e2e-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('FileTrail-e2e-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My files.' })).toBeVisible();
}
const fixture = (name: string) => path.resolve('e2e/fixtures', name);

test('upload, replace, restore, share/revoke, rename and trash recovery', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await register(page);
  await page
    .getByLabel('Choose files to upload', { exact: true })
    .setInputFiles(fixture('project-notes.md'));
  await expect(
    page.getByRole('button', { name: 'project-notes.md Version 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'project-notes.md Version 1', exact: true }).click();
  await expect(page.getByText('Current version V1', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Upload new version', exact: true }).click();
  await page
    .getByLabel('Choose files to upload', { exact: true })
    .setInputFiles(fixture('project-notes-v2.md'));
  await expect(
    page.getByRole('button', { name: 'project-notes.md Version 2', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'project-notes.md Version 2', exact: true }).click();
  await page.getByRole('button', { name: 'Restore this version', exact: true }).click();
  await page.getByRole('button', { name: 'Create restored version' }).click();
  await expect(
    page.getByRole('button', { name: 'project-notes.md Version 3', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'project-notes.md Version 3', exact: true }).click();
  await page.locator('.detail-actions').getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Create read-only link' }).click();
  await expect(page.getByRole('heading', { name: 'Your link is ready' })).toBeVisible();
  const link = await page.getByLabel('Save this link').inputValue();
  const shared = await page.context().newPage();
  await shared.goto(link);
  await expect(
    shared.getByRole('heading', { name: 'project-notes.md', exact: true }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Shared links', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke link', exact: true }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await shared.reload();
  await expect(shared.getByRole('heading', { name: 'This link is unavailable' })).toBeVisible();
  await shared.close();
  await page.getByRole('button', { name: 'My files', exact: true }).click();
  await page.getByRole('button', { name: 'project-notes.md Version 3', exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('archived-notes.md');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'archived-notes.md Version 3', exact: true }).click();
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Move to trash', exact: true })
    .click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'archived-notes.md Version 3', exact: true }).click();
  await page.getByRole('button', { name: 'Restore file', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your trash is empty' })).toBeVisible();
  await page.getByRole('button', { name: 'My files', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'archived-notes.md Version 3', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-english-blue.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('interrupted upload survives reload and sends only missing parts', async ({ page }) => {
  await register(page);
  const sent: number[] = [];
  let interrupt = true;
  await page.route('**/api/uploads/*/parts/*', async (route) => {
    const index = Number(route.request().url().split('/').pop());
    if (index === 1 && interrupt) {
      await route.abort('internetdisconnected');
      return;
    }
    sent.push(index);
    await route.continue();
  });
  const file = {
    name: 'resume.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(9 * 1024 * 1024, 87),
  };
  await page.getByLabel('Choose files to upload', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: /^Transfers/ }).click();
  await expect(page.getByText('Retry needed', { exact: true })).toBeVisible();
  expect(sent).toEqual([0]);
  await page.reload();
  await page.getByRole('button', { name: /^Transfers/ }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  interrupt = false;
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByText('Version published', { exact: true })).toBeVisible();
  expect(sent).toEqual([0, 1, 2]);
});

test('mobile workspace and folder navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  await page.screenshot({ path: 'test-results/mobile-english-blue.png', fullPage: true });
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Documents');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Documents Folder', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Documents.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
