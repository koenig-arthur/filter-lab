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
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dsp.js');
const references = require('./references.json');
function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function arrayClose(actual, expected, tolerance = 1e-9) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => close(v, expected[i], tolerance));
}
function coeffEqual(f, b, a) { arrayClose(f.b, b); arrayClose(f.a, a); }
test('normalization and coefficient syntax', () => {
  coeffEqual(D.normalize([2, 4], [2, -1]), [1, 2], [1, -.5]);
  arrayClose(D.parseCoefficients('[1, -2.5e-2, +.3]'), [1, -.025, .3]);
  arrayClose(D.parseCoefficients('1  2; 3'), [1, 2, 3]);
  coeffEqual(D.normalize([1, 0, 0], [1, 0]), [1], [1]);
});
test('safe parser: positive and negative powers, factored rational expressions', () => {
  for (const s of ['(1+z^-1)/(1-0.8*z^-1)', '(z+1)/(z-.8)', 'H(z) = (1+z^(-1))/(1-8e-1*z^(-1))']) coeffEqual(D.parseExpression(s), [1, 1], [1, -.8]);
  coeffEqual(D.parseExpression('(1-z^-1)^2'), [1, -2, 1], [1]);
  coeffEqual(D.parseExpression('1/(z-.8)'), [0, 1], [1, -.8]);
  coeffEqual(D.parseExpression('1 + .5*z^-1 + .25*z^-2'), [1, .5, .25], [1]);
  coeffEqual(D.parseExpression('-(z^-1)^2'), [0, 0, -1], [1]);
  coeffEqual(D.parseExpression('0'), [0], [1]);
  coeffEqual(D.parseExpression('z/z'), [1], [1]);
  coeffEqual(D.parseExpression('z^0'), [1], [1]);
});
test('parser rejects invalid, unsafe, noncausal, and overlarge expressions', () => {
  for (const value of ['', 'z', 'z^1.5', 'z^-65', '1/0', '1/(z-z)', '(1+z^-1', 'alert(1)', 'Math.sin(z)', '1;globalThis.x=1', '2z^-1', '1e999', '(1+z^-64)^2', '(1+z)^-1.5']) {
    assert.throws(() => D.parseExpression(value), undefined, value);
  }
  for (const value of ['[1,,2]', '1,', 'Infinity', '', '1x', '[1,2']) assert.throws(() => D.parseCoefficients(value), undefined, value);
  assert.throws(() => D.normalize([1], [0]));
  assert.throws(() => D.normalize([1], [0, 1]));
  assert.throws(() => D.normalize([Infinity], [1]));
  assert.throws(() => D.normalize([1], [1], 0));
  assert.throws(() => D.normalize([1], [1], NaN));
  assert.throws(() => D.normalize(Array(66).fill(1), [1]));
});
test('identity and zero filter', () => {
  const identity = D.normalize([1], [1]), zero = D.normalize([0], [1]);
  arrayClose(D.impulseResponse(identity, 4).values, [1, 0, 0, 0]);
  arrayClose(D.impulseResponse(zero, 4).values, [0, 0, 0, 0]);
  assert.equal(D.responseAt(identity, 1234).magnitude, 1);
  assert.equal(D.responseAt(zero, 1234).db, -Infinity);
  assert.equal(D.responseAt(zero, 1234).phase, null);
  assert.equal(D.analyze(zero).zeroFilter, true);
});
test('FIR and explicit delay have origin poles without becoming IIR', () => {
  const average = D.analyze(D.normalize([1/3, 1/3, 1/3], [1]));
  assert.equal(average.fir, true); assert.equal(average.originPoles, 2);
  close(average.zeros[0].re, -.5); close(Math.abs(average.zeros[0].im), Math.sqrt(3)/2);
  const delay = D.parseExpression('z^-2'), a = D.analyze(delay);
  assert.equal(a.delay, 2); assert.equal(a.originPoles, 2); assert.equal(a.zeros.length, 0);
  arrayClose(D.impulseResponse(delay, 5).values, [0, 0, 1, 0, 0]);
  close(D.responseAt(delay, 1000).magnitude, 1); close(D.responseAt(delay, 1000).phase, -Math.PI / 2);
});
test('unequal orders produce the correct origin zeros', () => {
  const result = D.analyze(D.normalize([.2], [1, -.8]));
  assert.equal(result.originZeros, 1); assert.equal(result.originPoles, 0);
  close(result.poles[0].re, .8);
  assert.equal(D.analyze(D.parseExpression('1/(z-.8)')).originZeros, 0);
});
test('real and conjugate root placement round-trips', () => {
  const model = { zeros: [D.C(-1), D.C(.4, .7), D.C(.4, -.7)], poles: [D.C(.8), D.C(.3, .2), D.C(.3, -.2)], gain: .7, delay: 2 };
  const f = D.fromFactors(model), a = D.analyze(f);
  assert.equal(a.rootError, null); close(a.gain, .7); assert.equal(a.delay, 2);
  const reconstructed = D.fromFactors(a);
  arrayClose(reconstructed.b, f.b); arrayClose(reconstructed.a, f.a);
  assert.throws(() => D.fromFactors({ zeros: [D.C(1, 1)] }));
  assert.throws(() => D.fromFactors({ delay: -1 }));
  assert.throws(() => D.fromFactors({ delay: 1.5 }));
  assert.throws(() => D.fromFactors({ zeros: Array(64).fill(D.C(1)), delay: 1 }));
});
test('repeated roots and origin multiplicities', () => {
  for (const order of [2, 4, 6]) {
    const f = D.parseExpression(`(1-z^-1)^${order}`), a = D.analyze(f);
    assert.equal(a.rootError, null); assert.equal(a.zeros.length, order);
    a.zeros.forEach(r => { close(r.re, 1, 1e-4); close(r.im, 0, 1e-4); });
    assert.equal(a.originPoles, order);
  }
  assert.equal(D.polynomialRoots([1, 0, 0, 0]).length, 3);
});
test('placed repeated factors up to order 64 preserve exact positions and binomial coefficients', () => {
  for (const count of [11, 20, 32, 64]) for (const kind of ['zeros', 'poles']) {
    const coordinate = kind === 'zeros' ? -.5 : .5;
    const roots = Array.from({ length: count }, () => D.C(coordinate));
    const model = { [kind]: roots };
    const { filter, analysis } = D.analyzeFactors(model, 200);
    assert.equal(analysis.rootError, null); assert.equal(analysis.order, count);
    assert.deepEqual(analysis[kind], roots); assert.equal(analysis.stability, 'stable');
    let choose = 1;
    const expected = Array.from({ length: count + 1 }, (_, k) => {
      if (k) choose *= (count - k + 1) / k;
      return choose * (-coordinate) ** k;
    });
    arrayClose(kind === 'zeros' ? filter.b : filter.a, expected);
    roots[0] = D.C(-.3);
    const moved = D.analyzeFactors(model);
    assert.equal(moved.analysis.rootError, null); assert.deepEqual(moved.analysis[kind], roots);
    assert.equal(analysis[kind][0].re, coordinate); // No aliases into editable state.
  }
});
test('placed conjugate factors retain multiplicities and ignore inactive origin factors', () => {
  for (const count of [11, 20, 32, 64]) {
    const zeros = Array.from({ length: Math.floor(count / 2) }, () => [D.C(.3, .4), D.C(.3, -.4)]).flat();
    if (count % 2) zeros.push(D.C(-.5));
    const result = D.analyzeFactors({ zeros });
    assert.deepEqual(result.analysis.zeros, zeros); assert.equal(result.analysis.originPoles, count);
    assert.ok(result.filter.b.every(Number.isFinite));
    close(D.responseAt(result.filter, 4000).magnitude, 1.85 ** Math.floor(count / 2) * (count % 2 ? .5 : 1), 1e-8);
  }
  const model = { zeros: [D.C(), D.C(-1)], poles: [D.C(), D.C(.5), D.C(.25)], gain: 2, delay: 3 };
  const { filter, analysis } = D.analyzeFactors(model);
  arrayClose(filter.b, [0, 0, 0, 2, 2]); arrayClose(filter.a, [1, -.75, .125]);
  assert.equal(analysis.delay, 3); assert.equal(analysis.zeros.length, 1); assert.equal(analysis.poles.length, 2);
  assert.equal(analysis.originPoles, 2); assert.equal(analysis.originZeros, 0);
  assert.equal(D.analyzeFactors({ zeros: [D.C()], poles: [D.C(.8)] }).analysis.originZeros, 1);
  const neutral = D.analyzeFactors({ zeros: [D.C(), D.C()], poles: [D.C()] });
  arrayClose(neutral.filter.b, [1]); arrayClose(neutral.filter.a, [1]); assert.equal(neutral.analysis.order, 0);
});
test('factor analysis preserves a zero-gain model, denominator stability and cancellations', () => {
  const model = { zeros: [D.C(-.3), D.C(1.1)], poles: [D.C(1.1)], gain: .5, delay: 4 };
  const snapshot = JSON.stringify(model), before = D.analyzeFactors(model);
  const zero = D.analyzeFactors({ ...model, gain: 0 });
  assert.equal(zero.analysis.zeroFilter, true); assert.equal(zero.analysis.zeros.length, 0);
  assert.equal(zero.analysis.stability, 'unstable'); assert.equal(JSON.stringify(model), snapshot);
  assert.deepEqual(D.analyzeFactors(model), before);
  assert.equal(before.analysis.cancellations.length, 1);
  assert.equal(D.analyzeFactors({ poles: [D.C(1)] }).analysis.stability, 'boundary');
  assert.equal(D.analyzeFactors({ poles: [D.C(.8)] }).analysis.stability, 'stable');
  for (const model of [{ zeros: [D.C(0, 1)] }, { poles: [D.C(Infinity)] }, { gain: NaN }, { delay: -1 }, { zeros: Array(64).fill(D.C()), delay: 1 }]) {
    assert.throws(() => D.analyzeFactors(model));
  }
});
test('denominator stability, bounded divergence, and cancellation handling', () => {
  assert.equal(D.analyze(D.normalize([1], [1, -.8])).stability, 'stable');
  assert.equal(D.analyze(D.normalize([1], [1, -1])).stability, 'boundary');
  assert.equal(D.analyze(D.normalize([1], [1, -1.05])).stability, 'unstable');
  const unstable = D.impulseResponse(D.normalize([1], [1, -2]), 128);
  assert.equal(unstable.truncated, true); assert.ok(unstable.values.every(Number.isFinite));
  const cancelled = D.normalize([1, -1.1], [1, -1.1]);
  assert.equal(D.analyze(cancelled).stability, 'unstable');
  assert.equal(D.analyze(cancelled).cancellations.length, 1);
  close(D.responseAt(cancelled, 100).magnitude, 1);
  assert.equal(D.responseAt(D.normalize([1, -1], [1, -1]), 0).kind, 'indeterminate');
  assert.equal(D.responseAt(D.normalize([1], [1, -1]), 0).kind, 'singular');
  const near = D.normalize([1, -.800001], [1, -.8]);
  assert.notEqual(D.responseAt(near, 0).magnitude, 1);
});
test('notch at 1000 Hz, Butterworth cutoff, and linear-phase FIR symmetry', () => {
  const notch = D.designIIR({ type: 'notch', frequency: 1000, q: 10 });
  close(D.responseAt(notch, 1000).magnitude, 0, 1e-12);
  close(D.responseAt(notch, 0).magnitude, 1);
  close(D.responseAt(notch, 4000).magnitude, 1);
  for (const type of ['lowpass', 'highpass']) close(D.responseAt(D.designIIR({ type, frequency: 1000 }), 1000).db, -3.01029995664);
  for (const type of ['lowpass', 'highpass', 'bandpass', 'notch']) {
    const filter = D.designFIR({ type, frequency: 1000, upperFrequency: 1500, taps: 63 });
    arrayClose(filter.b, filter.b.slice().reverse(), 1e-13);
    assert.equal(D.analyze(filter).rootError, null, `${type} 63-tap roots`);
  }
});
test('design validation rejects invalid bands, Q, taps and target grids', () => {
  for (const frequency of [-1, 0, 4000, 5000, NaN]) assert.throws(() => D.designIIR({ type: 'lowpass', frequency }));
  for (const q of [0, -1, Infinity, 1001]) assert.throws(() => D.designIIR({ type: 'notch', frequency: 1000, q }));
  for (const taps of [2, 4, 64, 65, 3.5]) assert.throws(() => D.designFIR({ type: 'lowpass', frequency: 1000, taps }));
  assert.throws(() => D.designFIR({ type: 'bandpass', frequency: 1000, upperFrequency: 900 }));
  for (const points of [[], [{ frequency: 0, db: 0 }], [{ frequency: 1, db: 0 }, { frequency: 4000, db: 0 }], [{ frequency: 0, db: 0 }, { frequency: 3999, db: 0 }], [{ frequency: 0, db: 0 }, { frequency: 0, db: 0 }, { frequency: 4000, db: 0 }], [{ frequency: 0, db: -Infinity }, { frequency: 4000, db: 0 }]]) assert.throws(() => D.designTargets(points));
});
test('relative gain is measured against the reference, not the input', () => {
  const f = D.normalize([.5, .5], [1]);
  const result = D.compareGain(f, 2000, 8000 / 3);
  assert.equal(result.kind, 'finite');
  close(result.reference.db, -3.010299956639812);
  close(result.measurement.db, -6.020599913279624);
  close(result.deltaDb, -3.010299956639812);
  close(result.amplitudeRatio, Math.SQRT1_2);
  const reverse = D.compareGain(f, 8000 / 3, 2000);
  close(reverse.deltaDb, -result.deltaDb); close(reverse.amplitudeRatio, Math.SQRT2);
  const same = D.compareGain(f, 1234.56789, 1234.56789);
  close(same.deltaDb, 0); close(same.amplitudeRatio, 1);
});
test('relative gain evaluates exact frequencies between plotted samples', () => {
  const fs = 8000, reference = 432.123456, probe = 1987.654321;
  const expectedRatio = Math.cos(Math.PI * probe / fs) / Math.cos(Math.PI * reference / fs);
  const f = D.normalize([.5, .5], [1], fs);
  const result = D.compareGain(f, reference, probe);
  close(result.amplitudeRatio, expectedRatio, 1e-12);
  close(result.deltaDb, 20 * Math.log10(expectedRatio), 1e-12);
});
test('relative gain handles zero references, zero targets and singularities', () => {
  const f = D.normalize([.5, .5], [1]);
  const zeroTarget = D.compareGain(f, 0, 4000);
  assert.equal(zeroTarget.kind, 'finite'); assert.equal(zeroTarget.deltaDb, -Infinity); assert.equal(zeroTarget.amplitudeRatio, 0);
  for (const target of [0, 4000]) {
    const zeroReference = D.compareGain(f, 4000, target);
    assert.equal(zeroReference.kind, 'zero-reference'); assert.equal(zeroReference.deltaDb, null); assert.equal(zeroReference.amplitudeRatio, null);
  }
  assert.equal(D.compareGain(D.normalize([0], [1]), 100, 200).kind, 'zero-reference');
  const integrator = D.normalize([1], [1, -1]);
  for (const [r, p] of [[0, 100], [100, 0]]) assert.equal(D.compareGain(integrator, r, p).kind, 'unavailable');
  assert.equal(D.compareGain(D.normalize([1, -1], [1, -1]), 0, 100).kind, 'unavailable');
});
test('comparison frequencies respect each filter’s own Nyquist range', () => {
  const lowRate = D.normalize([.5, .5], [1], 8000), highRate = D.normalize([.5, .5], [1], 16000);
  assert.equal(D.compareGain(lowRate, 2000, 6000).kind, 'unavailable');
  assert.equal(D.compareGain(lowRate, 6000, 2000).kind, 'unavailable');
  for (const p of [-1, Infinity, NaN]) assert.equal(D.compareGain(lowRate, 1000, p).kind, 'unavailable');
  const first = D.compareGain(lowRate, 1000, 3000), second = D.compareGain(highRate, 2000, 6000);
  close(first.deltaDb, second.deltaDb); close(first.amplitudeRatio, second.amplitudeRatio);
});
test('bounded response sampling preserves defaults and resolves a narrow view', () => {
  const f = D.normalize([.5, .5], [1]);
  const defaults = D.frequencyResponse(f);
  assert.equal(defaults.length, 1025); assert.equal(defaults[0].frequency, 0); assert.equal(defaults.at(-1).frequency, 4000);
  const narrow = D.frequencyResponse(f, 1025, { minHz: 1000.1, maxHz: 1000.9 });
  assert.equal(narrow.length, 1025); assert.equal(narrow[0].frequency, 1000.1); assert.equal(narrow.at(-1).frequency, 1000.9);
  narrow.forEach(p => close(p.magnitude, Math.abs(Math.cos(Math.PI * p.frequency / 8000)), 1e-12));
  for (const range of [{ minHz: -1 }, { minHz: 200, maxHz: 100 }, { minHz: 100, maxHz: 100 }, { maxHz: 4001 }, { maxHz: Infinity }, { minHz: NaN }]) {
    assert.throws(() => D.frequencyResponse(f, 1025, range));
  }
  for (const count of [0, 1, 2.5, Infinity, 65538]) assert.throws(() => D.frequencyResponse(f, count));
});
for (const ref of references.cases) test(`SciPy reference: ${ref.name}`, () => {
  let f = D.normalize(ref.b, ref.a, ref.sampleRate);
  if (ref.design?.family === 'fir') f = D.designFIR(ref.design, ref.sampleRate);
  if (ref.design?.family === 'iir') f = D.designIIR(ref.design, ref.sampleRate);
  if (ref.design?.family === 'targets') f = D.designTargets(ref.design.points, ref.design.taps, ref.sampleRate);
  arrayClose(f.b, ref.b, 2e-12); arrayClose(f.a, ref.a, 2e-12);
  arrayClose(D.impulseResponse(f, 128).values, ref.impulse, 1e-10);
  ref.frequencies.forEach((hz, i) => {
    const response = D.responseAt(f, hz);
    close(response.magnitude, ref.magnitude[i], 1e-10);
    if (ref.magnitude[i] > 1e-10) close(Math.sin((response.phase - ref.phase[i]) / 2), 0, 1e-9);
  });
  const a = D.analyze(f);
  assert.equal(a.rootError, null, ref.name);
  assert.equal(a.stability, 'stable');
  if (!a.zeroFilter) {
    const rebuilt = D.fromFactors(a, ref.sampleRate);
    arrayClose(rebuilt.b, f.b, 3e-6); arrayClose(rebuilt.a, f.a, 3e-6);
  }
});
