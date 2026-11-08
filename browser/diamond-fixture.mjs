import assert from 'node:assert/strict';

export const goblinName = 'The Diamond Goblin';
export const diamondName = 'Inspect hidden diamond';
export const diamondSolution = `function sumDiamonds(values) {
  return values.reduce((total, value) => total + Math.max(0, value), 0);
}`;

export async function diamondPages(page, count, world = 'javascript') {
  return page.evaluate(async ({ count, world }) => {
    const pages = Array.from({ length: count }, (_, index) => index + 1);
    return Promise.all(pages.map(async (number) => {
      const response = await fetch(`/api/diamond?page=${number}`, {
        headers: { 'X-Ferrum-World': world },
      });
      if (!response.ok) throw new Error(`Diamond lookup failed on page ${number}: ${response.status}`);
      return { number, ...await response.json() };
    }));
  }, { count, world });
}

export async function assertDiamondWithinPage(page, diamond) {
  await diamond.waitFor();
  const placement = await diamond.evaluate((element) => ({
    onPage: Boolean(element.closest('#page-frame')),
    x: parseFloat(element.style.getPropertyValue('--diamond-x')) / 100,
    y: parseFloat(element.style.getPropertyValue('--diamond-y')) / 100,
  }));
  assert.equal(placement.onPage, true);
  const [gemBounds, bookBounds] = await Promise.all([
    diamond.boundingBox(),
    page.locator('#book-page').boundingBox(),
  ]);
  assert.ok(gemBounds && bookBounds);
  const x = (gemBounds.x + gemBounds.width / 2 - bookBounds.x) / bookBounds.width;
  const y = (gemBounds.y + gemBounds.height / 2 - bookBounds.y) / bookBounds.height;
  assert.ok(x > 0 && x < 1 && y > 0 && y < 1, 'The gem should be inside the book page');
  assert.ok(Math.abs(x - placement.x) < 0.02 && Math.abs(y - placement.y) < 0.02,
    'The gem should render at its page-relative placement');
}
