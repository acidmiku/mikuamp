# Tone filter approximation

Reference: Jerome O'Flaherty, [HiBy R1, MSEB EQ Measurements](https://www.pragmaticaudio.com/reviews/2025/02/hiby-r1/#mseb-eq-measurements), 4 February 2025. Graphs 73–77 were inspected visually. Frequencies and Q values below are estimates, not digitized fits. The original graphs are not redistributed.

Sliders range from -100 to +100; the gain column gives the gain at +100. Gain varies linearly with the slider. Negative settings reverse the gain. This interpolation is a MikuAmp design choice; the reference does not measure HiBy's intermediate slider positions.

| Control | Type | Frequency | Q | Gain at +100 |
|---|---|---:|---:|---:|
| Temperature (warm) | Low shelf + high shelf | 180 Hz / 4500 Hz | 0.5 / 0.5 | +10 / -10 dB |
| Bass extension | Low shelf | 55 Hz | 0.7 | +25 dB |
| Bass texture | Peak | 90 Hz | 1.0 | +20 dB |
| Note thickness | Peak | 200 Hz | 0.7 | +12 dB |
| Vocals | Peak | 650 Hz | 0.6 | +12 dB |
| Female overtones | Peak | 3300 Hz | 2.0 | +9 dB |
| Sibilance low | Peak | 5500 Hz | 1.5 | +10 dB |
| Sibilance high | Peak | 8500 Hz | 1.5 | +10 dB |
| Impulse | Peak | 6500 Hz | 0.5 | +10 dB |
| Air | High shelf | 12000 Hz | 0.7 | +25 dB |

Filters use the [RBJ audio EQ cookbook](https://www.w3.org/TR/audio-eq-cookbook/) equations with Q-based alpha for both peaks and shelves. Frequencies are limited to 45% of the source sample rate for numerical stability near Nyquist. The combined response is sampled at 256 logarithmically spaced frequencies to calculate automatic headroom when Tone is enabled. This is estimated headroom, not a look-ahead limiter; a full-scale clamp catches residual overs. At extreme settings, audible coloration is expected.

The approximate temperature tilt levels out at both ends, whereas the measured R1 curve appears closer to a straight logarithmic tilt. The air and impulse responses also differ near Nyquist. No claim of exact matching is made. PEQ and Tone can run together and have separate bypass controls. The curve plot includes the PEQ preamp and both active filter banks, before Tone's automatic headroom attenuation.
