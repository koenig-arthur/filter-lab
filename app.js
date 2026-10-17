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
/* Offline UI for Filter Lab. All numerical operations live in dsp.js. */
(() => {
  'use strict';
  const D = window.FilterDSP, $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = { blue: '#2264d9', orange: '#d87a2c', green: '#17785b', purple: '#8657c8', ink: '#172a42', muted: '#77879a' };
  const COMPARISON_COLORS = ['#8657c8', '#14848b', '#b94677', '#7b692c', '#6b778c'];
  const defaultAxes = () => ({ x: { auto: true, min: 0, max: 0.5 }, db: { auto: true, min: -60, max: 12 }, linear: { auto: true, min: 0, max: 1.2 } });
  const clone = value => JSON.parse(JSON.stringify(value));
  const format = (n, digits = 5) => {
    if (n === null || n === undefined || Number.isNaN(n)) return 'undefined';
    if (n === -Infinity) return '−∞';
    if (n === Infinity) return '∞';
    if (n === 0) return '0';
    return Number(n.toPrecision(digits)).toString().replace('-', '−');
  };
  const full = n => String(n);
  const coeffText = values => `[${values.map(full).join(', ')}]`;
  const presets = {
    notch: { title: '1000 Hz notch', lesson: 'The zeros sit on the unit circle at the rejected frequency. In Poles & zeros, move the nearby poles closer to the circle: the notch becomes narrower and the impulse rings longer.', make: fs => D.designIIR({ type: 'notch', frequency: fs / 8, q: 10 }, fs) },
    moving: { title: '3-tap moving average', lesson: 'Three impulse samples, then silence: that is FIR. Inspect f = fₛ/3, where the zeros remove the signal completely. The two poles at the origin come from delays, not recursive feedback.', make: fs => D.normalize([1 / 3, 1 / 3, 1 / 3], [1], fs) },
    onepole: { title: 'One-pole low-pass', lesson: 'Move the real pole from 0.8 toward 1. The response concentrates near DC and the impulse decays more slowly. The factor gain stays fixed, so the DC gain also changes.', make: fs => D.normalize([0.2], [1, -0.8], fs) },
    resonator: { title: 'Resonator', lesson: 'A conjugate pole pair emphasizes frequencies near its angle. Drag the pair around the origin to change the resonant frequency; change its radius to alter ringing and sharpness.', make: fs => D.fromFactors({ poles: [D.C(0.94 * Math.cos(Math.PI / 3), 0.94 * Math.sin(Math.PI / 3)), D.C(0.94 * Math.cos(Math.PI / 3), -0.94 * Math.sin(Math.PI / 3))], gain: 0.1 }, fs) },
    delay: { title: 'Two-sample delay', lesson: 'A delay leaves magnitude unchanged but rotates phase. The impulse moves two samples to the right. Increase Extra delay in Poles & zeros and watch the phase slope change.', make: fs => D.normalize([0, 0, 1], [1], fs) },
    unstable: { title: 'A pole outside the circle', lesson: 'This causal recurrence has a growing impulse response. Move the pole inside the unit circle to restore stability. The algebraic curve outside stability is not a steady-state frequency response.', make: fs => D.normalize([0.1], [1, -1.05], fs) },
    identity: { title: 'Identity filter', lesson: 'Start with H(z) = 1. Add a zero at z = 1 to reject DC, or a zero at z = −1 to reject Nyquist. Add poles to see how recursion creates a longer impulse response.', make: fs => D.normalize([1], [1], fs) }
  };
  const state = {
    filter: presets.notch.make(8000), title: '1000 Hz notch', analysis: null, groups: { zeros: [], poles: [] }, factorModel: null,
    tab: 'transfer', scale: 'db', units: 'hz', cursor: 1000, measurement: 1000,
    comparisons: [], nextComparisonId: 1, axes: defaultAxes(), targets: null,
    lesson: presets.notch.lesson, response: [], impulse: [], plane: null,
    targetDraft: [{ frequency: 0, db: 0 }, { frequency: 800, db: 0 }, { frequency: 1200, db: -40 }, { frequency: 4000, db: -40 }]
  };
  let nextRootId = 1, drag = null, dragFrame = null;
  function announce(message) { $('announcement').textContent = message; }
  function fail(error) {
    $('error').textContent = `${error.message || error} The last valid filter is still displayed.`;
    $('error').hidden = false;
    announce(error.message || String(error));
  }
  function guard(action) {
    return (...args) => {
      try { $('error').hidden = true; return action(...args); } catch (error) { fail(error); }
    };
  }
  function readNumber(node, name) {
    if (!node.value.trim() || !Number.isFinite(Number(node.value))) throw new Error(`${name} must be a finite number.`);
    return Number(node.value);
  }
  function groupsFromRoots(roots) {
    const used = new Set(), groups = [];
    roots.forEach((r, i) => {
      if (used.has(i)) return;
      used.add(i);
      if (Math.abs(r.im) < 1e-8 * (1 + Math.abs(r.re))) { groups.push({ re: r.re, im: 0, pair: false }); return; }
      const mate = roots.findIndex((q, j) => !used.has(j) && Math.hypot(q.re - r.re, q.im + r.im) < 1e-5 * (1 + D.complex.abs(r)));
      if (mate < 0) throw new Error('The numerical roots could not be paired reliably. Use the coefficient editor.');
      used.add(mate);
      groups.push({ re: (r.re + roots[mate].re) / 2, im: (Math.abs(r.im) + Math.abs(roots[mate].im)) / 2, pair: true });
    });
    return groups;
  }
  function expandedRoots(groups) {
    return groups.flatMap(g => g.pair ? [D.C(g.re, g.im), D.C(g.re, -g.im)] : [D.C(g.re)]);
  }
  function formatPolynomial(values, html = false) {
    const terms = [];
    values.forEach((value, k) => {
      if (value === 0) return;
      const sign = value < 0 ? '−' : '+';
      const magnitude = Math.abs(value);
      let term = k === 0 || magnitude !== 1 ? format(magnitude, 6) : '';
      if (k) term += html ? `z<sup>−${k}</sup>` : `*z^-${k}`;
      if (term.startsWith('*')) term = term.slice(1);
      terms.push((terms.length ? ` ${sign} ` : value < 0 ? '−' : '') + term);
    });
    return terms.join('') || '0';
  }
  function exactExpression(filter) {
    const polynomial = values => values.map((v, i) => v === 0 ? null : `${v}${i ? `*z^-${i}` : ''}`).filter(v => v !== null).join('+').replace(/\+\-/g, '-') || '0';
    return `(${polynomial(filter.b)})/(${polynomial(filter.a)})`;
  }
  function commit(filter, options = {}) {
    const analysis = options.analysis || D.analyze(filter);
    let groups = options.groups;
    if (!groups) {
      try { groups = { zeros: groupsFromRoots(analysis.zeros), poles: groupsFromRoots(analysis.poles) }; }
      catch (error) { analysis.rootError = error.message; groups = { zeros: [], poles: [] }; }
    }
    if (!options.dragging) cancelDrag(false);
    for (const roots of Object.values(groups)) for (const root of roots) root.id ??= String(nextRootId++);
    state.filter = filter; state.analysis = analysis; state.groups = groups; state.factorModel = options.factorModel || null;
    state.title = options.title || 'Custom filter';
    state.targets = options.targets || null;
    state.cursor = Math.min(state.cursor, filter.sampleRate / 2);
    state.measurement = Math.min(state.measurement, filter.sampleRate / 2);
    if (options.lesson) state.lesson = options.lesson;
    if (!options.preset) $('preset').value = 'custom';
    state.impulse = D.impulseResponse(filter, Number($('impulse-count').value));
    synchronizeInputs(options.dragging);
    renderAll(options.dragging);
  }
  function synchronizeInputs(skipRootLists = false) {
    $('expression').value = exactExpression(state.filter);
    $('b-coeff').value = coeffText(state.filter.b);
    $('a-coeff').value = coeffText(state.filter.a);
    $('sample-rate').value = state.filter.sampleRate;
    $('nyquist').textContent = `Nyquist ${format(state.filter.sampleRate / 2)} Hz`;
    $('preset').querySelector('[value=notch]').textContent = `${format(state.filter.sampleRate / 8)} Hz notch`;
    $('frequency-cursor').max = state.filter.sampleRate / 2;
    $('frequency-cursor').step = state.filter.sampleRate / 8000;
    $('cursor-number').max = state.filter.sampleRate / 2;
    $('compare-frequency').max = state.filter.sampleRate / 2;
    $('root-gain').value = state.factorModel?.gain ?? state.analysis.gain;
    $('root-delay').value = state.factorModel?.delay ?? state.analysis.delay;
    $('zero-count').value = expandedRoots(state.groups.zeros).length;
    $('pole-count').value = expandedRoots(state.groups.poles).length;
    $('origin-note').textContent = state.analysis.zeroFilter ? 'The zero filter has no unique finite zero list.' : `Automatically shown: ${state.analysis.originZeros} origin zero(s), ${state.analysis.originPoles} origin pole(s).`;
    const rootControls = $('panel-roots').querySelectorAll('input, button, select');
    rootControls.forEach(node => {
      if (!node.closest('.root-list')) node.disabled = node.id !== 'reset-filter' && Boolean(state.analysis.rootError);
    });
    if (!skipRootLists) renderRootLists();
  }
  function setTab(name) {
    if (name !== 'roots') cancelDrag();
    state.tab = name;
    for (const tab of document.querySelectorAll('[role=tab]')) {
      const selected = tab.id === `tab-${name}`;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !selected;
    }
  }
  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => setTab(tab.id.slice(4)));
    tab.addEventListener('keydown', event => {
      let index;
      if (event.key === 'ArrowRight') index = (i + 1) % tabs.length;
      if (event.key === 'ArrowLeft') index = (i + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') index = 0;
      if (event.key === 'End') index = tabs.length - 1;
      if (index === undefined) return;
      event.preventDefault(); tabs[index].click(); tabs[index].focus();
    });
  });
  $('formula-form').addEventListener('submit', guard(event => {
    event.preventDefault(); commit(D.parseExpression($('expression').value, state.filter.sampleRate)); announce('Transfer function applied.');
  }));
  $('coeff-form').addEventListener('submit', guard(event => {
    event.preventDefault(); commit(D.normalize(D.parseCoefficients($('b-coeff').value), D.parseCoefficients($('a-coeff').value), state.filter.sampleRate)); announce('Coefficients applied.');
  }));
  for (const button of document.querySelectorAll('[data-expression]')) button.addEventListener('click', guard(() => {
    commit(D.parseExpression(button.dataset.expression, state.filter.sampleRate));
  }));
  $('sample-rate').addEventListener('change', guard(() => {
    const fs = readNumber($('sample-rate'), 'Sampling frequency');
    const filter = D.normalize(state.filter.b, state.filter.a, fs), ratio = fs / state.filter.sampleRate;
    state.targetDraft = readTargets().map(p => ({ ...p, frequency: p.frequency * ratio }));
    const targets = state.targets?.map(p => ({ ...p, frequency: p.frequency * ratio }));
    state.cursor *= ratio;
    state.measurement *= ratio;
    renderTargets();
    if (state.factorModel) commitFactors(clone(state.groups), state.factorModel.gain, state.factorModel.delay, fs, { targets, title: 'Filter at new sample rate' });
    else commit(filter, { targets, title: 'Filter at new sample rate' });
    announce('Sampling frequency changed. Coefficients are unchanged; frequencies and applied targets scale with the sample rate.');
  }));
  function loadPreset(key) {
    const preset = presets[key];
    if (!preset) return;
    const title = key === 'notch' ? `${format(state.filter.sampleRate / 8)} Hz notch` : preset.title;
    state.cursor = key === 'moving' ? state.filter.sampleRate / 3 : key === 'resonator' ? state.filter.sampleRate / 6 : state.filter.sampleRate / 8;
    commit(preset.make(state.filter.sampleRate), { title, lesson: preset.lesson, preset: true });
    $('preset').value = key;
  }
  $('preset').addEventListener('change', guard(() => loadPreset($('preset').value)));
  $('reset-preset').addEventListener('click', guard(() => loadPreset($('preset').value === 'custom' ? 'notch' : $('preset').value)));
  $('reset-filter').addEventListener('click', guard(() => {
    commitFactors({ zeros: [], poles: [] }, 1, 0, state.filter.sampleRate,
      { title: presets.identity.title, lesson: presets.identity.lesson, preset: true });
    $('preset').value = 'identity';
    announce('Filter reset to H(z) = 1. Sampling rate, comparisons and display settings are preserved.');
  }));

  function commitFactors(groups, gain, delay, fs = state.filter.sampleRate, options = {}) {
    const factorModel = { zeros: expandedRoots(groups.zeros), poles: expandedRoots(groups.poles), gain, delay };
    const { filter, analysis } = D.analyzeFactors(factorModel, fs);
    commit(filter, { title: 'Filter from poles & zeros', ...options, analysis, groups, factorModel });
  }
  function mutateRoots(change, gain = state.factorModel?.gain ?? state.analysis.gain, delay = state.factorModel?.delay ?? state.analysis.delay, dragging = false) {
    if (state.analysis.rootError) throw new Error('Root editing is unavailable until a reliable root list can be calculated.');
    const groups = clone(state.groups);
    change(groups);
    commitFactors(groups, gain, delay, state.filter.sampleRate, { dragging });
  }
  for (const kind of ['zero', 'pole']) {
    const collection = kind === 'zero' ? 'zeros' : 'poles';
    $(kind + '-count').addEventListener('change', guard(() => {
      const count = readNumber($(kind + '-count'), 'Root count');
      if (!Number.isInteger(count) || count < 0 || count > 64) throw new Error('Root counts must be integers from 0 to 64.');
      mutateRoots(groups => {
        let roots = groups[collection];
        while (expandedRoots(roots).length > count) roots.pop();
        while (expandedRoots(roots).length < count) roots.push({ re: collection === 'zeros' ? -0.5 : 0.5, im: 0, pair: false });
      });
    }));
    $(`add-${kind}`).addEventListener('click', guard(() => mutateRoots(groups => groups[collection].push({ re: collection === 'zeros' ? -0.5 : 0.5, im: 0, pair: false }))));
    $(`add-${kind}-pair`).addEventListener('click', guard(() => mutateRoots(groups => groups[collection].push({ re: 0.5, im: 0.5, pair: true }))));
  }
  $('root-gain').addEventListener('change', guard(() => mutateRoots(() => {}, readNumber($('root-gain'), 'Gain'))));
  $('root-delay').addEventListener('change', guard(() => mutateRoots(() => {}, state.factorModel?.gain ?? state.analysis.gain, readNumber($('root-delay'), 'Delay'))));
  $('coordinates').addEventListener('change', () => renderRootLists());
  function renderRootLists() {
    const polar = $('coordinates').value === 'polar';
    for (const [collection, singular] of [['zeros', 'zero'], ['poles', 'pole']]) {
      const list = $(singular + '-list'), scrollTop = list.scrollTop; list.replaceChildren();
      if (!state.groups[collection].length) {
        const p = document.createElement('p'); p.className = 'empty-roots'; p.textContent = `No editable ${collection}.`; list.append(p);
      }
      state.groups[collection].forEach((root, index) => {
        const row = document.createElement('div'); row.className = 'root-row'; row.dataset.rootId = root.id;
        const id = document.createElement('span'); id.className = 'root-id'; id.textContent = `${singular[0]}${index + 1}${root.pair ? ' ±' : ''}`; row.append(id);
        const values = polar ? [Math.hypot(root.re, root.im), Math.atan2(root.im, root.re) * 180 / Math.PI] : [root.re, root.im];
        const inputs = values.map((value, field) => {
          const label = document.createElement('label'); label.textContent = polar ? (field === 0 ? 'Radius' : 'Angle °') : (field === 0 ? 'Real' : root.pair ? 'Imaginary ±' : 'Imaginary');
          const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(Number(value.toPrecision(12)));
          input.setAttribute('aria-label', `${singular} ${index + 1} ${polar ? field === 0 ? 'radius' : 'angle' : field === 0 ? 'real' : 'imaginary'}`);
          input.disabled = Boolean(state.analysis.rootError) || (!root.pair && !polar && field === 1);
          label.append(input); row.append(label); return input;
        });
        const update = guard(() => {
          const x = readNumber(inputs[0], 'Coordinate'), y = readNumber(inputs[1], 'Coordinate');
          let re = x, im = root.pair ? Math.abs(y) : 0;
          if (polar) {
            if (x < 0) throw new Error('Radius must be nonnegative.');
            if (!root.pair && Math.abs(Math.sin(y * Math.PI / 180)) > 1e-8) throw new Error('A real root needs an angle of 0° or 180°. Add a pair for complex roots.');
            re = x * Math.cos(y * Math.PI / 180); im = root.pair ? Math.abs(x * Math.sin(y * Math.PI / 180)) : 0;
          }
          mutateRoots(groups => {
            const current = groups[collection].find(g => g.id === root.id);
            if (current) Object.assign(current, { re, im });
          });
        });
        inputs.forEach(input => input.addEventListener('change', update));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${singular} ${index + 1}${root.pair ? ' pair' : ''}`);
        remove.disabled = Boolean(state.analysis.rootError);
        remove.addEventListener('click', guard(() => mutateRoots(groups => { groups[collection] = groups[collection].filter(g => g.id !== root.id); })));
        row.append(remove);
        if (root.re === 0 && root.im === 0) {
          const note = document.createElement('small'); note.className = 'inactive-factor'; note.textContent = 'Inactive at origin: factor equals 1'; row.append(note);
        }
        list.append(row);
      });
      list.scrollTop = scrollTop;
    }
  }

  function readTargets() {
    return [...$('target-rows').children].map(row => ({ frequency: readNumber(row.querySelector('[data-field=frequency]'), 'Target frequency'), db: readNumber(row.querySelector('[data-field=db]'), 'Target gain') }));
  }
  function renderTargets() {
    $('target-rows').replaceChildren();
    state.targetDraft.forEach((point, index) => {
      const row = document.createElement('div'); row.className = 'target-row';
      for (const field of ['frequency', 'db']) {
        const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = point[field]; input.dataset.field = field;
        input.setAttribute('aria-label', `Target ${index + 1} ${field === 'db' ? 'gain in dB' : 'frequency in Hz'}`); row.append(input);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove target ${index + 1}`);
      remove.disabled = index === 0 || index === state.targetDraft.length - 1;
      remove.addEventListener('click', guard(() => { state.targetDraft = readTargets(); state.targetDraft.splice(index, 1); renderTargets(); }));
      row.append(remove); $('target-rows').append(row);
    });
  }
  $('add-target').addEventListener('click', guard(() => {
    const points = readTargets();
    if (points.length >= 64) throw new Error('Maximum 64 target points.');
    const a = points[points.length - 2], b = points[points.length - 1];
    points.splice(points.length - 1, 0, { frequency: (a.frequency + b.frequency) / 2, db: (a.db + b.db) / 2 });
    state.targetDraft = points; renderTargets();
  }));
  function updateDesignControls() {
    const custom = $('design-method').value === 'targets', fir = $('family').value === 'fir', type = $('filter-type').value;
    const band = type === 'bandpass' || type === 'notch';
    $('standard-design').hidden = custom; $('target-design').hidden = !custom;
    $('q-field').hidden = fir; $('upper-field').hidden = !fir || !band;
    $('taps-field').hidden = !custom && !fir;
    $('frequency-label').textContent = fir && band ? 'Lower edge (Hz)' : band ? 'Center frequency (Hz)' : 'Cutoff frequency (Hz)';
    $('design-explanation').textContent = custom ? 'Targets are interpolated in linear amplitude. More taps resolve narrower transitions. The dashed orange curve is the target; blue is the achieved response. No exact-fit guarantee.' : fir ? 'Hamming window, odd length, linear phase. Cutoff edges are approximately −6 dB (half amplitude) for well-separated bands. Band-stop uses a lower and an upper edge.' : 'Second-order biquad. Low/high-pass cutoff is −3 dB when Q = 0.7071. For band-pass/notch, Q controls bandwidth: higher Q gives a narrower response.';
  }
  ['design-method', 'family'].forEach(id => $(id).addEventListener('change', updateDesignControls));
  $('filter-type').addEventListener('change', () => {
    $('design-q').value = ['lowpass', 'highpass'].includes($('filter-type').value) ? Math.SQRT1_2 : 10;
    updateDesignControls();
  });
  $('design-form').addEventListener('submit', guard(event => {
    event.preventDefault();
    const fs = state.filter.sampleRate;
    if ($('design-method').value === 'targets') {
      const points = readTargets(), taps = readNumber($('design-taps'), 'FIR taps');
      const filter = D.designTargets(points, taps, fs);
      state.targetDraft = points;
      commit(filter, { targets: points, title: `${taps}-tap custom FIR`, lesson: 'Compare the orange target curve with the blue result. Increase the tap count to sharpen transitions; the impulse gets longer and the linear-phase delay increases.' });
    } else {
      const type = $('filter-type').value, frequency = readNumber($('design-frequency'), 'Frequency'), fir = $('family').value === 'fir';
      const parameters = { type, frequency };
      if (fir) {
        parameters.taps = readNumber($('design-taps'), 'FIR taps');
        if (['bandpass', 'notch'].includes(type)) parameters.upperFrequency = readNumber($('design-upper'), 'Upper frequency');
      } else parameters.q = readNumber($('design-q'), 'Q');
      const filter = fir ? D.designFIR(parameters, fs) : D.designIIR(parameters, fs);
      const names = { lowpass: 'low-pass', highpass: 'high-pass', bandpass: 'band-pass', notch: fir ? 'band-stop' : 'notch' };
      commit(filter, { title: `${fir ? 'FIR' : 'IIR'} ${names[type]} · ${format(frequency)} Hz`, lesson: fir ? 'The symmetric impulse gives linear phase. Save this response as a comparison, then design an IIR filter at a similar cutoff to compare shape, order, and impulse length.' : 'These poles create a recursive response. Save a comparison, then change Q: sharper frequency selectivity generally comes with longer ringing in time.' });
    }
    announce('Filter designed. All plots and coefficients updated.');
  }));

  function svgElement(parent, name, attrs = {}, text) {
    const element = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text !== undefined) element.textContent = text;
    parent.append(element); return element;
  }
  const svgText = (svg, x, y, text, attrs = {}) => svgElement(svg, 'text', { x, y, class: 'chart-label', 'text-anchor': 'middle', ...attrs }, text);
  const svgLine = (svg, x1, y1, x2, y2, attrs = {}) => svgElement(svg, 'line', { x1, y1, x2, y2, ...attrs });
  function makeChart(id, yMin, yMax, yLabel, xMax, xLabel, xMin = 0) {
    const svg = $(id); svg.replaceChildren();
    const box = svg.viewBox.baseVal, width = box.width, height = box.height;
    const area = { l: 59, r: width - 20, t: 30, b: height - 43, width, height };
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) { yMin = -1; yMax = 1; }
    const x = value => area.l + (value - xMin) / (xMax - xMin) * (area.r - area.l);
    // Finite points keep their true coordinates; SVG clipping handles manual bounds.
    // Only a true zero (-Infinity dB) is intentionally drawn at the display floor.
    const y = value => area.b - ((value === -Infinity ? yMin : value) - yMin) / (yMax - yMin) * (area.b - area.t);
    svg.dataset.xMin = xMin; svg.dataset.xMax = xMax; svg.dataset.yMin = yMin; svg.dataset.yMax = yMax;
    for (let i = 0; i <= 4; i++) {
      const value = yMin + (yMax - yMin) * i / 4, yy = y(value);
      svgLine(svg, area.l, yy, area.r, yy, { class: 'chart-grid' });
      svgText(svg, area.l - 10, yy + 3, format(value, 3), { 'text-anchor': 'end' });
    }
    for (let i = 0; i <= 4; i++) {
      const tick = xMin + (xMax - xMin) * i / 4;
      const value = xLabel === 'n (samples)' ? Math.round(tick) : tick, xx = x(value);
      svgLine(svg, xx, area.t, xx, area.b, { class: 'chart-grid' });
      svgText(svg, xx, area.b + 18, format(value, 3));
    }
    svgText(svg, area.l, 16, yLabel, { 'text-anchor': 'start', class: 'chart-title' });
    svgText(svg, area.r, height - 5, xLabel, { 'text-anchor': 'end', class: 'chart-title' });
    const defs = svgElement(svg, 'defs');
    const clip = svgElement(defs, 'clipPath', { id: `${id}-clip` });
    svgElement(clip, 'rect', { x: area.l, y: area.t, width: area.r - area.l, height: area.b - area.t });
    const plot = svgElement(svg, 'g', { 'clip-path': `url(#${id}-clip)`, class: 'chart-data' });
    return { svg, plot, area, x, y, xMin, xMax, yMin, yMax };
  }
  function drawPath(chart, points, className) {
    let path = '', connected = false;
    for (const point of points) {
      if (point.y === null || Number.isNaN(point.y) || point.y === Infinity || point.x < chart.xMin || point.x > chart.xMax) { connected = false; continue; }
      path += `${connected ? 'L' : 'M'}${chart.x(point.x).toFixed(3)},${chart.y(point.y).toFixed(3)} `; connected = true;
    }
    return svgElement(chart.plot, 'path', { d: path, class: className });
  }
  function visibleCurves() {
    return [{ id: 'live', title: `Live · ${state.title}`, color: COLORS.blue, filter: state.filter }, ...state.comparisons.filter(curve => curve.visible)];
  }
  function mapFrequency(filter, hz) {
    return state.units === 'hz' ? hz : hz / state.filter.sampleRate * filter.sampleRate;
  }
  function frequencyBounds() {
    const range = state.axes.x;
    return { minHz: (range.auto ? 0 : range.min) * state.filter.sampleRate, maxHz: (range.auto ? 0.5 : range.max) * state.filter.sampleRate };
  }
  function outsideView(hz) {
    const { minHz, maxHz } = frequencyBounds();
    return hz < minHz || hz > maxHz;
  }
  function responseForCurve(curve) {
    if (curve.id === 'live') return state.response;
    return state.response.map(point => {
      const frequency = mapFrequency(curve.filter, point.frequency);
      if (frequency < 0 || frequency > curve.filter.sampleRate / 2) return { frequency: point.frequency, kind: 'unavailable', magnitude: null, db: null };
      return { ...D.responseAt(curve.filter, frequency), frequency: point.frequency };
    });
  }
  function renderFrequencyPlots() {
    const fs = state.filter.sampleRate, bounds = frequencyBounds();
    state.response = D.frequencyResponse(state.filter, 1025, bounds);
    const axisX = f => state.units === 'hz' ? f : f / fs;
    const xMin = axisX(bounds.minHz), xMax = axisX(bounds.maxHz);
    const axisLabel = state.units === 'hz' ? 'Frequency (Hz)' : 'Normalized frequency f / fₛ';
    const mag = p => state.scale === 'db' ? p.db : p.magnitude;
    const curves = visibleCurves().map(curve => ({ ...curve, data: responseForCurve(curve) }));
    const targetPoints = state.targets ? state.response.map(p => {
      const amplitude = D.targetAmplitude(state.targets, p.frequency);
      return { x: axisX(p.frequency), y: state.scale === 'db' ? 20 * Math.log10(amplitude) : amplitude };
    }) : [];
    const all = curves.flatMap(curve => curve.data.map(mag)).concat(targetPoints.map(p => p.y)).filter(Number.isFinite);
    const peak = Math.max(state.scale === 'db' ? 0 : 1, ...all);
    const autoBottom = state.scale === 'db' ? Math.min(-60, Math.floor(Math.min(0, ...all) / 12) * 12) : 0;
    const autoTop = state.scale === 'db' ? Math.max(12, Math.ceil((peak + 2) / 12) * 12) : peak * 1.12;
    const axis = state.axes[state.scale];
    const bottom = axis.auto ? autoBottom : axis.min, top = axis.auto ? autoTop : axis.max;
    const chart = makeChart('magnitude', bottom, top, state.scale === 'db' ? 'Gain (dB)' : '|H| (linear)', xMax, axisLabel, xMin);
    if (targetPoints.length) drawPath(chart, targetPoints, 'target-path');
    // Put the live response above the saved curves.
    for (const curve of curves.slice().reverse()) {
      const path = drawPath(chart, curve.data.map(p => ({ x: axisX(p.frequency), y: mag(p) })), curve.id === 'live' ? 'response-path' : 'comparison-path');
      path.style.stroke = curve.color; path.dataset.curveId = curve.id;
    }
    const missing = state.response.filter(p => p.kind !== 'finite').length;
    if (missing) svgText(chart.svg, chart.area.l + 5, chart.area.t + 15, 'Gaps: singular / 0÷0 values', { 'text-anchor': 'start', fill: COLORS.orange });
    state.magnitudeChart = chart;
    chart.markers = svgElement(chart.plot, 'g', { class: 'measurement-markers' });
    const phases = state.response.map(p => p.unwrappedPhase).filter(v => v !== null && Number.isFinite(v));
    const low = Math.min(0, ...phases), high = Math.max(0, ...phases), span = Math.max(1, high - low);
    const phaseChart = makeChart('phase', low - span * 0.08, high + span * 0.08, 'Phase (rad)', xMax, axisLabel, xMin);
    drawPath(phaseChart, state.response.map(p => ({ x: axisX(p.frequency), y: p.unwrappedPhase })), 'response-path');
    phaseChart.markers = svgElement(phaseChart.plot, 'g', { class: 'measurement-markers' });
    state.phaseChart = phaseChart;
    $('comparison-note').textContent = `Hover to compare · Click to set reference.${state.targets ? ' Orange dashed: target.' : ''}${state.scale === 'db' ? ' Exact zeros sit at the dB floor.' : ''}`;
    synchronizeAxes(); renderMeasurementMarkers(); renderMeasurements();
  }
  function synchronizeAxes() {
    const xAxis = state.axes.x, yAxis = state.axes[state.scale], chart = state.magnitudeChart;
    const factor = state.units === 'hz' ? state.filter.sampleRate : 1;
    $('axis-x-auto').checked = xAxis.auto; $('axis-y-auto').checked = yAxis.auto;
    $('axis-x-min').value = (xAxis.auto ? 0 : xAxis.min) * factor;
    $('axis-x-max').value = (xAxis.auto ? 0.5 : xAxis.max) * factor;
    $('axis-y-min').value = yAxis.auto ? Number(chart.yMin.toPrecision(10)) : yAxis.min;
    $('axis-y-max').value = yAxis.auto ? Number(chart.yMax.toPrecision(10)) : yAxis.max;
    $('axis-frequency-unit').textContent = state.units === 'hz' ? '(Hz)' : '(f / fₛ)';
    $('axis-magnitude-unit').textContent = state.scale === 'db' ? '(dB)' : '(linear)';
    $('axis-nyquist-note').textContent = `Nyquist: ${format(state.filter.sampleRate / 2)} Hz = 0.5 f/fₛ. Increase the sampling rate to design for higher frequencies.`;
    $('axes-summary').textContent = `${xAxis.auto ? 'Full frequency range' : 'Custom frequency range'} · ${yAxis.auto ? 'Auto magnitude' : 'Custom magnitude'}`;
    enableAxisInputs();
  }
  function enableAxisInputs() {
    for (const axis of ['x', 'y']) for (const bound of ['min', 'max']) $(`axis-${axis}-${bound}`).disabled = $(`axis-${axis}-auto`).checked;
  }
  function renderMeasurementMarkers() {
    for (const chart of [state.magnitudeChart, state.phaseChart]) {
      if (!chart) continue;
      chart.markers.replaceChildren();
      for (const [frequency, className] of [[state.cursor, 'frequency-marker'], [state.measurement, 'probe-marker']]) {
        if (outsideView(frequency)) continue;
        const value = state.units === 'hz' ? frequency : frequency / state.filter.sampleRate;
        svgLine(chart.markers, chart.x(value), chart.area.t, chart.x(value), chart.area.b, { class: className });
      }
    }
    const chart = state.magnitudeChart;
    if (!chart) return;
    for (const [frequency, isReference] of [[state.cursor, true], [state.measurement, false]]) {
      if (outsideView(frequency)) continue;
      const value = state.units === 'hz' ? frequency : frequency / state.filter.sampleRate;
      for (const curve of visibleCurves()) {
        if (isReference && curve.id !== 'live') continue;
        const mapped = mapFrequency(curve.filter, frequency);
        if (mapped < 0 || mapped > curve.filter.sampleRate / 2) continue;
        const response = D.responseAt(curve.filter, mapped), gain = state.scale === 'db' ? response.db : response.magnitude;
        if (response.kind !== 'finite' || gain === Infinity || Number.isNaN(gain)) continue;
        svgElement(chart.markers, 'circle', { cx: chart.x(value), cy: chart.y(gain), r: 4,
          fill: isReference ? COLORS.green : curve.color, stroke: 'white', 'stroke-width': 1.5 });
      }
    }
  }
  function displayDb(db) { return format(db !== null && Math.abs(db) < 1e-10 ? 0 : db, 5); }
  function gainText(response) {
    if (!response) return 'Unavailable';
    if (response.kind === 'singular') return 'Singular';
    if (response.kind !== 'finite' || Number.isNaN(response.db)) return 'Undefined';
    return displayDb(response.db);
  }
  function renderMeasurements() {
    $('compare-frequency').value = Number(state.measurement.toPrecision(12));
    $('measurement-reference').textContent = `Reference: ${format(state.cursor, 7)} Hz${outsideView(state.cursor) ? ' · outside view' : ''}`;
    $('measurement-probe').textContent = `Compare at: ${format(state.measurement, 7)} Hz${outsideView(state.measurement) ? ' · outside view' : ''}`;
    $('measurement-mapping').textContent = state.units === 'hz' ? 'Each curve is measured at the same frequencies in Hz, within its own Nyquist range.' : 'Each curve is measured at the same f/fₛ. Its corresponding frequencies in Hz are listed below the name.';
    const tbody = $('measurement-rows'); tbody.replaceChildren();
    for (const curve of visibleCurves()) {
      const referenceHz = mapFrequency(curve.filter, state.cursor), measurementHz = mapFrequency(curve.filter, state.measurement);
      const result = D.compareGain(curve.filter, referenceHz, measurementHz);
      const row = document.createElement('tr'); row.dataset.curveId = curve.id; row.dataset.result = result.kind;
      const name = document.createElement('th'); name.scope = 'row'; name.className = 'measurement-name';
      const swatch = document.createElement('span'); swatch.className = 'curve-swatch'; swatch.style.background = curve.color;
      const title = document.createElement('span'); title.textContent = curve.title;
      const frequencies = document.createElement('small');
      frequencies.textContent = `fₛ ${format(curve.filter.sampleRate, 6)} Hz · ${format(referenceHz, 7)} → ${format(measurementHz, 7)} Hz`;
      name.append(swatch, title, frequencies); row.append(name);
      function cell(field, text) {
        const td = document.createElement('td'); td.dataset.field = field; td.textContent = text; row.append(td); return td;
      }
      cell('reference', gainText(result.reference)); cell('measurement', gainText(result.measurement));
      const deltaCell = cell('delta', result.kind === 'finite' ? displayDb(result.deltaDb) : result.kind === 'unavailable' ? 'Unavailable' : 'Undefined');
      const explanation = document.createElement('small');
      explanation.textContent = result.kind !== 'finite' ? result.reason : result.deltaDb === -Infinity ? 'Complete rejection relative to reference' : Math.abs(result.deltaDb) < 1e-10 ? 'No change' : `${displayDb(Math.abs(result.deltaDb))} dB ${result.deltaDb < 0 ? 'more' : 'less'} attenuation`;
      deltaCell.append(explanation);
      cell('ratio', result.kind === 'finite' ? `${format(result.amplitudeRatio, 5)}×` : '—');
      tbody.append(row);
    }
  }
  function renderComparisonList() {
    $('compare').textContent = `+ Save comparison (${state.comparisons.length}/5)`;
    $('saved-comparisons').hidden = !state.comparisons.length;
    $('comparison-count').textContent = `${state.comparisons.length}/5`;
    const list = $('comparison-list'); list.replaceChildren();
    for (const curve of state.comparisons) {
      const row = document.createElement('div'); row.className = 'saved-curve'; row.dataset.curveId = curve.id;
      const visibility = document.createElement('input'); visibility.type = 'checkbox'; visibility.checked = curve.visible;
      visibility.setAttribute('aria-label', `Show ${curve.title}`); visibility.className = 'curve-visibility';
      visibility.addEventListener('change', () => { curve.visible = visibility.checked; renderFrequencyPlots(); });
      const swatch = document.createElement('span'); swatch.className = 'curve-swatch'; swatch.style.background = curve.color;
      const name = document.createElement('input'); name.type = 'text'; name.value = curve.title; name.className = 'curve-name';
      name.setAttribute('aria-label', `Comparison ${curve.id} name`);
      name.addEventListener('change', guard(() => {
        if (!name.value.trim()) { name.value = curve.title; throw new Error('A saved curve needs a name.'); }
        curve.title = name.value.trim(); name.value = curve.title;
        visibility.setAttribute('aria-label', `Show ${curve.title}`); remove.setAttribute('aria-label', `Remove ${curve.title}`);
        renderMeasurements();
      }));
      const rate = document.createElement('span'); rate.className = 'saved-rate'; rate.textContent = `${format(curve.filter.sampleRate)} Hz`;
      const remove = document.createElement('button'); remove.className = 'remove-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${curve.title}`);
      remove.addEventListener('click', () => {
        state.comparisons = state.comparisons.filter(item => item.id !== curve.id);
        $('error').hidden = true;
        renderComparisonList(); renderFrequencyPlots(); announce('Comparison removed.');
      });
      row.append(visibility, swatch, name, rate, remove); list.append(row);
    }
  }
  function renderImpulse() {
    const { values, truncated } = state.impulse;
    const min = Math.min(0, ...values), max = Math.max(0, ...values), span = Math.max(1e-10, max - min);
    const chart = makeChart('impulse', min - span * 0.1, max + span * 0.15, 'h[n]', Math.max(1, Number($('impulse-count').value) - 1), 'n (samples)');
    svgLine(chart.svg, chart.area.l, chart.y(0), chart.area.r, chart.y(0), { class: 'chart-axis' });
    values.forEach((value, n) => {
      svgLine(chart.svg, chart.x(n), chart.y(0), chart.x(n), chart.y(value), { stroke: COLORS.blue, 'stroke-width': 1.3 });
      svgElement(chart.svg, 'circle', { cx: chart.x(n), cy: chart.y(value), r: values.length > 128 ? 1 : 1.8, fill: COLORS.blue });
    });
    $('impulse-note').textContent = truncated ? `Simulation stopped after ${values.length} samples before exceeding |h[n]| = 10⁹. This recurrence is growing.` : state.analysis.fir ? `FIR: ${state.filter.b.length} coefficient(s); the impulse is zero after sample ${state.filter.b.length - 1}.` : `First ${values.length} samples, starting from zero initial conditions. An IIR tail may extend beyond this view.`;
  }
  function renderPlane() {
    const svg = $('z-plane'); svg.replaceChildren();
    const pointRadius = Math.max(1, ...['zeros', 'poles'].flatMap(kind => state.groups[kind].map(g => Math.hypot(g.re, g.im))));
    const extent = drag ? drag.plane.extent : Math.max(1.35, pointRadius * 1.18);
    const cx = 200, cy = 174, scale = 133 / extent;
    state.plane = { cx, cy, scale, extent };
    const x = re => cx + re * scale, y = im => cy - im * scale;
    const left = 38, right = 363, top = 24, bottom = 320;
    svgElement(svg, 'circle', { cx, cy, r: scale, fill: '#f1f6ff', stroke: '#b8c9e2', 'stroke-width': 1.3, 'stroke-dasharray': '4 4' });
    svgLine(svg, left, cy, right, cy, { class: 'chart-axis' }); svgLine(svg, cx, top, cx, bottom, { class: 'chart-axis' });
    for (const tick of [-1, 1]) {
      svgLine(svg, x(tick), cy - 4, x(tick), cy + 4, { stroke: '#9caec5' });
      svgText(svg, x(tick), cy + 20, String(tick));
      svgText(svg, cx - 12, y(tick) + 3, `${tick}j`, { 'text-anchor': 'end' });
    }
    svgText(svg, right, cy - 10, 'Re', { 'text-anchor': 'end' }); svgText(svg, cx + 14, top + 8, 'Im');
    const angle = 2 * Math.PI * state.cursor / state.filter.sampleRate;
    const fx = x(Math.cos(angle)), fy = y(Math.sin(angle));
    svgLine(svg, cx, cy, fx, fy, { stroke: COLORS.green, 'stroke-width': 1, 'stroke-dasharray': '3 4', opacity: 0.6 });
    svgElement(svg, 'circle', { cx: fx, cy: fy, r: 4.5, fill: COLORS.green, stroke: 'white', 'stroke-width': 1.5 });
    svgText(svg, 25, 348, `ω = ${format(angle / Math.PI, 3)}π rad/sample`, { 'text-anchor': 'start', fill: COLORS.green });
    const originZ = state.analysis.originZeros, originP = state.analysis.originPoles;
    if (originZ || originP) {
      if (originZ) svgElement(svg, 'circle', { cx, cy, r: 6, fill: 'white', stroke: COLORS.orange, 'stroke-width': 1.8, 'stroke-dasharray': '2 2' });
      if (originP) {
        svgLine(svg, cx - 5, cy - 5, cx + 5, cy + 5, { stroke: COLORS.blue, 'stroke-width': 1.6 });
        svgLine(svg, cx - 5, cy + 5, cx + 5, cy - 5, { stroke: COLORS.blue, 'stroke-width': 1.6 });
      }
      svgText(svg, cx + 10, cy - 13, `×${originZ || originP} delay/balance`, { 'text-anchor': 'start', 'font-size': 9 });
    }
    if (!state.analysis.rootError) {
      for (const collection of ['zeros', 'poles']) {
        if (state.analysis.zeroFilter && !state.factorModel && collection === 'zeros') continue;
        const locations = new Map();
        state.groups[collection].forEach((g, index) => {
          (g.pair ? [1, -1] : [1]).forEach(sign => {
            const key = `${g.re.toFixed(6)},${(g.im * sign).toFixed(6)}`;
            if (locations.has(key)) { locations.get(key).count++; return; }
            locations.set(key, { g, index, sign, count: 1 });
          });
        });
        for (const { g, index, sign, count } of locations.values()) {
          const inactive = g.re === 0 && g.im === 0;
          const px = x(g.re), py = y(g.im * sign), zero = collection === 'zeros', color = inactive ? COLORS.muted : zero ? COLORS.orange : COLORS.blue;
          const marker = svgElement(svg, 'g', { class: 'root-hit', tabindex: 0, role: 'button', 'aria-label': `${zero ? 'Zero' : 'Pole'} ${index + 1}, real ${format(g.re)}, imaginary ${format(g.im * sign)}${count > 1 ? `, multiplicity ${count}` : ''}${inactive ? '. Inactive at origin: factor equals 1' : ''}. Drag or use arrow keys.`, 'data-kind': collection, 'data-root-id': g.id, 'data-index': index, 'data-sign': sign, 'data-inactive': String(inactive) });
          svgElement(marker, 'title', {}, `${zero ? 'Zero' : 'Pole'}: ${format(g.re)} ${g.im * sign < 0 ? '−' : '+'} ${format(Math.abs(g.im))}j · radius ${format(Math.hypot(g.re, g.im))}${count > 1 ? ` · multiplicity ${count}` : ''}`);
          svgElement(marker, 'circle', { cx: px, cy: py, r: 13, fill: 'transparent', stroke: 'transparent', class: 'root-focus' });
          if (inactive) svgElement(marker, 'path', { d: `M${px},${py - 9} l9,9 l-9,9 l-9,-9 Z`, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-dasharray': '2 2', 'pointer-events': 'none' });
          else if (zero) svgElement(marker, 'circle', { cx: px, cy: py, r: 6, fill: 'white', stroke: color, 'stroke-width': 2.2 });
          else {
            svgLine(marker, px - 5, py - 5, px + 5, py + 5, { stroke: color, 'stroke-width': 2.2 });
            svgLine(marker, px - 5, py + 5, px + 5, py - 5, { stroke: color, 'stroke-width': 2.2 });
          }
          if (count > 1) svgText(marker, px + 9, py - 9, `×${count}`, { 'text-anchor': 'start', fill: color });
        }
      }
    }
    const inactiveCount = ['zeros', 'poles'].reduce((n, kind) => n + expandedRoots(state.groups[kind]).filter(r => r.re === 0 && r.im === 0).length, 0);
    $('plane-note').textContent = (state.analysis.rootError ? 'Root locations unavailable: see the numerical warning above. Reset filter remains available.' : state.analysis.zeroFilter ? `H(z) = 0: no finite zero list exists.${state.factorModel ? ' Placed factors are retained for editing; restore gain to activate them.' : ''}` : `${state.analysis.zeros.length + originZ} effective zero(s) · ${state.analysis.poles.length + originP} effective pole(s), including origin markers. ${state.factorModel ? 'Positions from placed factors.' : 'Positions recovered from coefficients.'} Drag or use the numeric editor.`) + (inactiveCount ? ` ${inactiveCount} inactive origin factor(s), shown as gray diamonds.` : '');
  }
  function renderMath() {
    const { filter, analysis } = state;
    // Only computed numbers and fixed markup enter this HTML fragment.
    $('formula-display').innerHTML = `<span class="formula-label">H(z) =</span><span class="fraction" tabindex="0" aria-label="Expanded transfer function; scroll for long filters"><span class="numerator">${formatPolynomial(filter.b, true)}</span><span class="denominator">${formatPolynomial(filter.a, true)}</span></span>`;
    const terms = [];
    function term(value, symbol, k) {
      if (value === 0) return;
      const sign = value < 0 ? '−' : '+';
      terms.push(`${terms.length ? ` ${sign} ` : value < 0 ? '−' : ''}${Math.abs(value) === 1 ? '' : format(Math.abs(value), 5) + '·'}${symbol}[n${k ? '−' + k : ''}]`);
    }
    filter.b.forEach((v, k) => term(v, 'x', k));
    filter.a.slice(1).forEach((v, k) => term(-v, 'y', k + 1));
    $('difference-equation').textContent = `y[n] = ${terms.join('') || '0'}`;
    $('coefficient-output').textContent = `b = ${coeffText(filter.b)}\na = ${coeffText(filter.a)}\nfs = ${filter.sampleRate} Hz`;
    let explanation = analysis.fir ? 'FIR uses only current and past inputs. Its impulse ends after finitely many samples. Origin poles represent delays, not recursive feedback.' : 'IIR feeds past outputs back into the recurrence. Its impulse usually continues indefinitely. For a causal recurrence, all denominator poles must lie strictly inside the unit circle for asymptotic stability.';
    if (analysis.delay) explanation += ` The numerator includes ${analysis.delay} sample(s) of explicit delay.`;
    if (analysis.cancellations.length) explanation += ' Nearby pole/zero pairs are flagged, but are not cancelled automatically. Ideal cancellation can hide an unstable internal mode; numerical proximity alone does not prove cancellation.';
    if (analysis.zeroFilter) explanation += ' The zero numerator gives zero output from zero initial conditions; denominator modes still matter for a recursive realization.';
    $('filter-explanation').textContent = explanation;
  }
  function renderCursor() {
    const response = D.responseAt(state.filter, state.cursor);
    $('frequency-cursor').value = state.cursor;
    $('cursor-number').value = Number(state.cursor.toPrecision(10));
    $('frequency-cursor').setAttribute('aria-valuetext', `${format(state.cursor)} Hz`);
    const displayedDb = response.db !== null && Math.abs(response.db) < 1e-10 ? 0 : response.db;
    $('cursor-gain').textContent = response.kind === 'singular' ? 'Singular (pole)' : response.kind === 'indeterminate' ? 'Undefined (0/0)' : state.scale === 'db' ? `${format(displayedDb, 4)} dB` : `${format(response.magnitude, 4)} ×`;
    $('cursor-phase').textContent = response.phase === null ? 'Phase undefined' : `${format(response.phase * 180 / Math.PI, 4)}° · wrapped phase`;
  }
  function renderTargetResults() {
    $('target-results').hidden = !state.targets;
    $('target-results-body').replaceChildren();
    if (!state.targets) return;
    for (const point of state.targets) {
      const row = document.createElement('tr');
      [format(point.frequency), format(point.db), format(D.responseAt(state.filter, point.frequency).db, 5)].forEach(value => {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      });
      $('target-results-body').append(row);
    }
  }
  function renderAll(dragging = false) {
    const a = state.analysis;
    $('filter-title').textContent = state.title;
    $('filter-kind').textContent = `${a.fir ? 'FIR' : 'IIR recurrence'} · order ${a.order}`;
    $('stability').className = `badge ${a.stability}`;
    $('stability').textContent = ({ stable: 'Stable', unstable: 'Unstable recurrence', boundary: 'Unit-circle boundary', unknown: 'Stability uncertain' })[a.stability];
    const warnings = [];
    if (a.rootError) warnings.push(a.rootError);
    if (a.stability === 'unstable' || a.stability === 'boundary') warnings.push('The denominator is not strictly stable. The magnitude and phase curves are algebraic unit-circle evaluations, not a stable steady-state frequency response. Exact cancellations would require separate analysis.');
    if (a.cancellations.length) warnings.push(`${a.cancellations.length} possible pole–zero cancellation(s). Near matches are shown without simplification; denominator stability is reported conservatively.`);
    $('analysis-warning').hidden = !warnings.length; $('analysis-warning').textContent = warnings.join(' ');
    $('experiment-text').textContent = state.lesson;
    if (!dragging) renderComparisonList();
    renderPlane(); renderFrequencyPlots(); renderImpulse(); renderCursor(); renderMath(); renderTargetResults();
  }
  function updateCursor(value) {
    if (!Number.isFinite(value) || value < 0 || value > state.filter.sampleRate / 2) throw new Error('Cursor frequency must be between DC and Nyquist.');
    state.cursor = value;
    renderCursor(); renderPlane(); renderMeasurementMarkers(); renderMeasurements();
  }
  $('frequency-cursor').addEventListener('input', guard(() => updateCursor(Number($('frequency-cursor').value))));
  $('cursor-number').addEventListener('change', guard(() => updateCursor(readNumber($('cursor-number'), 'Cursor frequency'))));
  function chartFrequency(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform($('magnitude').getScreenCTM().inverse());
    const a = state.magnitudeChart.area;
    if (point.x < a.l || point.x > a.r || point.y < a.t || point.y > a.b) return null;
    const ratio = (point.x - a.l) / (a.r - a.l), { minHz, maxHz } = frequencyBounds();
    return minHz + ratio * (maxHz - minHz);
  }
  $('magnitude').addEventListener('pointerdown', guard(event => {
    const frequency = chartFrequency(event);
    if (frequency !== null) updateCursor(frequency);
  }));
  $('magnitude').addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const frequency = chartFrequency(event);
    if (frequency === null) return;
    state.measurement = frequency; renderMeasurementMarkers(); renderMeasurements();
  });
  $('compare-frequency').addEventListener('change', guard(() => {
    const frequency = readNumber($('compare-frequency'), 'Measurement frequency');
    if (frequency < 0 || frequency > state.filter.sampleRate / 2) throw new Error('Measurement frequency must be between DC and Nyquist.');
    state.measurement = frequency; renderMeasurementMarkers(); renderMeasurements();
    announce(`Comparing at ${format(frequency)} Hz relative to ${format(state.cursor)} Hz.`);
  }));
  for (const value of ['db', 'linear']) $(`scale-${value}`).addEventListener('click', () => {
    state.scale = value;
    $('scale-db').setAttribute('aria-pressed', String(value === 'db')); $('scale-linear').setAttribute('aria-pressed', String(value === 'linear'));
    renderFrequencyPlots(); renderCursor();
  });
  $('frequency-units').addEventListener('change', () => { state.units = $('frequency-units').value; renderFrequencyPlots(); });
  $('impulse-count').addEventListener('change', () => { state.impulse = D.impulseResponse(state.filter, Number($('impulse-count').value)); renderImpulse(); });
  $('compare').addEventListener('click', guard(() => {
    if (state.comparisons.length >= 5) throw new Error('All five comparison slots are full. Remove a saved curve or use Clear all before saving another.');
    const color = COMPARISON_COLORS.find(candidate => !state.comparisons.some(curve => curve.color === candidate));
    const id = String(state.nextComparisonId++);
    state.comparisons.push({ id, filter: clone(state.filter), title: `${state.title} (${id})`, color, visible: true });
    renderComparisonList(); renderFrequencyPlots(); announce('Comparison saved.');
  }));
  $('clear-comparisons').addEventListener('click', () => {
    state.comparisons = []; $('error').hidden = true;
    renderComparisonList(); renderFrequencyPlots(); announce('All saved comparisons cleared.');
  });
  ['axis-x-auto', 'axis-y-auto'].forEach(id => $(id).addEventListener('change', enableAxisInputs));
  $('axes-form').addEventListener('submit', guard(event => {
    event.preventDefault();
    const axes = clone(state.axes), factor = state.units === 'hz' ? state.filter.sampleRate : 1;
    const xAuto = $('axis-x-auto').checked, yAuto = $('axis-y-auto').checked;
    const xMin = xAuto ? 0 : readNumber($('axis-x-min'), 'Frequency minimum') / factor;
    const xMax = xAuto ? 0.5 : readNumber($('axis-x-max'), 'Frequency maximum') / factor;
    if (xMin < 0 || xMin >= xMax || xMax > 0.5) throw new Error('Frequency axis limits must satisfy 0 ≤ minimum < maximum ≤ Nyquist.');
    const yMin = yAuto ? axes[state.scale].min : readNumber($('axis-y-min'), 'Magnitude minimum');
    const yMax = yAuto ? axes[state.scale].max : readNumber($('axis-y-max'), 'Magnitude maximum');
    if (yMin >= yMax || !Number.isFinite(yMax - yMin)) throw new Error('Magnitude maximum must exceed the minimum, with a finite span.');
    if (state.scale === 'linear' && yMin < 0) throw new Error('Linear magnitude limits must be nonnegative.');
    axes.x = { auto: xAuto, min: xMin, max: xMax };
    axes[state.scale] = { auto: yAuto, min: yMin, max: yMax };
    state.axes = axes; renderFrequencyPlots(); announce('Axis limits applied.');
  }));
  $('reset-axes').addEventListener('click', () => {
    state.axes = defaultAxes(); $('error').hidden = true;
    renderFrequencyPlots(); announce('Axes reset to full frequency range and automatic magnitude.');
  });
  function cancelDrag(synchronize = true) {
    const previous = drag; drag = null;
    if (dragFrame !== null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
    if (previous && $('z-plane').hasPointerCapture(previous.pointerId)) $('z-plane').releasePointerCapture(previous.pointerId);
    if (previous && synchronize) { synchronizeInputs(); renderPlane(); }
  }
  function updateDragPosition(event) {
    const root = state.groups[drag.kind].find(g => g.id === drag.id);
    if (!root) { cancelDrag(); return; }
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform($('z-plane').getScreenCTM().inverse());
    const re = Math.round((point.x - drag.plane.cx) / drag.plane.scale * 1000) / 1000;
    const im = root.pair ? Math.round(Math.abs((drag.plane.cy - point.y) / drag.plane.scale) * 1000) / 1000 : 0;
    drag.pending = { re, im };
  }
  function applyPendingDrag() {
    if (!drag?.pending) return;
    const { kind, id, pending } = drag; drag.pending = null;
    try {
      $('error').hidden = true;
      mutateRoots(groups => {
        const root = groups[kind].find(g => g.id === id);
        if (root) Object.assign(root, pending);
      }, undefined, undefined, true);
    } catch (error) { cancelDrag(); fail(error); }
  }
  $('z-plane').addEventListener('pointerdown', event => {
    const marker = event.target.closest('.root-hit');
    if (!marker || state.analysis.rootError || event.button !== 0) return;
    cancelDrag();
    event.preventDefault(); setTab('roots');
    drag = { kind: marker.dataset.kind, id: marker.dataset.rootId, plane: { ...state.plane }, pointerId: event.pointerId, pending: null, moved: false };
    $('z-plane').setPointerCapture(event.pointerId);
  });
  $('z-plane').addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    drag.moved = true; updateDragPosition(event);
    if (drag && dragFrame === null) dragFrame = requestAnimationFrame(() => { dragFrame = null; applyPendingDrag(); });
  });
  $('z-plane').addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.moved) updateDragPosition(event);
    applyPendingDrag(); cancelDrag();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) $('z-plane').addEventListener(type, event => {
    if (drag && event.pointerId === drag.pointerId) cancelDrag();
  });
  $('z-plane').addEventListener('keydown', guard(event => {
    const marker = event.target.closest('.root-hit');
    if (!marker || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const kind = marker.dataset.kind, id = marker.dataset.rootId, sign = Number(marker.dataset.sign), step = event.shiftKey ? 0.1 : 0.01;
    mutateRoots(groups => {
      const root = groups[kind].find(g => g.id === id);
      if (!root) return;
      if (event.key === 'ArrowRight') root.re += step;
      if (event.key === 'ArrowLeft') root.re -= step;
      if (root.pair && event.key === 'ArrowUp') root.im = Math.abs(root.im + step * sign);
      if (root.pair && event.key === 'ArrowDown') root.im = Math.abs(root.im - step * sign);
    });
    const selector = `[data-kind="${kind}"][data-root-id="${id}"]`;
    ($('z-plane').querySelector(`${selector}[data-sign="${sign}"]`) || $('z-plane').querySelector(selector))?.focus();
  }));
  $('copy-coefficients').addEventListener('click', async () => {
    const text = `b = ${coeffText(state.filter.b)}\na = ${coeffText(state.filter.a)}\nfs = ${state.filter.sampleRate}`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.left = '-10000px'; document.body.append(input); input.select();
      const ok = document.execCommand('copy'); input.remove();
      if (!ok) { document.querySelector('.coefficient-detail').open = true; announce('Select and copy the full precision coefficients below.'); return; }
    }
    $('copy-coefficients').textContent = 'Copied'; announce('Coefficients copied.');
    setTimeout(() => { $('copy-coefficients').textContent = 'Copy coefficients'; }, 1600);
  });
  $('export').addEventListener('click', () => {
    const data = { version: 1, ...state.filter };
    if (state.targets) data.targets = state.targets;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'filter-lab.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Filter exported.');
  });
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async () => {
    const file = $('import-file').files[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Filter JSON must be smaller than 1 MB.');
      const data = JSON.parse(await file.text());
      if (!data || data.version !== 1) throw new Error('Unsupported filter file. Expected version 1.');
      const filter = D.normalize(data.b, data.a, data.sampleRate);
      if (data.targets) D.validateTargets(data.targets, filter.sampleRate);
      $('error').hidden = true;
      if (data.targets) { state.targetDraft = clone(data.targets); renderTargets(); }
      commit(filter, { targets: data.targets || null, title: 'Imported filter' }); announce('Filter imported.');
    } catch (error) { fail(error); }
    finally { $('import-file').value = ''; }
  });
  renderTargets(); updateDesignControls(); commit(state.filter, { title: state.title, preset: true });
})();
