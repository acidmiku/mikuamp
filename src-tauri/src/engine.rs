use crate::{
    dsp::{EqSettings, Processed},
    library::Track,
    resampler::Resampled,
};
mod source;
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};
use serde::{Deserialize, Serialize};
use source::{Output, Progress, Tracked};
use std::{
    collections::VecDeque,
    fs::{self, File},
    io::BufReader,
    path::PathBuf,
    sync::{mpsc, Arc, Mutex, Weak},
    thread,
    time::Duration,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub queue: Vec<String>,
    pub index: Option<usize>,
    pub playing: bool,
    pub position: f64,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: String,
    pub spectrum: Vec<f32>,
    pub output_rate: u32,
    pub error: Option<String>,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            queue: vec![],
            index: None,
            playing: false,
            position: 0.,
            volume: 0.65,
            shuffle: false,
            repeat: "off".into(),
            spectrum: vec![0.; 32],
            output_rate: 0,
            error: None,
        }
    }
}
pub enum Command {
    Queue(Vec<Track>, bool),
    Play(Option<usize>),
    Pause,
    Stop,
    Next,
    Previous,
    Seek(f64),
    Volume(f32),
    Shuffle(bool),
    Repeat(String),
    Remove(usize),
    Clear,
    ClearError,
}
pub struct Message {
    pub command: Command,
    pub reply: mpsc::Sender<Result<(), String>>,
}
enum WorkerEvent {
    Command(Message),
    Boundary,
}
pub struct Engine {
    tx: Arc<mpsc::Sender<WorkerEvent>>,
    pub snapshot: Arc<Mutex<Snapshot>>,
    pub eq: Arc<Mutex<EqSettings>>,
}
struct QueuedTrack {
    index: usize,
    progress: Arc<Progress>,
    planned: bool,
}

type AudioSource = Resampled<Processed<Decoder<BufReader<File>>>>;

struct Player {
    stream: Option<OutputStream>,
    sink: Option<Sink>,
    output_channels: u16,
    queued: VecDeque<QueuedTrack>,
    wake: Weak<mpsc::Sender<WorkerEvent>>,
    tracks: Vec<Track>,
    state: Snapshot,
    eq: Arc<Mutex<EqSettings>>,
    spectrum: Arc<Mutex<Vec<f32>>>,
}
impl Player {
    fn prepare(&self, index: usize, offset: Duration) -> Result<(AudioSource, Duration), String> {
        let track = self.tracks.get(index).ok_or("Choose a track first")?;
        // Rodio's File decoder enables Symphonia's gapless delay/padding trimming
        // and supplies byte length for accurate duration and seeking.
        let decoder = Decoder::try_from(
            File::open(&track.path).map_err(|e| format!("Cannot open {}: {e}", track.title))?,
        )
        .map_err(|e| format!("Cannot decode {}: {e}", track.title))?;
        let mut source = Resampled::new(
            Processed::new(decoder, self.eq.clone(), self.spectrum.clone()),
            self.state.output_rate,
        );
        let offset = source
            .total_duration()
            .map_or(offset, |end| offset.min(end));
        if !offset.is_zero() {
            source
                .try_seek(offset)
                .map_err(|e| format!("Seek unavailable: {e}"))?;
        }
        Ok((source, offset))
    }

    fn ensure_output(&mut self) -> Result<(), String> {
        if self.sink.is_none() {
            let mut stream = OutputStreamBuilder::open_default_stream()
                .map_err(|e| format!("Audio output unavailable: {e}"))?;
            stream.log_on_drop(false);
            self.state.output_rate = stream.config().sample_rate();
            self.output_channels = stream.config().channel_count();
            let (sink, input) = Sink::new();
            stream.mixer().add(Output {
                input,
                channels: self.output_channels,
                rate: self.state.output_rate,
            });
            sink.set_volume(self.state.volume);
            self.stream = Some(stream);
            self.sink = Some(sink);
        }
        Ok(())
    }

    fn append(&mut self, index: usize, source: AudioSource, offset: Duration) {
        let source = rodio::source::UniformSourceIterator::new(
            source,
            self.output_channels,
            self.state.output_rate,
        );
        let (source, progress) = Tracked::new(source, offset, self.wake.clone());
        self.queued.push_back(QueuedTrack {
            index,
            progress,
            planned: false,
        });
        self.sink.as_ref().unwrap().append(source);
    }

    // Only explicit transport actions flush the sink. Natural boundaries are
    // handled by Rodio's source queue, without waiting for this worker.
    fn flush(&mut self) {
        if let Some(sink) = &self.sink {
            sink.clear();
        }
        self.queued.clear();
    }

    fn start(&mut self, index: usize, offset: Duration, playing: bool) -> Result<(), String> {
        self.tracks.get(index).ok_or("Choose a track first")?;
        self.ensure_output()?;
        let (source, offset) = self.prepare(index, offset)?;
        self.flush();
        self.state.index = Some(index);
        self.state.position = offset.as_secs_f64();
        self.state.playing = playing;
        self.state.error = None;
        self.append(index, source, offset);
        // clear() paused the sink: both sources are ready before playback starts.
        self.preload();
        if playing {
            self.sink.as_ref().unwrap().play();
        }
        Ok(())
    }

    fn play(&mut self, index: usize) -> Result<(), String> {
        self.start(index, Duration::ZERO, true)
    }

    fn next_index(&self, current: usize, automatic: bool) -> Option<usize> {
        if self.tracks.is_empty() {
            None
        } else if automatic && self.state.repeat == "one" {
            Some(current)
        } else if self.state.shuffle && self.tracks.len() > 1 {
            let offset = rand::random_range(1..self.tracks.len());
            Some((current + offset) % self.tracks.len())
        } else if current + 1 < self.tracks.len() {
            Some(current + 1)
        } else if self.state.repeat == "all" || !automatic {
            Some(0)
        } else {
            None
        }
    }

    fn advance(&mut self) -> Result<(), String> {
        // Reuse the preselected shuffle destination for manual Next, except
        // repeat-one, which only repeats on natural completion.
        let next = self
            .queued
            .get(1)
            .filter(|_| self.state.repeat != "one")
            .map(|track| track.index)
            .or_else(|| self.next_index(self.state.index.unwrap_or(0), false));
        if let Some(index) = next {
            self.play(index)?;
        }
        Ok(())
    }

    fn sync_playback(&mut self) {
        while self
            .queued
            .get(1)
            .is_some_and(|track| track.progress.started())
        {
            self.queued.pop_front();
        }
        if let Some(track) = self.queued.front() {
            self.state.index = Some(track.index);
            self.state.position = track.progress.position();
            if self.queued.len() == 1 && track.planned && track.progress.finished() {
                self.queued.clear();
                self.state.playing = false;
                self.state.position = 0.;
            }
        }
    }

    fn preload(&mut self) {
        if self.queued.len() != 1 {
            return;
        }
        let track = self.queued.front_mut().unwrap();
        if track.planned {
            return;
        }
        // Also records a failed preload or end of queue, avoiding a retry loop.
        track.planned = true;
        let current = track.index;
        if let Some(index) = self.next_index(current, true) {
            match self.prepare(index, Duration::ZERO) {
                Ok((source, offset)) => self.append(index, source, offset),
                // Let the current track finish; never cut it off on preload failure.
                Err(error) => self.state.error = Some(error),
            }
        }
    }

    fn invalidate_pending(&mut self) {
        self.sync_playback();
        if let Some(next) = self.queued.get(1) {
            if next.progress.cancel_pending() {
                self.queued.pop_back();
            } else {
                // The output thread won the race: this is now the current track.
                self.sync_playback();
            }
        }
        if let Some(current) = self.queued.front_mut() {
            current.planned = false;
        }
    }

    fn refresh(&mut self) {
        self.sync_playback();
        self.preload();
        self.sync_playback();
    }
    fn handle(&mut self, command: Command) -> Result<(), String> {
        self.sync_playback();
        match command {
            Command::Queue(tracks, replace) => {
                if replace {
                    self.handle(Command::Clear)?;
                }
                self.invalidate_pending();
                self.tracks.extend(tracks);
                self.state.queue = self.tracks.iter().map(|t| t.id.clone()).collect();
            }
            Command::Play(index) => {
                if let Some(i) = index {
                    return self.play(i);
                }
                if !self.queued.is_empty() {
                    self.sink.as_ref().unwrap().play();
                    self.state.playing = true;
                } else {
                    self.play(self.state.index.unwrap_or(0))?;
                }
            }
            Command::Pause => {
                if let Some(s) = &self.sink {
                    s.pause()
                }
                self.state.playing = false;
            }
            Command::Stop => {
                self.flush();
                self.state.position = 0.;
                self.state.playing = false;
            }
            Command::Next => self.advance()?,
            Command::Previous => {
                if self.state.position > 3. {
                    self.handle(Command::Seek(0.))?
                } else if !self.tracks.is_empty() {
                    self.play(self.state.index.unwrap_or(0).saturating_sub(1))?;
                }
            }
            Command::Seek(seconds) => {
                let offset =
                    Duration::try_from_secs_f64(seconds).map_err(|_| "Invalid seek position")?;
                if let Some(index) = self.queued.front().map(|track| track.index) {
                    self.start(index, offset, self.state.playing)?;
                }
            }
            Command::Volume(v) => {
                if !v.is_finite() {
                    return Err("Invalid volume".into());
                }
                self.state.volume = v.clamp(0., 1.);
                if let Some(s) = &self.sink {
                    s.set_volume(self.state.volume)
                }
            }
            Command::Shuffle(v) => {
                self.invalidate_pending();
                self.state.shuffle = v;
            }
            Command::Repeat(v) => {
                if !["off", "all", "one"].contains(&v.as_str()) {
                    return Err("Invalid repeat mode".into());
                }
                self.invalidate_pending();
                self.state.repeat = v;
            }
            Command::Remove(i) => {
                if i >= self.tracks.len() {
                    return Err("Track no longer in queue".into());
                }
                self.invalidate_pending();
                if self.state.index == Some(i) {
                    self.handle(Command::Stop)?;
                    self.state.index = None;
                } else if self.state.index.is_some_and(|n| n > i) {
                    self.state.index = self.state.index.map(|n| n - 1);
                    if let Some(current) = self.queued.front_mut() {
                        current.index -= 1;
                    }
                }
                self.tracks.remove(i);
                self.state.queue.remove(i);
            }
            Command::Clear => {
                self.handle(Command::Stop)?;
                self.tracks.clear();
                self.state.queue.clear();
                self.state.index = None;
            }
            Command::ClearError => self.state.error = None,
        }
        self.preload();
        Ok(())
    }
}
impl Engine {
    pub fn new(eq_settings: EqSettings, library: &[Track], state_path: PathBuf) -> Self {
        let mut saved: Snapshot = fs::read(&state_path)
            .ok()
            .and_then(|s| serde_json::from_slice(&s).ok())
            .unwrap_or_default();
        let tracks = saved
            .queue
            .iter()
            .filter_map(|id| library.iter().find(|t| &t.id == id).cloned())
            .collect::<Vec<_>>();
        saved.queue = tracks.iter().map(|t| t.id.clone()).collect();
        saved.index = saved.index.filter(|i| *i < tracks.len());
        saved.playing = false;
        saved.position = 0.;
        saved.output_rate = 0;
        saved.error = None;
        saved.spectrum = vec![0.; 32];
        saved.volume = saved.volume.clamp(0., 1.);
        let (tx, rx) = mpsc::channel::<WorkerEvent>();
        let tx = Arc::new(tx);
        let wake = Arc::downgrade(&tx);
        let snapshot = Arc::new(Mutex::new(Snapshot::default()));
        let eq = Arc::new(Mutex::new(eq_settings));
        let shared = snapshot.clone();
        let shared_eq = eq.clone();
        thread::Builder::new()
            .name("mikuamp-audio".into())
            .spawn(move || {
                let mut player = Player {
                    stream: None,
                    sink: None,
                    output_channels: 0,
                    queued: VecDeque::new(),
                    wake,
                    tracks,
                    state: saved,
                    eq: shared_eq,
                    spectrum: Arc::new(Mutex::new(vec![0.; 32])),
                };
                loop {
                    match rx.recv_timeout(Duration::from_millis(30)) {
                        Ok(WorkerEvent::Command(message)) => {
                            let result = player.handle(message.command);
                            if let Err(e) = &result {
                                player.state.error = Some(e.clone());
                            }
                            *shared.lock().unwrap() = player.state.clone();
                            if let Ok(bytes) = serde_json::to_vec(&player.state) {
                                let tmp = state_path.with_extension("tmp");
                                if fs::write(&tmp, bytes).is_ok() {
                                    let _ = fs::rename(tmp, &state_path);
                                }
                            }
                            let _ = message.reply.send(result);
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Ok(WorkerEvent::Boundary) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    player.refresh();
                    if player.state.playing {
                        player.state.spectrum = player.spectrum.lock().unwrap().clone();
                    } else {
                        player.state.spectrum.iter_mut().for_each(|v| *v *= 0.7);
                    }
                    *shared.lock().unwrap() = player.state.clone();
                }
            })
            .expect("start audio worker");
        Self { tx, snapshot, eq }
    }
    pub fn send(&self, command: Command) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(WorkerEvent::Command(Message { command, reply: tx }))
            .map_err(|_| "Audio worker stopped")?;
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Audio command timed out")?
    }
}

#[cfg(test)]
mod tests;
