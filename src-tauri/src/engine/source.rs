//! A queued source reports its own position and start/end, independently of Sink's
//! position (which can already belong to the next track when the worker polls).
use super::WorkerEvent;
use rodio::Source;
use std::sync::{
    atomic::{AtomicU64, AtomicU8, Ordering},
    mpsc, Arc, Weak,
};
use std::time::Duration;

// Every queued track is already converted to the device format. Rodio's queue
// otherwise reports the *old* source's format until next() crosses a boundary
// (and reports mono/44.1 kHz silence while idle). Keep the mixer's view constant.
pub(super) struct Output {
    pub input: rodio::queue::SourcesQueueOutput,
    pub channels: u16,
    pub rate: u32,
}

impl Iterator for Output {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        self.input.next()
    }
}

impl Source for Output {
    fn current_span_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> u16 {
        self.channels
    }
    fn sample_rate(&self) -> u32 {
        self.rate
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

const PENDING: u8 = 0;
const STARTED: u8 = 1;
const FINISHED: u8 = 2;
const CANCELLED: u8 = 3;

pub(super) struct Progress {
    status: AtomicU8,
    samples: AtomicU64,
    samples_per_second: u64,
    offset: Duration,
}

impl Progress {
    pub fn started(&self) -> bool {
        matches!(self.status.load(Ordering::Acquire), STARTED | FINISHED)
    }

    pub fn finished(&self) -> bool {
        self.status.load(Ordering::Acquire) == FINISHED
    }

    // Linearize cancellation against the audio thread starting this source. If
    // it already started, the worker must promote it before editing the queue.
    pub fn cancel_pending(&self) -> bool {
        self.status
            .compare_exchange(PENDING, CANCELLED, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn position(&self) -> f64 {
        self.offset.as_secs_f64()
            + self.samples.load(Ordering::Relaxed) as f64 / self.samples_per_second as f64
    }
}

pub(super) struct Tracked<S> {
    input: S,
    progress: Arc<Progress>,
    wake: Weak<mpsc::Sender<WorkerEvent>>,
    started: bool,
    samples: u64,
}

impl<S: Source<Item = f32>> Tracked<S> {
    pub fn new(
        input: S,
        offset: Duration,
        wake: Weak<mpsc::Sender<WorkerEvent>>,
    ) -> (Self, Arc<Progress>) {
        let progress = Arc::new(Progress {
            status: AtomicU8::new(PENDING),
            samples: AtomicU64::new(0),
            samples_per_second: input.sample_rate() as u64 * input.channels() as u64,
            offset,
        });
        (
            Self {
                input,
                progress: progress.clone(),
                wake,
                started: false,
                samples: 0,
            },
            progress,
        )
    }

    fn notify(&self) {
        if let Some(tx) = self.wake.upgrade() {
            let _ = tx.send(WorkerEvent::Boundary);
        }
    }
}

impl<S: Source<Item = f32>> Iterator for Tracked<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if !self.started {
            self.progress
                .status
                .compare_exchange(PENDING, STARTED, Ordering::AcqRel, Ordering::Acquire)
                .ok()?;
            self.started = true;
            self.notify();
        }
        match self.input.next() {
            Some(sample) => {
                self.samples += 1;
                self.progress.samples.store(self.samples, Ordering::Relaxed);
                Some(sample)
            }
            None => {
                if self.progress.status.swap(FINISHED, Ordering::AcqRel) != FINISHED {
                    self.notify();
                }
                None
            }
        }
    }
}

impl<S: Source<Item = f32>> Source for Tracked<S> {
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
}
