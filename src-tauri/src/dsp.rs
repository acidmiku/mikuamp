use rodio::{source::SeekError, Source};
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::{Deserialize, Serialize};
use std::{
    f64::consts::PI,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Band {
    pub frequency: f64,
    pub gain: f64,
    pub q: f64,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EqSettings {
    pub enabled: bool,
    pub preamp: f64,
    pub bands: Vec<Band>,
    #[serde(default)]
    pub tone_enabled: bool,
    #[serde(default = "neutral_tone")]
    pub tone: Vec<f64>,
}
fn neutral_tone() -> Vec<f64> {
    vec![0.; 10]
}
impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preamp: -3.0,
            bands: [
                31., 62., 125., 250., 500., 1000., 2000., 4000., 8000., 16000.,
            ]
            .iter()
            .map(|f| Band {
                frequency: *f,
                gain: 0.,
                q: 1.0,
                kind: "peak".into(),
            })
            .collect(),
            tone_enabled: false,
            tone: neutral_tone(),
        }
    }
}
impl EqSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.bands.len() != 10
            || !self.preamp.is_finite()
            || !(-18.0..=12.0).contains(&self.preamp)
            || self.tone.len() != 10
            || self
                .tone
                .iter()
                .any(|n| !n.is_finite() || !(-100.0..=100.0).contains(n))
        {
            return Err("Invalid equalizer settings".into());
        }
        for b in &self.bands {
            if !b.frequency.is_finite()
                || !(20.0..=20000.0).contains(&b.frequency)
                || !b.gain.is_finite()
                || !(-15.0..=15.0).contains(&b.gain)
                || !b.q.is_finite()
                || !(0.1..=12.0).contains(&b.q)
                || !["peak", "lowShelf", "highShelf"].contains(&b.kind.as_str())
            {
                return Err("Invalid EQ band: check frequency, gain and Q".into());
            }
        }
        Ok(())
    }
    pub fn filters(&self) -> Vec<Band> {
        let mut bands = if self.enabled {
            self.bands.clone()
        } else {
            vec![]
        };
        if self.tone_enabled {
            let v = &self.tone;
            // Independent, approximate curves estimated from Pragmatic Audio's R1 measurements.
            // Positive temperature means warm. All other positive values boost their region.
            for (f, g, q, kind) in [
                (180., v[0] * 0.10, 0.5, "lowShelf"),
                (4500., -v[0] * 0.10, 0.5, "highShelf"),
                (55., v[1] * 0.25, 0.7, "lowShelf"),
                (90., v[2] * 0.20, 1.0, "peak"),
                (200., v[3] * 0.12, 0.7, "peak"),
                (650., v[4] * 0.12, 0.6, "peak"),
                (3300., v[5] * 0.09, 2., "peak"),
                (5500., v[6] * 0.10, 1.5, "peak"),
                (8500., v[7] * 0.10, 1.5, "peak"),
                (6500., v[8] * 0.10, 0.5, "peak"),
                (12000., v[9] * 0.25, 0.7, "highShelf"),
            ] {
                bands.push(Band {
                    frequency: f,
                    gain: g,
                    q,
                    kind: kind.into(),
                });
            }
        }
        bands
    }
}

// Robert Bristow-Johnson audio EQ cookbook, transposed direct form II.
#[derive(Clone, Copy, Debug)]
pub struct Coeff {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}
impl Coeff {
    pub fn new(b: &Band, rate: f64) -> Self {
        let a = 10_f64.powf(b.gain / 40.0);
        let w = 2.0 * PI * b.frequency.min(rate * 0.45) / rate;
        let c = w.cos();
        let alpha = w.sin() / (2.0 * b.q);
        let t = 2.0 * a.sqrt() * alpha;
        let (b0, b1, b2, a0, a1, a2) = match b.kind.as_str() {
            "lowShelf" => (
                a * ((a + 1.) - (a - 1.) * c + t),
                2. * a * ((a - 1.) - (a + 1.) * c),
                a * ((a + 1.) - (a - 1.) * c - t),
                (a + 1.) + (a - 1.) * c + t,
                -2. * ((a - 1.) + (a + 1.) * c),
                (a + 1.) + (a - 1.) * c - t,
            ),
            "highShelf" => (
                a * ((a + 1.) + (a - 1.) * c + t),
                -2. * a * ((a - 1.) + (a + 1.) * c),
                a * ((a + 1.) + (a - 1.) * c - t),
                (a + 1.) - (a - 1.) * c + t,
                2. * ((a - 1.) - (a + 1.) * c),
                (a + 1.) - (a - 1.) * c - t,
            ),
            _ => (
                1. + alpha * a,
                -2. * c,
                1. - alpha * a,
                1. + alpha / a,
                -2. * c,
                1. - alpha / a,
            ),
        };
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}
#[derive(Default, Clone)]
struct Delay {
    z1: f64,
    z2: f64,
}
impl Delay {
    fn tick(&mut self, c: Coeff, x: f64) -> f64 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

pub struct Processed<S: Source<Item = f32>> {
    input: S,
    settings: Arc<Mutex<EqSettings>>,
    local: EqSettings,
    coeffs: Vec<Coeff>,
    delays: Vec<Vec<Delay>>,
    channels: u16,
    rate: u32,
    channel: usize,
    samples: usize,
    mono: f32,
    fft_input: Vec<Complex<f32>>,
    fft_fill: usize,
    fft: Arc<dyn Fft<f32>>,
    scratch: Vec<Complex<f32>>,
    spectrum: Arc<Mutex<Vec<f32>>>,
    gain: f64,
    target_gain: f64,
}
impl<S: Source<Item = f32>> Processed<S> {
    pub fn new(input: S, settings: Arc<Mutex<EqSettings>>, spectrum: Arc<Mutex<Vec<f32>>>) -> Self {
        let channels = input.channels();
        let rate = input.sample_rate();
        let local = settings.lock().unwrap().clone();
        let coeffs = local
            .filters()
            .iter()
            .map(|b| Coeff::new(b, rate as f64))
            .collect::<Vec<_>>();
        let target_gain = headroom(&local, &coeffs, rate);
        let fft = FftPlanner::new().plan_fft_forward(2048);
        let scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
        Self {
            input,
            settings,
            local,
            coeffs,
            delays: vec![vec![Delay::default(); 21]; channels as usize],
            channels,
            rate,
            channel: 0,
            samples: 0,
            mono: 0.,
            fft_input: vec![Complex::default(); 2048],
            fft_fill: 0,
            fft,
            scratch,
            spectrum,
            gain: target_gain,
            target_gain,
        }
    }
    fn analyze(&mut self) {
        self.fft
            .process_with_scratch(&mut self.fft_input, &mut self.scratch);
        if let Ok(mut bars) = self.spectrum.try_lock() {
            for (i, bar) in bars.iter_mut().enumerate() {
                let low = 32_f32 * (18000_f32 / 32.).powf(i as f32 / 32.);
                let high = 32_f32 * (18000_f32 / 32.).powf((i + 1) as f32 / 32.);
                let a = ((low * 2048. / self.rate as f32) as usize).clamp(1, 1023);
                let b = ((high * 2048. / self.rate as f32).ceil() as usize).clamp(a + 1, 1024);
                let peak = self.fft_input[a..b]
                    .iter()
                    .map(|c| c.norm() / 512.)
                    .fold(0_f32, f32::max);
                let value = ((20. * peak.max(1e-6).log10() + 65.) / 65.).clamp(0., 1.);
                *bar = value.max(*bar * 0.78);
            }
        }
        self.fft_fill = 0;
    }
}
impl<S: Source<Item = f32>> Iterator for Processed<S> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let x = self.input.next()?;
        if self.samples.is_multiple_of(1024) {
            if let Ok(settings) = self.settings.try_lock() {
                if *settings != self.local {
                    self.local = settings.clone();
                    self.coeffs = self
                        .local
                        .filters()
                        .iter()
                        .map(|b| Coeff::new(b, self.rate as f64))
                        .collect();
                    self.target_gain = headroom(&self.local, &self.coeffs, self.rate);
                    self.delays
                        .iter_mut()
                        .for_each(|c| c.fill(Delay::default()));
                }
            }
        }
        self.samples += 1;
        self.gain += (self.target_gain - self.gain) * 0.002;
        let mut y = x as f64 * self.gain;
        for (delay, c) in self.delays[self.channel].iter_mut().zip(&self.coeffs) {
            y = delay.tick(*c, y);
        }
        // Transparent below full scale; prevents EQ overs from reaching the output device.
        let y = if y.is_finite() {
            y.clamp(-1., 1.) as f32
        } else {
            0.
        };
        self.mono += y / self.channels as f32;
        self.channel += 1;
        if self.channel == self.channels as usize {
            self.channel = 0;
            let window =
                0.5 - 0.5 * (2. * std::f32::consts::PI * self.fft_fill as f32 / 2047.).cos();
            self.fft_input[self.fft_fill] = Complex::new(self.mono * window, 0.);
            self.mono = 0.;
            self.fft_fill += 1;
            if self.fft_fill == 2048 {
                self.analyze();
            }
        }
        Some(y)
    }
}

fn headroom(settings: &EqSettings, coeffs: &[Coeff], rate: u32) -> f64 {
    let preamp = if settings.enabled {
        settings.preamp
    } else {
        0.
    };
    // Tone uses automatic headroom; PEQ retains the user's explicit preamp.
    let peak = if settings.tone_enabled {
        (0..256)
            .map(|i| {
                let f = 20_f64 * (20000_f64 / 20.).powf(i as f64 / 255.);
                let w = 2. * PI * f.min(rate as f64 * 0.49) / rate as f64;
                coeffs
                    .iter()
                    .map(|c| {
                        let n = (c.b0 + c.b1 * w.cos() + c.b2 * (2. * w).cos()).powi(2)
                            + (c.b1 * w.sin() + c.b2 * (2. * w).sin()).powi(2);
                        let d = (1. + c.a1 * w.cos() + c.a2 * (2. * w).cos()).powi(2)
                            + (c.a1 * w.sin() + c.a2 * (2. * w).sin()).powi(2);
                        10. * (n / d).log10()
                    })
                    .sum::<f64>()
                    + preamp
            })
            .fold(0_f64, f64::max)
    } else {
        0.
    };
    10_f64.powf((preamp - peak) / 20.)
}
impl<S: Source<Item = f32>> Source for Processed<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.input.current_span_len()
    }
    fn channels(&self) -> u16 {
        self.input.channels()
    }
    fn sample_rate(&self) -> u32 {
        self.input.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.input.try_seek(pos)?;
        self.delays
            .iter_mut()
            .for_each(|c| c.fill(Delay::default()));
        self.fft_fill = 0;
        self.channel = 0;
        self.mono = 0.;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn measured_gain(f: f64, b: Band) -> f64 {
        let c = Coeff::new(&b, 48000.);
        let mut d = Delay::default();
        let mut in_power = 0.;
        let mut out_power = 0.;
        for n in 0..48000 {
            let x = (2. * PI * f * n as f64 / 48000.).sin() * 0.05;
            let y = d.tick(c, x);
            if n > 12000 {
                in_power += x * x;
                out_power += y * y;
            }
        }
        10. * (out_power / in_power).log10()
    }
    #[test]
    fn peak_has_requested_gain() {
        let b = Band {
            frequency: 1000.,
            gain: 6.,
            q: 1.,
            kind: "peak".into(),
        };
        assert!((measured_gain(1000., b) - 6.).abs() < 0.05);
    }
    #[test]
    fn flat_is_transparent() {
        for kind in ["peak", "lowShelf", "highShelf"] {
            let b = Band {
                frequency: 1000.,
                gain: 0.,
                q: 1.,
                kind: kind.into(),
            };
            assert!(measured_gain(800., b).abs() < 0.001);
        }
    }
    #[test]
    fn shelves_work_at_correct_ends() {
        let mut b = Band {
            frequency: 500.,
            gain: 6.,
            q: 0.707,
            kind: "lowShelf".into(),
        };
        assert!(measured_gain(40., b.clone()) > 5.8);
        assert!(measured_gain(10000., b.clone()).abs() < 0.1);
        b.kind = "highShelf".into();
        assert!(measured_gain(10000., b) > 5.8);
    }
    #[test]
    fn rejects_invalid_settings() {
        let mut eq = EqSettings::default();
        eq.bands[0].q = 0.;
        assert!(eq.validate().is_err());
        eq.bands[0].q = 1.;
        eq.preamp = f64::NAN;
        assert!(eq.validate().is_err());
    }
    #[test]
    fn extreme_tone_remains_finite_and_bounded() {
        use rodio::source::SineWave;
        let mut eq = EqSettings::default();
        eq.enabled = true;
        eq.tone_enabled = true;
        eq.tone = vec![100.; 10];
        eq.bands.iter_mut().for_each(|b| b.gain = 15.);
        let spectrum = Arc::new(Mutex::new(vec![0.; 32]));
        let source = Processed::new(
            SineWave::new(700.),
            Arc::new(Mutex::new(eq)),
            spectrum.clone(),
        );
        let mut energy = 0.;
        for sample in source.take(48000) {
            assert!(sample.is_finite() && sample.abs() <= 1.);
            energy += sample * sample;
        }
        assert!(energy > 0.);
        assert!(spectrum.lock().unwrap().iter().all(|v| v.is_finite()));
    }
    #[test]
    fn processing_preserves_stereo_channels() {
        let input = rodio::buffer::SamplesBuffer::new(2, 48000, vec![0.25, -0.5, 0.3, -0.4]);
        let source = Processed::new(
            input,
            Arc::new(Mutex::new(EqSettings::default())),
            Arc::new(Mutex::new(vec![0.; 32])),
        );
        assert_eq!(source.collect::<Vec<_>>(), vec![0.25, -0.5, 0.3, -0.4]);
    }
}
