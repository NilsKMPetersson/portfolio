#!/usr/bin/env python3
"""Generate the built-in GrannySynth demo tone. Original; safe to replace."""

import math
import random
import struct
import wave

random.seed(7)
sr = 44100
duration = 8.0
n = int(sr * duration)
notes = [
    (0.0, 1.6, 220.0),
    (0.8, 1.6, 277.18),
    (1.6, 1.8, 329.63),
    (2.8, 2.0, 440.0),
    (4.2, 2.2, 369.99),
    (5.6, 2.4, 293.66),
]
samples = [0.0] * n
for start, length, freq in notes:
    i0 = int(start * sr)
    i1 = min(n, int((start + length) * sr))
    for i in range(i0, i1):
        t = (i - i0) / sr
        env = (1 - math.exp(-t * 40)) * math.exp(-t * 1.35)
        tone = 0.0
        for harmonic, amp in ((1, 1.0), (2, 0.45), (3, 0.22), (4, 0.12), (6, 0.06)):
            tone += amp * math.sin(2 * math.pi * freq * harmonic * t)
        samples[i] += tone * env * 0.22

for i in range(n):
    t = i / sr
    bed = 0.05 * math.sin(2 * math.pi * 110 * t) * (0.5 + 0.5 * math.sin(2 * math.pi * 0.2 * t))
    samples[i] += bed + random.uniform(-0.008, 0.008)

peak = max(abs(s) for s in samples) or 1.0
scale = 0.89 / peak
frames = bytearray()
for sample in samples:
    value = max(-32767, min(32767, int(sample * scale * 32767)))
    frames += struct.pack("<h", value)

with wave.open("demo.wav", "w") as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(sr)
    handle.writeframes(frames)

print(f"wrote demo.wav: {n} samples, peak {peak:.3f}, {len(frames)} bytes")
