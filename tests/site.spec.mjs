import { test, expect } from '@playwright/test';
import { site } from '../site.config.mjs';
import languageCatalog from '../src/languages.json' with { type: 'json' };

test('all public pages render without horizontal overflow, broken images or external requests', async ({
  page,
}) => {
  const external = [];
  const failures = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4180/'))
      external.push(request.url());
  });
  page.on('pageerror', (error) => failures.push(error.message));
  for (const route of ['', 'guide/', 'privacy/', 'support/', 'terms/']) {
    const response = await page.goto(site.base + route);
    expect(response.status()).toBe(200);
    await expect(page.locator('.site-header .wordmark')).toContainText(
      'Audivoya',
    );
    await expect(page.locator('body')).not.toContainText('Realtime Dubbing');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const img of await page.locator('img').all()) {
      await img.scrollIntoViewIfNeeded();
    }
    await page.locator('footer').scrollIntoViewIfNeeded();
    await expect
      .poll(
        () =>
          page
            .locator('img')
            .evaluateAll((images) =>
              images.every((img) => img.complete && img.naturalWidth > 0),
            ),
        { timeout: 10000 },
      )
      .toBe(true);
    await expect(page.locator('form,input')).toHaveCount(0);
  }
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
});

test('honest install state, keyboard FAQ and setup navigation work', async ({
  page,
}) => {
  await page.goto(site.base);
  await expect(page.locator('.store-pending')).toHaveCount(1);
  await expect(page.locator('.hero-note')).toContainText(
    'Google API fees may apply',
  );
  const question = page.getByText('Does it translate instantly?', {
    exact: true,
  });
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('details[open]')).toContainText(
    'No. Translation needs processing time',
  );
  await page.getByRole('link', { name: 'Explore the setup' }).click();
  await expect(page).toHaveURL(new RegExp('/guide/$'));
  await expect(page.locator('#get-key')).toContainText('Create API key');
  await expect(
    page.getByRole('link', { name: 'Google AI Studio → API keys' }),
  ).toHaveAttribute('href', 'https://aistudio.google.com/api-keys');
});

test('documents all translation languages with an accessible expandable list and matching setup copy', async ({
  page,
}) => {
  await page.goto(site.base);
  await expect(page.locator('.hero-description')).toContainText(
    `${languageCatalog.languages.length} Gemini Live Translation languages`,
  );
  await page
    .getByText(
      `See all ${languageCatalog.languages.length} supported languages`,
      { exact: true },
    )
    .click();
  await expect(page.locator('.supported-languages li')).toHaveCount(
    languageCatalog.languages.length,
  );
  expect(
    await page.locator('.supported-languages li').allTextContents(),
  ).toEqual(languageCatalog.languages.map((language) => language.name));
  await expect(page.locator('.supported-languages')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto(site.base + 'guide/');
  await expect(page.locator('#start')).toContainText(
    `all ${languageCatalog.languages.length} documented Gemini Live Translation languages`,
  );
});

test('CSP blocks unexpected scripts and every external tab link has isolation', async ({
  page,
}) => {
  await page.route('**/audivoya/privacy/', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    await route.fulfill({
      response,
      body: original.replace(
        '</body>',
        '<script>window.untrustedRan = true</script></body>',
      ),
    });
  });
  await page.goto(site.base + 'privacy/');
  expect(await page.evaluate(() => window.untrustedRan)).toBeUndefined();
  const links = await page
    .locator('a[target="_blank"]')
    .evaluateAll((anchors) =>
      anchors.every(
        (a) =>
          a.relList.contains('noopener') &&
          a.relList.contains('noreferrer') &&
          a.protocol === 'https:',
      ),
    );
  expect(links).toBe(true);
  await expect(
    page.getByRole('link', { name: 'xuanquang.work.it@gmail.com' }).first(),
  ).toHaveAttribute('href', 'mailto:' + site.email);
});

test('layout remains usable at narrow and zoom-equivalent CSS viewport widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(site.base);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Browser zoom reduces the CSS viewport. CSS style.zoom is a different layout mechanism.
  await page.setViewportSize({ width: 640, height: 450 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('link', { name: 'Explore the setup' }),
  ).toBeVisible();
});
