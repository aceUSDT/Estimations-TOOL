export async function prepareReportFixture(page) {
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof seedDemo === 'function');

  if (await page.locator('#lockView.active').isVisible()) {
    await page.locator('#pwInput').fill('codex-production-smoke');
    await page.locator('#pwBtn').click();
    await page.locator('#appView.active').waitFor();
  }

  const hasFixture = await page.evaluate(() => state.projects.some((project) => project.name === 'Riverside Office Fit-Out (demo)'));
  if (!hasFixture) {
    await page.evaluate(async () => {
      const fixtures = seedDemo();
      fixtures.forEach((project) => { project.testFixture = true; });
      state.cur = fixtures[0];
      try {
        await runAnalysis({ auto: true, noAi: true });
      } finally {
        state.cur = null;
      }
      renderProjects();
      show('home');
    });
  }

  await page.waitForFunction(() => state.projects.some((project) => project.name === 'Riverside Office Fit-Out (demo)'));
  await page.waitForFunction(() => document.querySelector('#homeView.active')
    && document.querySelector('#newProjectBtn')
    && document.querySelectorAll('.proj-card').length > 0
    && state.cur == null);
}
