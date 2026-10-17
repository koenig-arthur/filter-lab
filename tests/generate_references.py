# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 koenig-arthur
#
# This file is part of Filter Lab.
#
# Filter Lab is free software: you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by
# the Free Software Foundation, version 3 of the License only.
#
# Filter Lab is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with Filter Lab. If not, see <https://www.gnu.org/licenses/>.
"""Regenerate independent numerical fixtures. Requires NumPy and SciPy only."""
import json
from pathlib import Path
import numpy as np
import scipy
from scipy import signal

FS = 8000.0
FREQUENCIES = [0, 100, 400, 800, 1000, 1200, 1500, 2000, 3000, 4000]


def case(name, b, a, design=None):
    b, a = np.asarray(b, dtype=float), np.asarray(a, dtype=float)
    b, a = b / a[0], a / a[0]
    _, response = signal.freqz(b, a, worN=np.asarray(FREQUENCIES), fs=FS)
    impulse = signal.lfilter(b, a, np.r_[1.0, np.zeros(127)])
    result = dict(name=name, b=b.tolist(), a=a.tolist(), sampleRate=FS,
                  frequencies=FREQUENCIES, magnitude=np.abs(response).tolist(),
                  phase=np.angle(response).tolist(), impulse=impulse.tolist())
    if design:
        result['design'] = design
    return result


cases = [case('moving average', [1/3]*3, [1]),
         case('one-pole low-pass', [.2], [1, -.8]),
         case('delay', [0, 0, 1], [1]),
         case('mixed orders', [.4, .1, -.2, .05], [1, -.5, .2]),
         case('negative gain', [-2], [1, .5]),
         case('near cancellation', [1, -.80001], [1, -.8])]
for taps in [3, 15, 63]:
    for kind, cutoff, pass_zero in [('lowpass', 1000, True), ('highpass', 1000, False),
                                   ('bandpass', [1000, 1500], False), ('notch', [1000, 1500], True)]:
        b = signal.firwin(taps, cutoff, pass_zero=pass_zero, window='hamming', fs=FS)
        cases.append(case(f'FIR {kind} {taps}', b, [1], dict(family='fir', type=kind,
                          frequency=1000, upperFrequency=1500, taps=taps)))
for kind in ['lowpass', 'highpass', 'bandpass', 'notch']:
    q = np.sqrt(.5) if kind in ['lowpass', 'highpass'] else 10
    omega = 2 * FS * np.tan(np.pi * 1000 / FS)
    numerator = {'lowpass': [omega**2], 'highpass': [1, 0, 0],
                 'bandpass': [omega/q, 0], 'notch': [1, 0, omega**2]}[kind]
    b, a = signal.bilinear(numerator, [1, omega/q, omega**2], fs=FS)
    cases.append(case(f'IIR {kind}', b, a, dict(family='iir', type=kind, frequency=1000, q=float(q))))
points = [dict(frequency=f, db=d) for f, d in [(0, 0), (800, 0), (1200, -40), (4000, -40)]]
for taps in [15, 63]:
    b = signal.firwin2(taps, [p['frequency'] for p in points], [10**(p['db']/20) for p in points],
                       nfreqs=513, window='hamming', fs=FS)
    cases.append(case(f'custom targets {taps}', b, [1], dict(family='targets', points=points, taps=taps)))
path = Path(__file__).with_name('references.json')
path.write_text(json.dumps(dict(generator=f'SciPy {scipy.__version__}', cases=cases), indent=2) + '\n')
print(f'Wrote {len(cases)} independent reference cases to {path.name}')
