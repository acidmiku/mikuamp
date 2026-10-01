//! Streaming polyphase windowed-sinc conversion to the device's mix rate.
//! Coefficients and buffers are allocated before playback; no per-frame allocations.
use rodio::{source::SeekError, Source};
use std::{collections::VecDeque, f64::consts::PI, time::Duration};

const TAPS: usize = 256;
const HALF: i64 = (TAPS / 2) as i64;
const PHASES: usize = 1024;

pub struct Resampled<S: Source<Item = f32>> {
    input: S,
    rate: u32,
    channels: usize,
    step: f64,
    position: f64,
    channel: usize,
    kernels: Vec<Vec<f32>>,
    buffer: VecDeque<f32>,
    first: i64,
    loaded: i64,
    end: Option<i64>,
    frame: Vec<f32>,
}
impl<S: Source<Item = f32>> Resampled<S> {
    pub fn new(input: S, rate: u32) -> Self {
        let channels = input.channels() as usize;
        let step = input.sample_rate() as f64 / rate as f64;
        let mut kernels = Vec::new();
        if input.sample_rate() != rate {
            let cutoff = (1. / step).min(1.) * 0.94;
            for phase in 0..=PHASES {
                let fraction = phase as f64 / PHASES as f64;
                let mut kernel = Vec::with_capacity(TAPS);
                for tap in 0..TAPS {
                    let x = (tap as i64 - HALF + 1) as f64 - fraction;
                    let sinc = if x.abs() < 1e-12 {
                        cutoff
                    } else {
                        (PI * cutoff * x).sin() / (PI * x)
                    };
                    let window = 0.42
                        + 0.5 * (PI * x / HALF as f64).cos()
                        + 0.08 * (2. * PI * x / HALF as f64).cos();
                    kernel.push((sinc * window) as f32);
                }
                let sum: f32 = kernel.iter().sum();
                kernel.iter_mut().for_each(|v| *v /= sum);
                kernels.push(kernel);
            }
        }
        let mut result = Self {
            input,
            rate,
            channels,
            step,
            position: 0.,
            channel: 0,
            kernels,
            buffer: VecDeque::with_capacity((TAPS + step.ceil() as usize + 16) * channels),
            first: 1 - HALF,
            loaded: 0,
            end: None,
            frame: vec![0.; channels],
        };
        result.reset();
        result
    }
    fn reset(&mut self) {
        self.position = 0.;
        self.channel = 0;
        self.first = 1 - HALF;
        self.loaded = 0;
        self.end = None;
        self.buffer.clear();
        self.buffer.resize((HALF as usize - 1) * self.channels, 0.);
    }
    fn next_frame(&mut self) -> bool {
        if self.end.is_some_and(|end| self.position >= end as f64) {
            return false;
        }
        let center = self.position.floor() as i64;
        let left = center - HALF + 1;
        while self.first < left {
            for _ in 0..self.channels {
                self.buffer.pop_front();
            }
            self.first += 1;
        }
        while self.loaded <= center + HALF {
            for _ in 0..self.channels {
                let sample = if self.end.is_some() {
                    0.
                } else {
                    match self.input.next() {
                        Some(s) => s,
                        None => {
                            self.end = Some(self.loaded);
                            0.
                        }
                    }
                };
                self.buffer.push_back(sample);
            }
            self.loaded += 1;
        }
        if self.end.is_some_and(|end| self.position >= end as f64) {
            return false;
        }
        let phase_position = self.position.fract() * PHASES as f64;
        let phase = (phase_position.floor() as usize).min(PHASES - 1);
        let blend = (phase_position - phase as f64) as f32;
        let kernel = &self.kernels[phase];
        let next_kernel = &self.kernels[phase + 1];
        for channel in 0..self.channels {
            let mut sample = 0_f64;
            for (tap, coefficient) in kernel.iter().enumerate() {
                let interpolated = *coefficient + (next_kernel[tap] - *coefficient) * blend;
                sample += interpolated as f64 * self.buffer[tap * self.channels + channel] as f64;
            }
            self.frame[channel] = sample as f32;
        }
        true
    }
}
impl<S: Source<Item = f32>> Iterator for Resampled<S> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        if self.kernels.is_empty() {
            return self.input.next();
        }
        if self.channel == 0 && !self.next_frame() {
            return None;
        }
        let sample = self.frame[self.channel];
        self.channel += 1;
        if self.channel == self.channels {
            self.channel = 0;
            self.position += self.step;
        }
        Some(sample)
    }
}
impl<S: Source<Item = f32>> Source for Resampled<S> {
    fn current_span_len(&self) -> Option<usize> {
        if self.kernels.is_empty() {
            self.input.current_span_len()
        } else {
            None
        }
    }
    fn channels(&self) -> u16 {
        self.channels as u16
    }
    fn sample_rate(&self) -> u32 {
        self.rate
    }
    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.input.try_seek(pos)?;
        self.reset();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn signal(frequency: f64, rate: u32, n: usize) -> rodio::buffer::SamplesBuffer {
        rodio::buffer::SamplesBuffer::new(
            1,
            rate,
            (0..n)
                .map(|i| (0.25 * (2. * PI * frequency * i as f64 / rate as f64).sin()) as f32)
                .collect::<Vec<_>>(),
        )
    }
    fn rms(values: &[f32]) -> f64 {
        (values.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / values.len() as f64).sqrt()
    }
    #[test]
    fn downsampling_rejects_ultrasonic_alias() {
        let output = Resampled::new(signal(30000., 96000, 9600), 48000).collect::<Vec<_>>();
        assert_eq!(output.len(), 4800);
        assert!(
            rms(&output[500..4300]) < 0.00005,
            "ultrasonic signal aliased into audible output"
        );
    }
    #[test]
    fn conversion_preserves_audible_level_and_duration() {
        for (source, target) in [(44100, 48000), (96000, 48000), (48000, 44100)] {
            let output = Resampled::new(signal(1000., source, source as usize / 10), target)
                .collect::<Vec<_>>();
            assert!((output.len() as i64 - target as i64 / 10).abs() <= 1);
            assert!(
                (20. * (rms(&output[500..output.len() - 500]) / (0.25 / 2_f64.sqrt())).log10())
                    .abs()
                    < 0.05
            );
        }
    }
    #[test]
    fn matching_rate_is_exact_and_seek_resets_buffers() {
        let data = vec![0.1, -0.2, 0.3, -0.4];
        let input = rodio::buffer::SamplesBuffer::new(2, 48000, data.clone());
        assert_eq!(Resampled::new(input, 48000).collect::<Vec<_>>(), data);
        let mut output = Resampled::new(signal(1000., 96000, 9600), 48000);
        let first = output.by_ref().take(400).collect::<Vec<_>>();
        output.try_seek(Duration::ZERO).unwrap();
        let again = output.take(400).collect::<Vec<_>>();
        assert_eq!(first, again);
    }
}
