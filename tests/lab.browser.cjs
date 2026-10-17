/*
SPDX-License-Identifier: GPL-3.0-only
Copyright (C) 2026 koenig-arthur

This file is part of Filter Lab.

Filter Lab is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by
the Free Software Foundation, version 3 of the License only.

Filter Lab is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Filter Lab. If not, see <https://www.gnu.org/licenses/>.
*/
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const entry = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const errors = new WeakMap();
test.beforeEach(async ({ page, context }) => {
  const messages = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  page.on('console', message => { if (message.type() === 'error') messages.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) messages.push(`Unexpected network request: ${request.url()}`); });
  await context.setOffline(true);
  await page.goto(entry);
  await expect(page.locator('#filter-title')).toHaveText('1000 Hz notch');
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });
async function formula(page, expression) {
  await page.locator('#tab-transfer').click();
  await page.locator('#expression').fill(expression);
  await page.getByRole('button', { name: 'Apply H(z)' }).click();
}
async function changeNumber(page, selector, value) {
  await page.locator(selector).fill(String(value));
  await page.locator(selector).press('Tab');
}
const coefficients = async page => ({ b: JSON.parse(await page.locator('#b-coeff').inputValue()), a: JSON.parse(await page.locator('#a-coeff').inputValue()) });
test('offline file launch, initial plots, and desktop layout', async ({ page }) => {
  await expect(page.locator('#cursor-gain')).toHaveText('−∞ dB');
  await expect(page.locator('#stability')).toHaveText('Stable');
  await expect(page.locator('#z-plane [data-kind=zeros]')).toHaveCount(2);
  await expect(page.locator('#z-plane [data-kind=poles]')).toHaveCount(2);
  for (const chart of ['magnitude', 'phase']) await expect(page.locator(`#${chart} .response-path`)).toHaveAttribute('d', /^M.+L/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/filter-lab-desktop.png', fullPage: true });
});
test('formula and coefficient input stay synchronized across tabs', async ({ page }) => {
  await formula(page, '(1+z^-1)/2');
  expect(await coefficients(page)).toEqual({ b: [.5, .5], a: [1] });
  await expect(page.locator('#filter-kind')).toHaveText('FIR · order 1');
  await page.locator('#tab-roots').click();
  await expect(page.locator('#zero-count')).toHaveValue('1');
  await expect(page.locator('#pole-count')).toHaveValue('0');
  await expect(page.locator('#origin-note')).toContainText('1 origin pole');
  await page.locator('#tab-design').click();
  await page.locator('#tab-transfer').click();
  expect(await coefficients(page)).toEqual({ b: [.5, .5], a: [1] });
  await page.locator('#b-coeff').fill('[2]'); await page.locator('#a-coeff').fill('[2,-1]');
  await page.getByRole('button', { name: 'Apply coefficients' }).click();
  expect(await coefficients(page)).toEqual({ b: [1], a: [1, -.5] });
  await expect(page.locator('#difference-equation')).toContainText('0.5·y[n−1]');
});
test('malformed input and invalid sampling rates preserve the valid response', async ({ page }) => {
  const before = await page.locator('#magnitude .response-path').getAttribute('d');
  await formula(page, 'alert(1)');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#magnitude .response-path')).toHaveAttribute('d', before);
  await formula(page, 'z');
  await expect(page.locator('#error')).toContainText('noncausal');
  await changeNumber(page, '#sample-rate', 0);
  await expect(page.locator('#error')).toContainText('greater than zero');
  await changeNumber(page, '#sample-rate', 16000);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#nyquist')).toHaveText('Nyquist 8000 Hz');
  await expect(page.locator('#cursor-number')).toHaveValue('2000');
});
test('root counts, conjugate pairs, coordinate editing, gain and delay', async ({ page }) => {
  await page.locator('#preset').selectOption('identity');
  await page.locator('#tab-roots').click();
  await page.locator('#add-zero-pair').click();
  await expect(page.locator('#zero-count')).toHaveValue('2');
  await expect(page.locator('#z-plane [data-kind=zeros]')).toHaveCount(2);
  await changeNumber(page, '#zero-list input[aria-label="zero 1 real"]', .3);
  await changeNumber(page, '#zero-list input[aria-label="zero 1 imaginary"]', .4);
  const { b } = await coefficients(page);
  expect(b[1]).toBeCloseTo(-.6, 10); expect(b[2]).toBeCloseTo(.25, 10);
  await changeNumber(page, '#pole-count', 3);
  await expect(page.locator('#pole-list .root-row')).toHaveCount(3);
  await changeNumber(page, '#root-delay', 2);
  await changeNumber(page, '#root-gain', .25);
  const changed = await coefficients(page);
  expect(changed.b.slice(0, 3)).toEqual([0, 0, .25]);
  await page.locator('#coordinates').selectOption('polar');
  await expect(page.locator('[aria-label="zero 1 radius"]')).toHaveValue('0.5');
  await changeNumber(page, '[aria-label="zero 1 radius"]', .8);
  await page.locator('#zero-list .remove-button').click();
  await expect(page.locator('#zero-count')).toHaveValue('0');
});
test('dragging and keyboard movement change a pole and preserve real coefficients', async ({ page }) => {
  await page.locator('#preset').selectOption('onepole');
  const marker = page.locator('#z-plane [data-kind=poles]').first();
  const box = await marker.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  expect((await coefficients(page)).a[1]).toBeLessThan(-.8);
  await expect(page.locator('#tab-roots')).toHaveAttribute('aria-selected', 'true');
  const previous = (await coefficients(page)).a[1];
  await page.locator('#z-plane [data-kind=poles]').first().focus();
  await page.keyboard.press('ArrowLeft');
  expect((await coefficients(page)).a[1]).toBeCloseTo(previous + .01, 8);
});
test('eleven placed zeros survive the origin and numerically sensitive moves', async ({ page }) => {
  await page.locator('#preset').selectOption('identity');
  await page.locator('#tab-roots').click();
  await changeNumber(page, '#zero-count', 11);
  await changeNumber(page, '[aria-label="zero 1 real"]', 0);
  await expect(page.locator('#zero-count')).toHaveValue('11');
  await expect(page.locator('#zero-list .root-row')).toHaveCount(11);
  await changeNumber(page, '[aria-label="zero 1 real"]', -.3);
  await expect(page.locator('#analysis-warning')).toBeHidden();
  await expect(page.locator('#add-zero')).toBeEnabled();
});
for (const count of [11, 20, 32, 64]) test(`${count} placed zeros and poles remain editable through origin, keyboard and rate changes`, async ({ page }) => {
  await page.locator('#preset').selectOption('identity');
  await page.locator('#tab-roots').click();
  await page.evaluate(() => {
    window.solverCalls = 0;
    const original = FilterDSP.analyze;
    FilterDSP.analyze = (...args) => { window.solverCalls++; return original(...args); };
  });
  for (const kind of ['zero', 'pole']) {
    await changeNumber(page, `#${kind}-count`, count);
    const first = page.locator(`#${kind}-list .root-row`).first();
    const id = await first.getAttribute('data-root-id');
    await changeNumber(page, `[aria-label="${kind} 1 real"]`, 0);
    await expect(first).toContainText('Inactive at origin: factor equals 1');
    await expect(page.locator(`#${kind}-count`)).toHaveValue(String(count));
    const marker = page.locator(`#z-plane [data-root-id="${id}"]`).first();
    await expect(marker).toHaveAttribute('data-inactive', 'true');
    await marker.focus(); await page.keyboard.press('ArrowRight');
    await expect(page.locator(`[aria-label="${kind} 1 real"]`)).toHaveValue('0.01');
    await changeNumber(page, `[aria-label="${kind} 1 real"]`, kind === 'zero' ? -.3 : .3);
    await expect(first).toHaveAttribute('data-root-id', id);
    await expect(page.locator(`#${kind}-count`)).toHaveValue(String(count));
    const others = await page.locator(`#${kind}-list .root-row input[aria-label$=" real"]`).evaluateAll(nodes => nodes.slice(1).map(n => Number(n.value)));
    expect(others).toEqual(Array(count - 1).fill(kind === 'zero' ? -.5 : .5));
    await expect(page.locator(`#add-${kind}`)).toBeEnabled();
  }
  const before = await coefficients(page);
  await page.locator('#tab-transfer').click(); await page.locator('#tab-roots').click();
  await changeNumber(page, '#sample-rate', 16000);
  expect(await coefficients(page)).toEqual(before);
  expect(await page.evaluate(() => window.solverCalls)).toBe(0);
  await expect(page.locator('#analysis-warning')).toBeHidden();
});
test('conjugate factors survive collapse at the origin, zero gain and invalid edits', async ({ page }) => {
  await page.locator('#preset').selectOption('identity'); await page.locator('#tab-roots').click();
  for (const count of [11, 20, 32, 64]) {
    await page.locator('#reset-filter').click();
    await changeNumber(page, '#zero-count', count - 2);
    await page.locator('#add-zero-pair').click();
    const pair = page.locator('#zero-list .root-row').last();
    const id = await pair.getAttribute('data-root-id');
    await changeNumber(page, `[aria-label="zero ${count - 1} real"]`, 0);
    await changeNumber(page, `[aria-label="zero ${count - 1} imaginary"]`, 0);
    await expect(page.locator('#zero-count')).toHaveValue(String(count));
    await expect(pair).toContainText('Inactive at origin');
    await expect(page.locator(`#z-plane [data-root-id="${id}"]`)).toHaveCount(1);
    await changeNumber(page, `[aria-label="zero ${count - 1} imaginary"]`, .4);
    await expect(page.locator(`#z-plane [data-root-id="${id}"]`)).toHaveCount(2);
    await expect(page.locator('#analysis-warning')).toBeHidden();
  }
  await page.locator('#reset-filter').click(); await page.locator('#add-zero-pair').click();
  await changeNumber(page, '#root-delay', 4); await changeNumber(page, '#root-gain', .25);
  const before = await coefficients(page);
  await changeNumber(page, '#root-gain', 0);
  await expect(page.locator('#root-delay')).toHaveValue('4');
  await expect(page.locator('#zero-count')).toHaveValue('2');
  await expect(page.locator('#z-plane [data-kind=zeros]')).toHaveCount(2);
  await changeNumber(page, '#sample-rate', 16000);
  await page.locator('#tab-transfer').click(); await page.locator('#tab-roots').click();
  await changeNumber(page, '#root-gain', .25);
  expect(await coefficients(page)).toEqual(before);
  await changeNumber(page, '#root-delay', 64);
  await expect(page.locator('#error')).toBeVisible();
  expect(await coefficients(page)).toEqual(before);
  await changeNumber(page, '[aria-label="zero 1 real"]', .3);
  await expect(page.locator('#root-delay')).toHaveValue('4');
  await expect(page.locator('#error')).toBeHidden();
});
async function planePoint(page, re, im = 0) {
  await page.locator('#z-plane').scrollIntoViewIfNeeded();
  return page.locator('#z-plane').evaluate((svg, { re, im }) => {
    const scale = Number(svg.querySelector('circle').getAttribute('r'));
    const p = new DOMPoint(200 + re * scale, 174 - im * scale).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, { re, im });
}
for (const count of [11, 20, 32, 64]) test(`sustained dragging of ${count} zeros through the origin preserves selection and synchronizes on release`, async ({ page }) => {
  await page.locator('#preset').selectOption('identity'); await page.locator('#tab-roots').click();
  await changeNumber(page, '#zero-count', count);
  const first = page.locator('#zero-list .root-row').first(), id = await first.getAttribute('data-root-id');
  const start = await planePoint(page, -.5), origin = await planePoint(page, 0), end = await planePoint(page, .4);
  await page.evaluate(() => { window.originalRow = document.querySelector('#zero-list .root-row'); });
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(origin.x, origin.y, { steps: 10 });
  await expect(page.locator('#zero-count')).toHaveValue(String(count));
  await expect(page.locator(`#z-plane [data-root-id="${id}"]`)).toHaveAttribute('data-inactive', 'true');
  expect(await page.evaluate(() => window.originalRow === document.querySelector('#zero-list .root-row'))).toBe(true);
  await page.mouse.move(end.x, end.y, { steps: 20 }); await page.mouse.up();
  await expect(first.locator('input').first()).toHaveValue('0.4');
  await expect(first).toHaveAttribute('data-root-id', id);
  const others = await page.locator('#zero-list input[aria-label$=" real"]').evaluateAll(nodes => nodes.slice(1).map(n => Number(n.value)));
  expect(others).toEqual(Array(count - 1).fill(-.5));
  await expect(page.locator('#analysis-warning')).toBeHidden();
  await page.locator('#add-pole').click(); await expect(page.locator('#pole-count')).toHaveValue('1');
});
test('dragging a conjugate pole pair through the origin preserves both factors at order 64', async ({ page }) => {
  await page.locator('#preset').selectOption('identity'); await page.locator('#tab-roots').click();
  await changeNumber(page, '#pole-count', 62); await page.locator('#add-pole-pair').click();
  const id = await page.locator('#pole-list .root-row').last().getAttribute('data-root-id');
  const start = await planePoint(page, .5, -.5), origin = await planePoint(page, 0), end = await planePoint(page, .2, -.3);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(origin.x, origin.y, { steps: 10 });
  await expect(page.locator('#pole-count')).toHaveValue('64');
  await expect(page.locator(`#z-plane [data-root-id="${id}"]`)).toHaveCount(1);
  await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('[aria-label="pole 63 real"]')).toHaveValue('0.2');
  await expect(page.locator('[aria-label="pole 63 imaginary"]')).toHaveValue('0.3');
  await expect(page.locator(`#z-plane [data-root-id="${id}"]`)).toHaveCount(2);
  await expect(page.locator('#analysis-warning')).toBeHidden();
  expect((await coefficients(page)).a.every(Number.isFinite)).toBe(true);
});
test('queued drag work is coalesced, flushed on release and discarded by cancel or reset', async ({ page }) => {
  await page.locator('#preset').selectOption('identity'); await page.locator('#tab-roots').click();
  await changeNumber(page, '#zero-count', 11);
  const start = await planePoint(page, -.5), end = await planePoint(page, .3);
  async function queueMoves() {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    return page.evaluate(({ start, end }) => {
      const svg = document.querySelector('#z-plane');
      window.dragFrames = new Map(); window.dragSerial = 0;
      window.realRAF = window.requestAnimationFrame; window.realCancelRAF = window.cancelAnimationFrame;
      window.requestAnimationFrame = callback => { const id = ++window.dragSerial; window.dragFrames.set(id, callback); return id; };
      window.cancelAnimationFrame = id => window.dragFrames.delete(id);
      for (let i = 1; i <= 50; i++) svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: start.x + (end.x - start.x) * i / 50, clientY: end.y }));
      return window.dragFrames.size;
    }, { start, end });
  }
  async function restoreFrames() {
    await page.evaluate(() => {
      window.requestAnimationFrame = window.realRAF; window.cancelAnimationFrame = window.realCancelRAF;
      for (const callback of window.dragFrames.values()) callback(performance.now());
    });
  }
  expect(await queueMoves()).toBe(1);
  await page.evaluate(end => document.querySelector('#z-plane').dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: end.x, clientY: end.y })), end);
  await restoreFrames(); await page.mouse.up();
  await expect(page.locator('[aria-label="zero 1 real"]')).toHaveValue('0.3');
  await changeNumber(page, '[aria-label="zero 1 real"]', -.5);
  expect(await queueMoves()).toBe(1);
  await page.evaluate(() => document.querySelector('#z-plane').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
  await restoreFrames(); await page.mouse.up();
  await expect(page.locator('[aria-label="zero 1 real"]')).toHaveValue('-0.5');
  expect(await queueMoves()).toBe(1);
  await page.evaluate(() => document.querySelector('#reset-filter').click());
  await restoreFrames(); await page.mouse.up();
  await expect(page.locator('#zero-count')).toHaveValue('0');
  expect(await coefficients(page)).toEqual({ b: [1], a: [1] });
});
test('reset recovers numerical root failures and preserves comparison and display settings', async ({ page }) => {
  await page.locator('#compare').click();
  await changeNumber(page, '#sample-rate', 16000);
  await applyFrequencyRange(page, 500, 2500);
  await page.locator('#axis-y-auto').uncheck();
  await page.locator('#axis-y-min').fill('-20'); await page.locator('#axis-y-max').fill('10');
  await page.getByRole('button', { name: 'Apply axes', exact: true }).click();
  await changeNumber(page, '#cursor-number', 700); await changeNumber(page, '#compare-frequency', 1600);
  await formula(page, '(1+0.5*z^-1)^64');
  await expect(page.locator('#analysis-warning')).toContainText('did not converge');
  await page.locator('#tab-roots').click();
  await expect(page.locator('#add-zero')).toBeDisabled();
  await expect(page.locator('#reset-filter')).toBeEnabled();
  await page.locator('#reset-filter').click();
  expect(await coefficients(page)).toEqual({ b: [1], a: [1] });
  await expect(page.locator('#analysis-warning')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#tab-roots')).toHaveAttribute('aria-selected', 'true');
  for (const field of ['zero-count', 'pole-count', 'root-delay']) await expect(page.locator(`#${field}`)).toHaveValue('0');
  await expect(page.locator('#root-gain')).toHaveValue('1');
  await expect(page.locator('#sample-rate')).toHaveValue('16000');
  await expect(page.locator('#cursor-number')).toHaveValue('700');
  await expect(page.locator('#compare-frequency')).toHaveValue('1600');
  await expect(page.locator('#magnitude')).toHaveAttribute('data-x-min', '500');
  await expect(page.locator('#magnitude')).toHaveAttribute('data-x-max', '2500');
  await expect(page.locator('#magnitude')).toHaveAttribute('data-y-min', '-20');
  await expect(page.locator('#magnitude')).toHaveAttribute('data-y-max', '10');
  await expect(page.locator('#comparison-list .saved-curve')).toHaveCount(1);
  await page.locator('#add-zero-pair').click(); await expect(page.locator('#zero-count')).toHaveValue('2');
});
test('reset clears applied design targets and stays usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#tab-design').click(); await page.locator('#design-method').selectOption('targets');
  await page.getByRole('button', { name: 'Design filter' }).click();
  await expect(page.locator('#magnitude .target-path')).toHaveCount(1);
  await page.locator('#tab-roots').click(); await page.locator('#reset-filter').click();
  await expect(page.locator('#magnitude .target-path')).toHaveCount(0);
  await expect(page.locator('#target-results')).toBeHidden();
  expect(await coefficients(page)).toEqual({ b: [1], a: [1] });
  await page.locator('#add-zero').click(); await changeNumber(page, '[aria-label="zero 1 real"]', 0);
  await expect(page.locator('#zero-list')).toContainText('Inactive at origin');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/filter-lab-root-reset-mobile.png', fullPage: true });
});
test('linked cursor, normalized axis and magnitude scale', async ({ page }) => {
  await changeNumber(page, '#cursor-number', 0);
  await expect(page.locator('#cursor-gain')).toHaveText('0 dB');
  await changeNumber(page, '#cursor-number', 1000);
  await expect(page.locator('#cursor-gain')).toHaveText('−∞ dB');
  await page.locator('#scale-linear').click();
  await expect(page.locator('#cursor-gain')).toHaveText('0 ×');
  await page.locator('#frequency-units').selectOption('normalized');
  await expect(page.locator('#magnitude')).toContainText('f / fₛ');
  await expect(page.locator('#z-plane')).toContainText('0.25π');
  await changeNumber(page, '#cursor-number', 5000);
  await expect(page.locator('#error')).toContainText('Nyquist');
});
test('all standard frequency design controls produce FIR and IIR filters', async ({ page }) => {
  await page.locator('#tab-design').click();
  for (const family of ['iir', 'fir']) {
    await page.locator('#family').selectOption(family);
    for (const type of ['lowpass', 'highpass', 'bandpass', 'notch']) {
      await page.locator('#filter-type').selectOption(type);
      await page.getByRole('button', { name: 'Design filter' }).click();
      await expect(page.locator('#error')).toBeHidden();
      await expect(page.locator('#analysis-warning')).toBeHidden();
      await expect(page.locator('#filter-kind')).toContainText(family.toUpperCase());
      const f = await coefficients(page);
      expect(f.b.length).toBe(family === 'fir' ? 63 : 3);
      expect(f.a.length).toBe(family === 'fir' ? 1 : 3);
    }
  }
});
test('custom targets fit an FIR, display achieved values and reject invalid grids', async ({ page }) => {
  await page.locator('#tab-design').click();
  await page.locator('#design-method').selectOption('targets');
  await page.getByRole('button', { name: 'Design filter' }).click();
  await expect(page.locator('#filter-title')).toHaveText('63-tap custom FIR');
  await expect(page.locator('#target-results-body tr')).toHaveCount(4);
  await expect(page.locator('#magnitude .target-path')).toHaveCount(1);
  await expect(page.locator('#analysis-warning')).toBeHidden();
  expect((await coefficients(page)).b.length).toBe(63);
  await expect(page.locator('#target-results-body tr').nth(2)).toContainText('−20.087');
  await page.locator('#add-target').click();
  await expect(page.locator('#target-rows .target-row')).toHaveCount(5);
  await page.locator('[aria-label="Target 2 frequency in Hz"]').fill('0');
  await page.getByRole('button', { name: 'Design filter' }).click();
  await expect(page.locator('#error')).toContainText('strictly increasing');
  await expect(page.locator('#filter-title')).toHaveText('63-tap custom FIR');
});
test('comparison overlay survives a filter change and can be cleared', async ({ page }) => {
  await page.locator('#compare').click();
  await page.locator('#preset').selectOption('moving');
  await expect(page.locator('#magnitude .comparison-path')).toHaveCount(1);
  await expect(page.locator('#comparison-list .curve-name')).toHaveValue('1000 Hz notch (1)');
  await page.locator('#clear-comparisons').click();
  await expect(page.locator('#magnitude .comparison-path')).toHaveCount(0);
});
async function openAxes(page) {
  if (!(await page.locator('#axes-panel').getAttribute('open') !== null)) await page.locator('#axes-panel summary').click();
}
async function applyFrequencyRange(page, min, max) {
  await openAxes(page);
  await page.locator('#axis-x-auto').uncheck();
  await page.locator('#axis-x-min').fill(String(min)); await page.locator('#axis-x-max').fill(String(max));
  await page.getByRole('button', { name: 'Apply axes', exact: true }).click();
}
async function hoverAt(page, axisValue) {
  await page.locator('#magnitude').scrollIntoViewIfNeeded();
  const position = await page.locator('#magnitude').evaluate((svg, value) => {
    const min = Number(svg.dataset.xMin), max = Number(svg.dataset.xMax);
    const point = new DOMPoint(59 + (value - min) / (max - min) * (620 - 59), 170).matrixTransform(svg.getScreenCTM());
    return { x: point.x, y: point.y };
  }, axisValue);
  await page.mouse.move(position.x, position.y);
  return position;
}
test('hover measures attenuation without moving the reference and persists on leave', async ({ page }) => {
  await formula(page, '(1+z^-1)/2');
  await changeNumber(page, '#cursor-number', 2000);
  await hoverAt(page, 8000 / 3);
  await expect(page.locator('#cursor-number')).toHaveValue('2000');
  const probe = Number(await page.locator('#compare-frequency').inputValue());
  expect(probe).toBeCloseTo(8000 / 3, 0);
  const row = page.locator('#measurement-rows [data-curve-id=live]');
  await expect(row.locator('[data-field=delta]')).toContainText('more attenuation');
  const ratio = Number((await row.locator('[data-field=ratio]').innerText()).replace('×', ''));
  expect(ratio).toBeCloseTo(Math.cos(Math.PI * probe / 8000) / Math.cos(Math.PI / 4), 4);
  await page.mouse.move(5, 5);
  expect(Number(await page.locator('#compare-frequency').inputValue())).toBe(probe);
  await expect(page.locator('#magnitude .probe-marker')).toHaveCount(1);
  const position = await hoverAt(page, 1500);
  await page.mouse.click(position.x, position.y);
  expect(Number(await page.locator('#cursor-number').inputValue())).toBeCloseTo(1500, 0);
});
test('precise numeric measurements, zero references and singularities', async ({ page }) => {
  await formula(page, '(1+z^-1)/2');
  await changeNumber(page, '#cursor-number', 432.123456);
  await changeNumber(page, '#compare-frequency', 1987.654321);
  const row = page.locator('#measurement-rows [data-curve-id=live]');
  const expected = 20 * Math.log10(Math.cos(Math.PI * 1987.654321 / 8000) / Math.cos(Math.PI * 432.123456 / 8000));
  const delta = Number((await row.locator('[data-field=delta]').innerText()).split('\n')[0].replace('−', '-'));
  expect(delta).toBeCloseTo(expected, 4);
  await changeNumber(page, '#compare-frequency', 4000);
  await expect(row.locator('[data-field=delta]')).toContainText('−∞');
  await expect(row.locator('[data-field=ratio]')).toHaveText('0×');
  await changeNumber(page, '#cursor-number', 4000);
  await expect(row).toHaveAttribute('data-result', 'zero-reference');
  await expect(row).toContainText('reference gain is zero');
  await formula(page, '1/(1-z^-1)');
  await changeNumber(page, '#cursor-number', 0);
  await expect(row).toHaveAttribute('data-result', 'unavailable');
  await expect(row.locator('[data-field=delta]')).toContainText('Unavailable');
  await changeNumber(page, '#compare-frequency', 5000);
  await expect(page.locator('#error')).toContainText('Measurement frequency');
  await expect(page.locator('#measurement-probe')).toContainText('4000 Hz');
});
test('zoomed bounds resample curves and map hover and clicks into the selected range', async ({ page }) => {
  await formula(page, '0.2/(1-0.8*z^-1)');
  await changeNumber(page, '#cursor-number', 200);
  await applyFrequencyRange(page, 1000, 2000);
  for (const chart of ['magnitude', 'phase']) {
    await expect(page.locator(`#${chart}`)).toHaveAttribute('data-x-min', '1000');
    await expect(page.locator(`#${chart}`)).toHaveAttribute('data-x-max', '2000');
  }
  await expect(page.locator('#measurement-reference')).toContainText('outside view');
  await expect(page.locator('#magnitude .frequency-marker')).toHaveCount(0);
  const path = await page.locator('#magnitude .response-path').getAttribute('d');
  expect((path.match(/L/g) || []).length).toBe(1024);
  const position = await hoverAt(page, 1250);
  expect(Number(await page.locator('#compare-frequency').inputValue())).toBeCloseTo(1250, 0);
  await page.mouse.click(position.x, position.y);
  expect(Number(await page.locator('#cursor-number').inputValue())).toBeCloseTo(1250, 0);
  await expect(page.locator('#measurement-reference')).not.toContainText('outside view');
});
test('manual magnitude limits clip rather than flatten and remain separate for dB and linear', async ({ page }) => {
  await formula(page, '10');
  await openAxes(page); await page.locator('#axis-y-auto').uncheck();
  await page.locator('#axis-y-min').fill('-10'); await page.locator('#axis-y-max').fill('10');
  await page.getByRole('button', { name: 'Apply axes', exact: true }).click();
  const geometry = await page.locator('#magnitude .response-path').evaluate(path => ({
    y: path.getBBox().y, clip: path.parentElement.getAttribute('clip-path')
  }));
  expect(geometry.y).toBeLessThan(30); expect(geometry.clip).toBe('url(#magnitude-clip)');
  await page.locator('#scale-linear').click();
  await expect(page.locator('#axis-y-auto')).toBeChecked();
  await page.locator('#axis-y-auto').uncheck();
  await page.locator('#axis-y-min').fill('0'); await page.locator('#axis-y-max').fill('2');
  await page.getByRole('button', { name: 'Apply axes', exact: true }).click();
  await expect(page.locator('#magnitude')).toHaveAttribute('data-y-max', '2');
  await page.locator('#scale-db').click();
  await expect(page.locator('#magnitude')).toHaveAttribute('data-y-min', '-10');
  await expect(page.locator('#magnitude')).toHaveAttribute('data-y-max', '10');
  await formula(page, '2');
  await expect(page.locator('#magnitude')).toHaveAttribute('data-y-max', '10');
});
test('axis validation, units, sampling-rate changes and reset', async ({ page }) => {
  await applyFrequencyRange(page, 500, 1500);
  await page.locator('#frequency-units').selectOption('normalized');
  await expect(page.locator('#axis-x-min')).toHaveValue('0.0625');
  await expect(page.locator('#axis-x-max')).toHaveValue('0.1875');
  await page.locator('#frequency-units').selectOption('hz');
  await changeNumber(page, '#sample-rate', 16000);
  await expect(page.locator('#magnitude')).toHaveAttribute('data-x-min', '1000');
  await expect(page.locator('#magnitude')).toHaveAttribute('data-x-max', '3000');
  await expect(page.locator('#compare-frequency')).toHaveAttribute('max', '8000');
  for (const [min, max] of [[1000, 9000], [3000, 3000], [-1, 3000]]) {
    await applyFrequencyRange(page, min, max);
    await expect(page.locator('#error')).toContainText('Nyquist');
    await expect(page.locator('#magnitude')).toHaveAttribute('data-x-max', '3000');
  }
  await page.locator('#reset-axes').click();
  await expect(page.locator('#magnitude')).toHaveAttribute('data-x-min', '0');
  await expect(page.locator('#magnitude')).toHaveAttribute('data-x-max', '8000');
  await page.locator('#scale-linear').click();
  await page.locator('#axis-y-auto').uncheck();
  await page.locator('#axis-y-min').fill('-1'); await page.locator('#axis-y-max').fill('1');
  await page.getByRole('button', { name: 'Apply axes', exact: true }).click();
  await expect(page.locator('#error')).toContainText('nonnegative');
  await page.locator('#axis-y-min').fill('2'); await page.locator('#axis-y-max').fill('2');
  await page.getByRole('button', { name: 'Apply axes', exact: true }).click();
  await expect(page.locator('#error')).toContainText('maximum must exceed');
});
test('five snapshots can be named, hidden, removed and replaced without changing the live filter', async ({ page }) => {
  for (const preset of ['notch', 'moving', 'onepole', 'resonator', 'delay']) {
    await page.locator('#preset').selectOption(preset); await page.locator('#compare').click();
  }
  await expect(page.locator('#comparison-list .saved-curve')).toHaveCount(5);
  await expect(page.locator('#magnitude .comparison-path')).toHaveCount(5);
  await expect(page.locator('#measurement-rows tr')).toHaveCount(6);
  const before = await coefficients(page);
  await page.locator('#compare').click();
  await expect(page.locator('#error')).toContainText('Remove a saved curve');
  await expect(page.locator('#comparison-list .saved-curve')).toHaveCount(5);
  const survivor = page.locator('#magnitude [data-curve-id="2"]');
  const color = await survivor.evaluate(path => path.style.stroke);
  const first = page.locator('#comparison-list [data-curve-id="1"]');
  await first.locator('.curve-name').fill('My notch'); await first.locator('.curve-name').press('Tab');
  await expect(page.locator('#measurement-rows [data-curve-id="1"]')).toContainText('My notch');
  await first.locator('.curve-visibility').uncheck();
  await expect(page.locator('#magnitude .comparison-path')).toHaveCount(4);
  await expect(page.locator('#measurement-rows tr')).toHaveCount(5);
  await page.locator('#compare').click();
  await expect(page.locator('#error')).toBeVisible();
  await first.locator('.remove-button').click();
  await expect(page.locator('#error')).toBeHidden();
  await page.locator('#compare').click();
  await expect(page.locator('#comparison-list .saved-curve')).toHaveCount(5);
  expect(await survivor.evaluate(path => path.style.stroke)).toBe(color);
  expect(await coefficients(page)).toEqual(before);
  await page.locator('#clear-comparisons').click();
  await expect(page.locator('#saved-comparisons')).toBeHidden();
  await expect(page.locator('#measurement-rows tr')).toHaveCount(1);
});
test('hidden snapshots do not affect automatic magnitude limits', async ({ page }) => {
  await formula(page, '100'); await page.locator('#compare').click();
  await formula(page, '1');
  const withCurve = Number(await page.locator('#magnitude').getAttribute('data-y-max'));
  await page.locator('#comparison-list .curve-visibility').uncheck();
  const withoutCurve = Number(await page.locator('#magnitude').getAttribute('data-y-max'));
  expect(withCurve).toBeGreaterThan(withoutCurve);
  await expect(page.locator('#measurement-rows tr')).toHaveCount(1);
  await page.locator('#comparison-list .curve-visibility').check();
  expect(Number(await page.locator('#magnitude').getAttribute('data-y-max'))).toBe(withCurve);
});
test('saved rates use same Hz or same normalized frequency without aliasing above Nyquist', async ({ page }) => {
  await formula(page, '(1+z^-1)/2'); await page.locator('#compare').click();
  await changeNumber(page, '#sample-rate', 16000);
  await changeNumber(page, '#cursor-number', 2000); await changeNumber(page, '#compare-frequency', 6000);
  const saved = page.locator('#measurement-rows [data-curve-id="1"]');
  await expect(saved).toHaveAttribute('data-result', 'unavailable');
  await expect(saved).toContainText('Outside this filter’s Nyquist range');
  await expect(page.locator('#measurement-rows [data-curve-id=live]')).toHaveAttribute('data-result', 'finite');
  await page.locator('#frequency-units').selectOption('normalized');
  await expect(saved).toHaveAttribute('data-result', 'finite');
  await expect(saved).toContainText('1000 → 3000 Hz');
  expect(await saved.locator('[data-field=ratio]').innerText()).toBe(await page.locator('#measurement-rows [data-curve-id=live] [data-field=ratio]').innerText());
  await expect(page.locator('#comparison-list .saved-rate')).toHaveText('8000 Hz');
});
test('new measurement and axis controls work on mobile without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await formula(page, '(1+z^-1)/2');
  await page.locator('#compare').click();
  await changeNumber(page, '#cursor-number', 0); await changeNumber(page, '#compare-frequency', 2000);
  await expect(page.locator('#measurement-rows [data-curve-id=live] [data-field=ratio]')).toHaveText('0.70711×');
  await applyFrequencyRange(page, 500, 3000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#measurement-reference')).toContainText('outside view');
  await page.screenshot({ path: '/tmp/filter-lab-comparison-mobile.png', fullPage: true });
});
test('export and import round-trip coefficients and reject invalid files', async ({ page }, testInfo) => {
  const before = await coefficients(page);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadEvent;
  const destination = testInfo.outputPath('roundtrip.json');
  await download.saveAs(destination);
  const data = JSON.parse(await fs.readFile(destination, 'utf8'));
  expect(data.version).toBe(1); expect(data.sampleRate).toBe(8000); expect(data.b).toEqual(before.b);
  await page.locator('#preset').selectOption('identity');
  await page.locator('#import-file').setInputFiles(destination);
  await expect(page.locator('#filter-title')).toHaveText('Imported filter');
  expect(await coefficients(page)).toEqual(before);
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"b":[1],"a":[0],"sampleRate":8000}') });
  await expect(page.locator('#error')).toContainText('a[0]');
  expect(await coefficients(page)).toEqual(before);
});
test('unstable, singular, cancelled and zero-filter explanations', async ({ page }) => {
  await page.locator('#preset').selectOption('unstable');
  await expect(page.locator('#stability')).toContainText('Unstable');
  await expect(page.locator('#analysis-warning')).toContainText('algebraic');
  await formula(page, '1/(1-z^-1)');
  await changeNumber(page, '#cursor-number', 0);
  await expect(page.locator('#cursor-gain')).toHaveText('Singular (pole)');
  await formula(page, '(1-z^-1)/(1-z^-1)');
  await expect(page.locator('#cursor-gain')).toHaveText('Undefined (0/0)');
  await expect(page.locator('#analysis-warning')).toContainText('cancellation');
  await formula(page, '0');
  await expect(page.locator('#plane-note')).toContainText('no finite zero list');
  await expect(page.locator('#cursor-gain')).toHaveText('−∞ dB');
});
test('multiplicity, delay and keyboard tab navigation', async ({ page }) => {
  await formula(page, '(1-z^-1)^4');
  await expect(page.locator('#z-plane [data-kind=zeros]')).toHaveCount(1);
  await expect(page.locator('#z-plane [data-kind=zeros]')).toContainText('×4');
  await page.locator('#tab-transfer').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-roots')).toBeFocused();
  await expect(page.locator('#panel-roots')).toBeVisible();
  await page.locator('#preset').selectOption('delay');
  await expect(page.locator('#root-delay')).toHaveValue('2');
  await expect(page.locator('#filter-kind')).toHaveText('FIR · order 2');
  await expect(page.locator('#filter-explanation')).toContainText('explicit delay');
});
test('mobile layout remains usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#tab-design').click();
  await page.locator('#design-method').selectOption('targets');
  await page.getByRole('button', { name: 'Design filter' }).click();
  await expect(page.locator('#filter-title')).toHaveText('63-tap custom FIR');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/filter-lab-mobile.png', fullPage: true });
});

test('license notice and complete license text are available offline', async ({ page }) => {
  await page.getByRole('link', { name: 'License', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Filter Lab license', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Copyright (C) 2026 koenig-arthur');
  await expect(page.locator('main')).toContainText('GPL-3.0-only');
  await expect(page.locator('main')).toContainText('There is no warranty');
  const license = await fs.readFile(path.resolve(__dirname, '../LICENSE'), 'utf8');
  expect(await page.locator('.license-text').textContent()).toBe(license);
  await expect(page.getByRole('link', { name: 'Download the license text' })).toHaveAttribute('href', 'LICENSE');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Back to Filter Lab' }).click();
  await expect(page.locator('#filter-title')).toHaveText('1000 Hz notch');
});
