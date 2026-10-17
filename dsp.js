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
/* Filter Lab DSP. Coefficients are ascending powers of z^-1. No DOM required. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FilterDSP = api;
})(globalThis, function () {
  'use strict';
  const MAX_ORDER = 64;
  const TAU = 2 * Math.PI;
  const C = (re = 0, im = 0) => ({ re, im });
  const add = (a, b) => C(a.re + b.re, a.im + b.im);
  const sub = (a, b) => C(a.re - b.re, a.im - b.im);
  const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const scale = (a, k) => C(a.re * k, a.im * k);
  const abs = a => Math.hypot(a.re, a.im);
  function div(a, b) {
    if (Math.abs(b.re) >= Math.abs(b.im)) {
      const r = b.im / b.re, d = b.re + b.im * r;
      return C((a.re + a.im * r) / d, (a.im - a.re * r) / d);
    }
    const r = b.re / b.im, d = b.im + b.re * r;
    return C((a.re * r + a.im) / d, (a.im * r - a.re) / d);
  }
  function sqrt(a) {
    const r = abs(a);
    if (!r) return C();
    if (a.re >= 0) {
      const re = Math.sqrt((r + a.re) / 2);
      return C(re, a.im / (2 * re));
    }
    const im = (a.im < 0 ? -1 : 1) * Math.sqrt((r - a.re) / 2);
    return C(a.im / (2 * im), im);
  }
  const finite = (v, name) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a finite number.`);
    return v;
  };
  function sampleRate(value) {
    finite(value, 'Sampling frequency');
    if (value <= 0) throw new Error('Sampling frequency must be greater than zero.');
    return value;
  }
  function trim(values) {
    const out = values.slice();
    while (out.length > 1 && out[out.length - 1] === 0) out.pop();
    return out;
  }
  function normalize(b, a, fs = 8000) {
    sampleRate(fs);
    for (const [name, values] of [['Numerator', b], ['Denominator', a]]) {
      if (!Array.isArray(values) || !values.length) throw new Error(`${name} must be a nonempty coefficient list.`);
      values.forEach(v => finite(v, `${name} coefficient`));
      if (values.length > MAX_ORDER + 1) throw new Error(`Maximum supported order is ${MAX_ORDER}.`);
    }
    if (a[0] === 0) throw new Error('a[0] must be nonzero for a causal recurrence.');
    const bn = trim(b.map(v => v / a[0])), an = trim(a.map(v => v / a[0]));
    [...bn, ...an].forEach(v => finite(v, 'Normalized coefficient'));
    return { b: bn, a: an, sampleRate: fs };
  }
  function parseCoefficients(text) {
    let source = String(text).trim();
    if (source.startsWith('[') && source.endsWith(']')) source = source.slice(1, -1).trim();
    if (!source) throw new Error('Enter at least one coefficient.');
    if (/[,;]\s*[,;]|^[,;]|[,;]$/.test(source)) throw new Error('A coefficient is missing between separators.');
    const pieces = source.split(/[\s,;]+/);
    return pieces.map(token => {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) {
        throw new Error(`Invalid coefficient “${token}”. Use decimal numbers, separated by commas or spaces.`);
      }
      return finite(Number(token), 'Coefficient');
    });
  }

  // Rational polynomial parser in z. An AST is evaluated with polynomial arithmetic,
  // never as JavaScript. Common powers of z are removed before causal conversion.
  function parseExpression(input, fs = 8000) {
    const source = String(input).replace(/^\s*H\s*\(\s*z\s*\)\s*=\s*/i, '').replace(/−/g, '-');
    if (source.length > 4096) throw new Error('Expression is too long (maximum 4096 characters).');
    const tokens = [];
    const pattern = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|(z)|([()+\-*/^]))/y;
    let cursor = 0;
    while (cursor < source.length) {
      if (!source.slice(cursor).trim()) break;
      pattern.lastIndex = cursor;
      const match = pattern.exec(source);
      if (!match) throw new Error(`Unsupported syntax near “${source.slice(cursor, cursor + 15)}”. Use numbers, z, + − * / ^ and parentheses.`);
      tokens.push(match[1] ? { type: 'number', value: finite(Number(match[1]), 'Number') } : { type: match[2] || match[3] });
      cursor = pattern.lastIndex;
    }
    let pos = 0, depth = 0;
    const constant = value => new Map(value === 0 ? [] : [[0, value]]);
    function clean(poly) {
      for (const [k, v] of poly) {
        finite(v, 'Expanded coefficient');
        if (v === 0) poly.delete(k);
        if (k > 256) throw new Error('Expression expands beyond the supported complexity.');
      }
      return poly;
    }
    function pAdd(a, b, sign = 1) {
      const result = new Map(a);
      for (const [k, v] of b) result.set(k, (result.get(k) || 0) + sign * v);
      return clean(result);
    }
    function pMul(a, b) {
      const result = new Map();
      for (const [i, x] of a) for (const [j, y] of b) result.set(i + j, (result.get(i + j) || 0) + x * y);
      return clean(result);
    }
    const rational = (n, d = constant(1)) => ({ n, d });
    function product(a, b, divide = false) {
      if (divide && !b.n.size) throw new Error('Division by zero in expression.');
      return rational(pMul(a.n, divide ? b.d : b.n), pMul(a.d, divide ? b.n : b.d));
    }
    function primary() {
      const token = tokens[pos++];
      if (!token) throw new Error('Expression ends unexpectedly.');
      if (token.type === 'number') return rational(constant(token.value));
      if (token.type === 'z') return rational(new Map([[1, 1]]));
      if (token.type === '(') {
        if (++depth > 64) throw new Error('Too many nested parentheses.');
        const result = sum();
        if (tokens[pos++]?.type !== ')') throw new Error('Missing closing parenthesis.');
        depth--;
        return result;
      }
      throw new Error('Expected a number, z, or a parenthesized expression.');
    }
    function power() {
      let base = primary();
      if (tokens[pos]?.type === '^') {
        pos++;
        const parenthesized = tokens[pos]?.type === '(';
        if (parenthesized) pos++;
        let sign = 1;
        if (tokens[pos]?.type === '-' || tokens[pos]?.type === '+') sign = tokens[pos++].type === '-' ? -1 : 1;
        const token = tokens[pos++];
        if (!token || token.type !== 'number' || !Number.isInteger(token.value) || token.value > MAX_ORDER) {
          throw new Error(`Powers must be integers from -${MAX_ORDER} to ${MAX_ORDER}.`);
        }
        if (parenthesized && tokens[pos++]?.type !== ')') throw new Error('Close the integer exponent with ).');
        const exponent = token.value * sign;
        if (exponent < 0) {
          if (!base.n.size) throw new Error('Zero cannot have a negative power.');
          base = rational(base.d, base.n);
        }
        let out = rational(constant(1)), count = Math.abs(exponent);
        while (count) {
          if (count % 2) out = product(out, base);
          count = Math.floor(count / 2);
          if (count) base = product(base, base);
        }
        return out;
      }
      return base;
    }
    function unary() {
      if (tokens[pos]?.type === '+' || tokens[pos]?.type === '-') {
        const negative = tokens[pos++].type === '-';
        const value = unary();
        return negative ? rational(pMul(constant(-1), value.n), value.d) : value;
      }
      return power();
    }
    function term() {
      let result = unary();
      while (tokens[pos]?.type === '*' || tokens[pos]?.type === '/') {
        const divide = tokens[pos++].type === '/';
        result = product(result, unary(), divide);
      }
      return result;
    }
    function sum() {
      let result = term();
      while (tokens[pos]?.type === '+' || tokens[pos]?.type === '-') {
        const sign = tokens[pos++].type === '+' ? 1 : -1, right = term();
        result = rational(pAdd(pMul(result.n, right.d), pMul(right.n, result.d), sign), pMul(result.d, right.d));
      }
      return result;
    }
    const result = sum();
    if (pos !== tokens.length) throw new Error('Unexpected token. Write multiplication explicitly, for example 0.8*z^-1.');
    if (!result.d.size) throw new Error('The denominator is zero.');
    if (!result.n.size) return normalize([0], [1], fs);
    const offset = Math.min(Math.min(...result.n.keys()), Math.min(...result.d.keys()));
    const degree = Math.max(...result.d.keys()) - offset;
    if (Math.max(...result.n.keys()) - offset > degree) throw new Error('This expression requires a time advance and is noncausal. Add sufficient delay (z^-1).');
    if (degree > MAX_ORDER) throw new Error(`Expanded filter order exceeds ${MAX_ORDER}.`);
    const b = [], a = [];
    for (let k = degree; k >= 0; k--) {
      b.push(result.n.get(k + offset) || 0);
      a.push(result.d.get(k + offset) || 0);
    }
    return normalize(b, a, fs);
  }

  function convolve(a, b) {
    const out = Array(a.length + b.length - 1).fill(0);
    a.forEach((x, i) => b.forEach((y, j) => { out[i + j] += x * y; }));
    return out;
  }
  function polynomialFromRoots(roots) {
    const used = new Set();
    let factors = [];
    roots.forEach((r, i) => {
      if (used.has(i)) return;
      used.add(i);
      if (r.im === 0) { factors.push([1, -r.re]); return; }
      const mate = roots.findIndex((q, j) => !used.has(j) && Math.hypot(q.re - r.re, q.im + r.im) <= 1e-10 * (1 + abs(r)));
      if (mate < 0) throw new Error('Complex roots must occur in conjugate pairs for real coefficients.');
      used.add(mate);
      const re = (r.re + roots[mate].re) / 2, im = (r.im - roots[mate].im) / 2;
      factors.push([1, -2 * re, re * re + im * im]);
    });
    if (!factors.length) return [1];
    // Real quadratic factors avoid spurious imaginary coefficients. Pair factors
    // from opposite ends of the real axis to reduce large intermediate terms.
    factors.sort((a, b) => a[1] - b[1]);
    while (factors.length > 1) {
      const next = [];
      while (factors.length > 1) next.push(convolve(factors.shift(), factors.pop()));
      if (factors.length) next.push(factors[0]);
      factors = next;
    }
    return factors[0];
  }
  function fromFactors({ zeros = [], poles = [], gain = 1, delay = 0 }, fs = 8000) {
    finite(gain, 'Gain');
    if (!Number.isInteger(delay) || delay < 0 || delay > MAX_ORDER) throw new Error('Delay must be an integer from 0 to 64 samples.');
    if (zeros.length + delay > MAX_ORDER || poles.length > MAX_ORDER) throw new Error('Root count plus delay exceeds order 64.');
    [...zeros, ...poles].forEach(r => { finite(r.re, 'Root real part'); finite(r.im, 'Root imaginary part'); });
    const b = Array(delay).fill(0).concat(polynomialFromRoots(zeros).map(v => gain * v));
    return normalize(b, polynomialFromRoots(poles), fs);
  }
  function evaluatePoly(coeff, z) {
    let p = coeff[0], dp = C(), ddp = C(), bound = abs(p);
    for (let j = 1; j < coeff.length; j++) {
      ddp = add(mul(ddp, z), dp);
      dp = add(mul(dp, z), p);
      p = add(mul(p, z), coeff[j]);
      bound = bound * abs(z) + abs(coeff[j]);
    }
    return { p, dp, ddp, bound };
  }
  function laguerre(coeff, initial) {
    let z = initial;
    const n = coeff.length - 1;
    for (let iteration = 0; iteration < 120; iteration++) {
      const { p, dp, ddp, bound } = evaluatePoly(coeff, z);
      if (abs(p) <= 2e-15 * bound) return z;
      const g = div(dp, p), h = sub(mul(g, g), scale(div(ddp, p), 2));
      const radical = sqrt(scale(sub(scale(h, n), mul(g, g)), n - 1));
      const d1 = add(g, radical), d2 = sub(g, radical);
      const d = abs(d1) > abs(d2) ? d1 : d2;
      const step = abs(d) > 0 ? div(C(n), d) : scale(C(Math.cos(iteration), Math.sin(iteration)), 1 + abs(z));
      const fraction = iteration % 12 === 11 ? 0.5 : 1;
      const next = sub(z, scale(step, fraction));
      if (!Number.isFinite(abs(next))) break;
      if (abs(sub(next, z)) < 1e-14 * (1 + abs(z))) return next;
      z = next;
    }
    const { p, bound } = evaluatePoly(coeff, z);
    if (abs(p) / Math.max(bound, 1e-300) < 1e-11) return z;
    throw new Error('Polynomial root iteration did not converge.');
  }
  function rootQuality(coeff, roots) {
    const cc = coeff.map(v => C(v));
    let residual = 0;
    for (const r of roots) {
      const result = evaluatePoly(cc, r);
      residual = Math.max(residual, abs(result.p) / Math.max(result.bound, 1e-300));
    }
    let reconstructed;
    try { reconstructed = polynomialFromRoots(roots); } catch { return Infinity; }
    const norm = Math.max(...coeff.map(v => Math.abs(v / coeff[0])));
    let error = 0;
    reconstructed.forEach((v, i) => { error = Math.max(error, Math.abs(v - coeff[i] / coeff[0]) / norm); });
    return Math.max(residual, error);
  }
  function polynomialRoots(coefficients) {
    let coeff = coefficients.slice();
    while (coeff.length > 1 && coeff[0] === 0) coeff.shift();
    if (coeff.every(v => v === 0)) throw new Error('The zero polynomial does not have a finite root list.');
    if (coeff.length === 1) return [];
    const origin = [];
    while (coeff.length > 1 && coeff[coeff.length - 1] === 0) { origin.push(C()); coeff.pop(); }
    if (coeff.length === 1) return origin;
    coeff = coeff.map(v => v / coeff[0]);
    let best = null, quality = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let reduced = coeff.map(v => C(v));
        const roots = [];
        while (reduced.length > 1) {
          let r = reduced.length === 2 ? scale(div(reduced[1], reduced[0]), -1) : laguerre(reduced, attempt === 0 ? C() : C(0.37 * attempt, 0.19 * attempt));
          if (Math.abs(r.im) < 1e-9 * (1 + Math.abs(r.re))) r.im = 0;
          const deflate = point => {
            const next = [reduced[0]];
            for (let j = 1; j < reduced.length - 1; j++) next.push(add(reduced[j], mul(point, next[j - 1])));
            reduced = next;
            roots.push(point);
          };
          deflate(r);
          if (r.im !== 0 && reduced.length > 1) {
            deflate(C(r.re, -r.im));
            reduced = reduced.map(v => C(v.re));
          }
        }
        // Polish pairs together so real coefficient reconstruction remains real.
        const original = coeff.map(v => C(v));
        for (let i = 0; i < roots.length; i++) {
          const wasComplex = roots[i].im !== 0;
          let polished = laguerre(original, roots[i]);
          if (!wasComplex) polished = C(polished.re);
          roots[i] = polished;
          if (wasComplex && i + 1 < roots.length) roots[++i] = C(polished.re, -polished.im);
        }
        const error = rootQuality(coeff, roots);
        if (error < quality) { quality = error; best = roots; }
        if (error < 1e-9) break;
      } catch { /* Try another deterministic starting point. */ }
    }
    if (!best || quality > 2e-6) throw new Error('Roots are numerically ill-conditioned or did not converge. Response and impulse plots still use the original coefficients. Try a lower order or explicit root placement.');
    return best.concat(origin).sort((a, b) => a.re - b.re || a.im - b.im);
  }
  function analysisBase(filter) {
    const { b, a } = filter;
    const zeroFilter = b.every(v => v === 0);
    let delay = 0;
    while (!zeroFilter && b[delay] === 0) delay++;
    return { fir: a.length === 1, order: Math.max(b.length, a.length) - 1, delay,
      gain: zeroFilter ? 0 : b[delay], zeroFilter, zeros: [], poles: [],
      originZeros: zeroFilter ? 0 : Math.max(0, a.length - b.length),
      originPoles: zeroFilter ? 0 : Math.max(0, b.length - a.length),
      rootError: null, stability: 'unknown', cancellations: [] };
  }
  function classifyPoles(out) {
    const radius = Math.max(0, ...out.poles.map(abs));
    out.maxPoleRadius = radius;
    out.stability = radius < 1 - 1e-9 ? 'stable' : radius > 1 + 1e-9 ? 'unstable' : 'boundary';
  }
  function findCancellations(out) {
    const available = out.zeros.slice();
    for (const pole of out.poles) {
      const index = available.findIndex(z => abs(sub(z, pole)) < 1e-5 * (1 + abs(pole)));
      if (index >= 0) out.cancellations.push({ pole, zero: available.splice(index, 1)[0] });
    }
  }
  function analyze(filter) {
    const out = analysisBase(filter);
    try {
      out.poles = polynomialRoots(filter.a);
      classifyPoles(out);
      if (!out.zeroFilter) out.zeros = polynomialRoots(filter.b.slice(out.delay));
      findCancellations(out);
    } catch (error) { out.rootError = error.message; }
    return out;
  }
  function analyzeFactors(model, fs = 8000) {
    // The positions are known: expanding then solving the polynomial would lose
    // precision for repeated roots and can fail even for a valid placed design.
    const filter = fromFactors(model, fs), analysis = analysisBase(filter);
    const active = roots => roots.filter(r => r.re !== 0 || r.im !== 0).map(r => C(r.re, r.im));
    analysis.poles = active(model.poles || []);
    analysis.zeros = analysis.zeroFilter ? [] : active(model.zeros || []);
    classifyPoles(analysis);
    findCancellations(analysis);
    return { filter, analysis };
  }
  function responseAt(filter, frequency) {
    const w = TAU * frequency / filter.sampleRate;
    const z = C(Math.cos(w), -Math.sin(w));
    function evalDelay(coeff) {
      let result = C();
      for (let i = coeff.length - 1; i >= 0; i--) result = add(mul(result, z), C(coeff[i]));
      return result;
    }
    const numerator = evalDelay(filter.b), denominator = evalDelay(filter.a);
    const ns = Math.max(1e-300, filter.b.reduce((sum, v) => sum + Math.abs(v), 0));
    const ds = filter.a.reduce((sum, v) => sum + Math.abs(v), 0);
    if (abs(denominator) <= 2e-14 * ds) return { frequency, kind: abs(numerator) <= 2e-14 * ns ? 'indeterminate' : 'singular', magnitude: null, db: null, phase: null };
    const value = div(numerator, denominator);
    const magnitude = abs(numerator) <= 2e-14 * ns ? 0 : abs(value);
    return { frequency, kind: 'finite', magnitude, db: magnitude === 0 ? -Infinity : 20 * Math.log10(magnitude), phase: magnitude === 0 ? null : Math.atan2(value.im, value.re) };
  }
  function compareGain(filter, referenceHz, measurementHz) {
    const inRange = f => Number.isFinite(f) && f >= 0 && f <= filter.sampleRate / 2;
    const reference = inRange(referenceHz) ? responseAt(filter, referenceHz) : null;
    const measurement = inRange(measurementHz) ? responseAt(filter, measurementHz) : null;
    const result = { reference, measurement, deltaDb: null, amplitudeRatio: null };
    if (!reference || !measurement) return { ...result, kind: 'unavailable', reason: 'Outside this filter’s Nyquist range.' };
    if (reference.kind !== 'finite' || measurement.kind !== 'finite' || !Number.isFinite(reference.magnitude) || !Number.isFinite(measurement.magnitude)) {
      return { ...result, kind: 'unavailable', reason: 'A singular or undefined response cannot be compared.' };
    }
    if (reference.magnitude === 0) return { ...result, kind: 'zero-reference', reason: 'Relative gain is undefined because the reference gain is zero.' };
    // Subtract logarithmic gains so extreme ratios do not overflow before the dB calculation.
    const deltaDb = measurement.db - reference.db;
    return { ...result, kind: 'finite', deltaDb, amplitudeRatio: measurement.magnitude === 0 ? 0 : 10 ** (deltaDb / 20) };
  }
  function frequencyResponse(filter, count = 1025, { minHz = 0, maxHz = filter.sampleRate / 2 } = {}) {
    if (!Number.isInteger(count) || count < 2 || count > 65537) throw new Error('Response sample count must be an integer from 2 to 65537.');
    if (!Number.isFinite(minHz) || !Number.isFinite(maxHz) || minHz < 0 || minHz >= maxHz || maxHz > filter.sampleRate / 2) {
      throw new Error('Response bounds must satisfy 0 ≤ minimum < maximum ≤ Nyquist.');
    }
    const result = [];
    let previous = null, offset = 0;
    for (let i = 0; i < count; i++) {
      const frequency = i === count - 1 ? maxHz : minHz + (maxHz - minHz) * i / (count - 1);
      const point = responseAt(filter, frequency);
      if (point.phase === null) { previous = null; offset = 0; point.unwrappedPhase = null; }
      else {
        if (previous !== null) {
          const delta = point.phase - previous;
          if (delta > Math.PI) offset -= TAU;
          if (delta < -Math.PI) offset += TAU;
        }
        previous = point.phase;
        point.unwrappedPhase = point.phase + offset;
      }
      result.push(point);
    }
    return result;
  }
  function impulseResponse(filter, count = 128) {
    const values = [];
    for (let n = 0; n < count; n++) {
      let value = filter.b[n] || 0;
      for (let k = 1; k < filter.a.length && k <= n; k++) value -= filter.a[k] * values[n - k];
      if (!Number.isFinite(value) || Math.abs(value) > 1e9) return { values, truncated: true };
      values.push(value);
    }
    return { values, truncated: false };
  }
  function validateTaps(taps) {
    if (!Number.isInteger(taps) || taps < 3 || taps > 63 || taps % 2 !== 1) throw new Error('FIR length must be an odd number from 3 to 63 taps.');
  }
  function validFrequency(f, fs, name = 'Frequency') {
    finite(f, name);
    if (f <= 0 || f >= fs / 2) throw new Error(`${name} must lie strictly between 0 and Nyquist (${fs / 2} Hz).`);
  }
  function designFIR({ type, frequency, upperFrequency, taps = 63 }, fs = 8000) {
    sampleRate(fs); validateTaps(taps); validFrequency(frequency, fs);
    if (!['lowpass', 'highpass', 'bandpass', 'notch'].includes(type)) throw new Error('Unknown FIR design type.');
    if (type === 'bandpass' || type === 'notch') {
      validFrequency(upperFrequency, fs, 'Upper frequency');
      if (upperFrequency <= frequency) throw new Error('Upper frequency must exceed lower frequency.');
    }
    const middle = (taps - 1) / 2;
    const low = (fc, k) => k === 0 ? 2 * fc / fs : Math.sin(TAU * fc * k / fs) / (Math.PI * k);
    let b = Array.from({ length: taps }, (_, n) => {
      const k = n - middle;
      let value = low(frequency, k);
      if (type === 'highpass') value = (k === 0 ? 1 : 0) - value;
      if (type === 'bandpass' || type === 'notch') {
        value = low(upperFrequency, k) - value;
        if (type === 'notch') value = (k === 0 ? 1 : 0) - value;
      }
      return value * (0.54 - 0.46 * Math.cos(TAU * n / (taps - 1)));
    });
    const reference = type === 'highpass' ? fs / 2 : type === 'bandpass' ? (frequency + upperFrequency) / 2 : 0;
    const gain = responseAt({ b, a: [1], sampleRate: fs }, reference).magnitude;
    if (!gain || !Number.isFinite(gain)) throw new Error('This FIR design cannot be normalized; use wider bands or more taps.');
    b = b.map(v => v / gain);
    return normalize(b, [1], fs);
  }
  function designIIR({ type, frequency, q = Math.SQRT1_2 }, fs = 8000) {
    sampleRate(fs); validFrequency(frequency, fs); finite(q, 'Q');
    if (q <= 0 || q > 1000) throw new Error('Q must be greater than 0 and at most 1000.');
    const w = TAU * frequency / fs, c = Math.cos(w), alpha = Math.sin(w) / (2 * q);
    const a = [1 + alpha, -2 * c, 1 - alpha];
    let b;
    if (type === 'lowpass') b = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else if (type === 'highpass') b = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    else if (type === 'bandpass') b = [alpha, 0, -alpha];
    else if (type === 'notch') b = [1, -2 * c, 1];
    else throw new Error('Unknown IIR design type.');
    return normalize(b, a, fs);
  }
  function validateTargets(points, fs) {
    sampleRate(fs);
    if (!Array.isArray(points) || points.length < 2 || points.length > 64) throw new Error('Use between 2 and 64 target points.');
    points.forEach((p, i) => {
      finite(p.frequency, 'Target frequency'); finite(p.db, 'Target gain');
      if (p.frequency < 0 || p.frequency > fs / 2) throw new Error('Targets must lie between DC and Nyquist.');
      if (p.db < -120 || p.db > 40) throw new Error('Target gains must be between -120 and +40 dB.');
      if (i > 0 && p.frequency <= points[i - 1].frequency) throw new Error('Target frequencies must be strictly increasing.');
    });
    if (points[0].frequency !== 0 || points[points.length - 1].frequency !== fs / 2) throw new Error(`Targets must start at 0 Hz and end at Nyquist (${fs / 2} Hz).`);
  }
  function targetAmplitude(points, f) {
    if (f <= points[0].frequency) return 10 ** (points[0].db / 20);
    for (let i = 1; i < points.length; i++) {
      if (f <= points[i].frequency) {
        const t = (f - points[i - 1].frequency) / (points[i].frequency - points[i - 1].frequency);
        return (1 - t) * 10 ** (points[i - 1].db / 20) + t * 10 ** (points[i].db / 20);
      }
    }
    return 10 ** (points[points.length - 1].db / 20);
  }
  function designTargets(points, taps = 63, fs = 8000) {
    validateTaps(taps); validateTargets(points, fs);
    const mesh = Array.from({ length: 513 }, (_, k) => targetAmplitude(points, fs * k / 1024));
    const middle = (taps - 1) / 2;
    const b = Array.from({ length: taps }, (_, n) => {
      const k = n - middle;
      let value = mesh[0] + mesh[512] * Math.cos(Math.PI * k);
      for (let j = 1; j < 512; j++) value += 2 * mesh[j] * Math.cos(TAU * j * k / 1024);
      return value / 1024 * (0.54 - 0.46 * Math.cos(TAU * n / (taps - 1)));
    });
    return normalize(b, [1], fs);
  }
  return { MAX_ORDER, C, complex: { add, sub, mul, div, abs }, normalize, parseCoefficients, parseExpression,
    convolve, polynomialFromRoots, polynomialRoots, rootQuality, fromFactors, analyze, analyzeFactors, responseAt,
    compareGain, frequencyResponse, impulseResponse, designFIR, designIIR, designTargets, validateTargets, targetAmplitude };
});
