# Filter Lab

Interactive, offline FIR/IIR filter designer for learning DSP through pole-zero placement, frequency responses, and filter comparisons.

## Run locally

Open **index.html** directly in a modern browser. All application files are local;
there is no build step, server, account, CDN, or runtime internet requirement.
Keep `index.html`, `style.css`, `dsp.js`, and `app.js` together.

Download the repository or clone it:

```sh
git clone https://github.com/koenig-arthur/filter-lab.git
cd filter-lab
```

Then open `index.html` in your browser. Testing dependencies are optional;
the application itself needs only the local HTML, CSS, and JavaScript files.
Keep `license.html` and `LICENSE` alongside them for the offline license notice.

## Three ways to build a filter

1. **H(z):** enter a rational expression such as `(1+z^-1)/(1-0.8*z^-1)`,
   `(z+1)/(z-0.8)`, `0.2/(1-0.8*z^-1)`, or `z^-2`. Alternatively enter
   numerator `b` and denominator `a` arrays. Coefficients multiply
   `1, z^-1, z^-2, ...`; the application normalizes `a[0]` to 1.
2. **Poles & zeros:** set counts or add real roots/conjugate pairs. Edit Cartesian
   or polar coordinates, or drag markers. Complex roots remain paired. Focus a
   marker and press arrow keys to move by 0.01; Shift increases the step to 0.1.
   Real roots stay on the real axis. Gain and an additional sample delay are editable.
   Placed factors keep their positions and identities, even through the origin or
   at zero gain. **Reset filter** starts at `H(z) = 1` with no roots, gain 1 and
   delay 0. It clears filter errors and applied design targets, while retaining
   sampling rate, saved comparisons, plot settings, inspection frequencies, and
   the active tab. Reset remains available after a numerical root warning.
3. **Design in Hz:** select FIR or IIR low-pass, high-pass, band-pass, or notch /
   band-stop. Custom target points fit a linear-phase FIR; orange shows the
   target and blue shows the result. The results table reports the actual gain
   at every requested frequency.

The shared plots show pole/zero locations, magnitude, unwrapped phase, and an
impulse response. The cursor reports wrapped phase at one frequency and marks
its angle on the unit circle. Use the dropdown experiments and “Try this” notes
to explore the connection between roots, frequency selectivity, and ringing.

**An example:** keep the sampling rate at 8000 Hz, choose IIR notch, center 1000 Hz,
and Q = 10. Click Design filter. The cursor at 1000 Hz reads −∞ dB. Increasing Q
narrows the rejected band. For attenuation *above* 1000 Hz, choose low-pass instead.

Save up to **five magnitude responses plus the live filter**, copy full precision
coefficients, or export/import a filter as JSON. Saved curves have editable names,
stable colors, visibility checkboxes, and individual remove controls. Use **Clear all**
to empty the comparison slots. Saving a sixth curve never overwrites another.
Comparisons and display settings last for the current session; JSON continues to
export the active filter only. Switching input tabs never applies a new filter by itself.

## Measure attenuation and adjust the view

**Inspect frequency** is the fixed reference. Hover over the magnitude plot to
measure another frequency without moving that reference; the last measurement
remains visible after the pointer leaves. Click the plot to set a new reference.
The numeric **Compare at** field provides the same measurement for precise,
keyboard, or touch use. Green marks the reference and the dotted gray line marks
the measurement. Each visible curve has its own row in the measurement table.

The two gain columns are absolute dB gains relative to the input signal. The
**Δ gain** column is `G(compare at) − G(reference)`. For example, −3 dB at the
reference and −23 dB at the measurement means **20 dB more attenuation**, or
**0.1× amplitude relative to the reference**. Positive Δ gain means less
attenuation. Measurements evaluate the coefficients at the exact frequencies,
not at the nearest point in the drawn curve. A zero reference cannot be used for
a relative ratio; a zero measurement with a nonzero reference gives −∞ dB / 0×.
Singular or out-of-range responses are explicitly marked unavailable.

Expand **Axes** below the magnitude plot. Turn off **Full range** to enter a
frequency minimum and maximum; both magnitude and phase use that interval.
Limits must satisfy `0 ≤ minimum < maximum ≤ fs/2`. Turn off **Auto scale** to
set magnitude limits. dB and linear mode remember separate bounds, and linear
bounds must be nonnegative. Click **Apply axes** to commit the settings or
**Reset axes** to restore the full frequency range and automatic magnitude.
Finite curves are clipped at plot boundaries; only true zeros sit at the dB floor.
The reference and measurement can remain outside the visible interval, in which
case the readout says “outside view”. The plots are resampled within each new
frequency range, and phase is unwrapped within that interval.

Changing sampling rate preserves coefficients and scales the reference,
measurement, and applied target frequencies. Axis bounds are stored as `f/fs`,
so the viewed fraction also stays the same. To study higher unique frequencies,
increase the sampling rate; the display deliberately stays within Nyquist.
Each saved comparison retains its original sample rate: Hz mode compares the
same physical frequencies (and draws no response beyond that curve's Nyquist),
while normalized mode compares the same `f/fs`. The measurement table lists each
curve's corresponding frequencies in Hz. Hidden curves do not affect the
measurement table or automatic scaling.

## Conventions and numerical limits

- Real-coefficient, causal filters only; maximum numerator/denominator order 64.
  Expressions allow numbers (including scientific notation), `z`, arithmetic,
  parentheses, and integer powers. Use explicit `*`; there is no symbolic function
  language or JavaScript evaluation. The last valid filter survives input errors.
- Root-editor factors mean
  `H(z) = gain * z^-delay * product(1-zero*z^-1) / product(1-pole*z^-1)`.
  A root factor at 0 is constant 1: it stays in the editor count as an **inactive
  factor**, shown as a gray diamond, and contributes no effective root. Move it
  away from the origin to activate it again. Automatically implied origin
  roots are labeled separately. For example, a three-tap moving average has two
  poles at the origin; it is still FIR.
- Stability badges describe the **denominator / recursive realization**.
  Near-cancelling pairs are flagged but never silently cancelled. A transfer
  function may simplify ideally while its original recurrence has unstable modes.
  At an unsimplified 0/0 frequency, the cursor reports “Undefined (0/0)”.
- Poles within `1e-9` of unit radius are conservatively labeled as boundary cases.
  Unstable responses are labeled algebraic unit-circle evaluations. The impulse
  simulation stops before nonfinite values or magnitudes above `1e9`.
- Placed designs use their supplied factors directly for root locations,
  multiplicities, stability and cancellation analysis. Drag updates are combined
  into one per animation frame, with the final position applied on release.
  Gain 0 retains the placed factors and delay; restoring gain restores the design.
- For coefficient, formula, imported and frequency-designed filters, the root
  solver uses complex Laguerre iteration, conjugate deflation, and
  polishing. Normalized polynomial residuals and coefficient reconstruction must
  pass a `2e-6` tolerance. Ill-conditioned cases display a warning and disable
  root editing; **Reset filter** remains enabled. Magnitude and impulse calculations
  always use the coefficients, including for placed designs, and remain subject
  to floating-point limitations for high orders or closely spaced roots.
  High-order or nearly repeated roots can be sensitive even with small residuals.
  JSON exports retain coefficients only: inactive factors and the editor's known
  factor positions are session state. Importing uses numerical root recovery again.
- Exact zeros are displayed at the dB plot floor; the cursor reports −∞ dB and
  undefined phase. Phase segments restart across zeros/singularities. Values below
  the numerical zero threshold (relative to coefficient scale) are treated as zero.
- FIR presets use a Hamming-windowed sinc, odd lengths of 3–63 taps, and passband
  normalization. Their cutoff is approximately **−6 dB**, when bands are sufficiently
  separated. IIR presets are second-order biquads; low/high-pass cutoffs are
  **−3 dB at Q = 1/√2**. The band-pass has unit peak gain.
- Custom targets: 2–64 strictly increasing frequencies, including 0 and `fs/2`,
  with gains from −120 to +40 dB. Convert dB to linear amplitude, interpolate on
  513 frequency points, use a 1024-point inverse cosine sum with linear-phase
  delay, truncate to the selected odd tap count, and apply a Hamming window.
  No post-normalization is applied. Sharp transitions and deep/narrow notches are
  approximate; inspect the actual curve and target table.
- Long equations scroll inside their panels. Full precision coefficients remain
  available under the equation and through Copy coefficients / Export filter.

## Tests

Node.js 20+ is needed **only for testing**. With a normal Node/npm installation:

```sh
# From the filter-lab repository root:
npm ci
npx playwright install chromium --only-shell
npm test
npm run test:browser
```

The numerical suite uses Node's built-in test runner and checked-in independent
SciPy fixtures. It covers parser errors, delays and degree balance, repeated roots,
conjugate pairs, root/coefficients round trips, instability, cancellation, design
validation, FIR/IIR coefficients, magnitude/phase, impulse responses, exact
relative gains, zero/singular references, bounded response sampling, and explicit
factor analysis through order 64 (including repeated, conjugate and origin factors).

Browser tests load the actual `file://` page with network access disabled. They
exercise all input modes, root dragging and keyboard editing, cursor readouts,
multiple comparisons, hover measurements, zoomed coordinate mapping, manual
axis clipping, unit/rate changes, JSON round trips, invalid input, and responsive layouts. They also
exercise root-count preservation, dragging through the origin, queued/cancelled
drag updates, zero-gain recovery and reset after numerical failures. They
fail on console errors or attempted HTTP requests. Failure screenshots and traces
are stored in ignored `test-results/`. Set `PLAYWRIGHT_BROWSERS_PATH` if using a
browser cache outside Playwright's default location.

To regenerate reference values with Python, NumPy and SciPy installed:

```sh
python3 tests/generate_references.py
```

`dsp.js` exposes `FilterDSP` in the browser and CommonJS exports in Node. Its main
interface is `{ b: number[], a: number[], sampleRate: number }`; parsing, root
conversion, analysis, response calculation, and designers are independent of the DOM.
`analyzeFactors({ zeros = [], poles = [], gain = 1, delay = 0 }, sampleRate = 8000)`
returns `{ filter, analysis }` without solving for roots again. The model uses the
same complex root objects as `fromFactors`; inputs are validated and not mutated.
Inactive origin factors are excluded from effective roots. At zero gain, analysis
reports the zero filter while the UI retains the factor model for later editing.
`frequencyResponse(filter, count = 1025, {minHz = 0, maxHz = fs/2} = {})`
optionally samples a bounded interval. `compareGain(filter, referenceHz, measurementHz)`
returns both responses, the dB difference, amplitude ratio, and an explicit
status/reason when the comparison is undefined or outside Nyquist.

Export format: `{ "version": 1, "b": [...], "a": [...], "sampleRate": 8000 }`.
Custom designs may additionally contain `targets: [{frequency, db}, ...]`.

## References

- [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/) — IIR biquad formulas.
- [SciPy firwin](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.firwin.html) — windowed-sinc FIR conventions.
- [SciPy firwin2](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.firwin2.html) — custom frequency-sampling FIR approach.
- [SciPy tf2zpk](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.tf2zpk.html) — the distinction between coefficients in positive and negative powers.

## License

Copyright (C) 2026 koenig-arthur.

Filter Lab's original source code, documentation, and test fixtures are licensed
under the **GNU General Public License, version 3 only** (`GPL-3.0-only`). You may
redistribute and modify this project under those terms. It is provided without
any warranty, including implied warranties of merchantability or fitness for a
particular purpose. See [LICENSE](LICENSE) for the full terms, or open the
[offline license notice](license.html).

Development dependencies retain their own licenses. The mathematical references
above document the design methods; they are not bundled runtime dependencies.
The npm package is marked `private` to prevent accidental npm publication.
