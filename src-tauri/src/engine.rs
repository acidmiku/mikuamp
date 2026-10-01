use crate::{
    dsp::{EqSettings, Processed},
    library::Track,
    resampler::Resampled,
};
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
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
pub struct Engine {
    tx: mpsc::Sender<Message>,
    pub snapshot: Arc<Mutex<Snapshot>>,
    pub eq: Arc<Mutex<EqSettings>>,
}
struct Player {
    stream: Option<OutputStream>,
    sink: Option<Sink>,
    tracks: Vec<Track>,
    state: Snapshot,
    eq: Arc<Mutex<EqSettings>>,
    spectrum: Arc<Mutex<Vec<f32>>>,
}
impl Player {
    fn play(&mut self, index: usize) -> Result<(), String> {
        let track = self.tracks.get(index).ok_or("Choose a track first")?;
        let decoder = Decoder::try_from(
            File::open(&track.path).map_err(|e| format!("Cannot open {}: {e}", track.title))?,
        )
        .map_err(|e| format!("Cannot decode {}: {e}", track.title))?;
        if self.stream.is_none() {
            let mut stream = OutputStreamBuilder::open_default_stream()
                .map_err(|e| format!("Audio output unavailable: {e}"))?;
            stream.log_on_drop(false);
            self.state.output_rate = stream.config().sample_rate();
            self.stream = Some(stream);
        }
        if let Some(sink) = self.sink.take() {
            sink.stop()
        }
        let sink = Sink::connect_new(self.stream.as_ref().unwrap().mixer());
        sink.set_volume(self.state.volume);
        sink.append(Resampled::new(
            Processed::new(decoder, self.eq.clone(), self.spectrum.clone()),
            self.state.output_rate,
        ));
        self.sink = Some(sink);
        self.state.index = Some(index);
        self.state.position = 0.;
        self.state.playing = true;
        self.state.error = None;
        Ok(())
    }
    fn advance(&mut self, automatic: bool) -> Result<(), String> {
        if self.tracks.is_empty() {
            return Ok(());
        }
        let current = self.state.index.unwrap_or(0);
        let next = if automatic && self.state.repeat == "one" {
            current
        } else if self.state.shuffle && self.tracks.len() > 1 {
            let offset = rand::random_range(1..self.tracks.len());
            (current + offset) % self.tracks.len()
        } else if current + 1 < self.tracks.len() {
            current + 1
        } else if self.state.repeat == "all" || !automatic {
            0
        } else {
            self.state.playing = false;
            self.state.position = 0.;
            return Ok(());
        };
        self.play(next)
    }
    fn handle(&mut self, command: Command) -> Result<(), String> {
        match command {
            Command::Queue(tracks, replace) => {
                if replace {
                    self.handle(Command::Clear)?;
                }
                self.tracks.extend(tracks);
                self.state.queue = self.tracks.iter().map(|t| t.id.clone()).collect();
            }
            Command::Play(index) => {
                if let Some(i) = index {
                    return self.play(i);
                }
                if self.sink.as_ref().is_some_and(|s| !s.empty()) {
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
                if let Some(s) = self.sink.take() {
                    s.stop()
                }
                self.state.position = 0.;
                self.state.playing = false;
            }
            Command::Next => self.advance(false)?,
            Command::Previous => {
                if self.state.position > 3. {
                    self.handle(Command::Seek(0.))?
                } else if !self.tracks.is_empty() {
                    self.play(self.state.index.unwrap_or(0).saturating_sub(1))?;
                }
            }
            Command::Seek(seconds) => {
                if !seconds.is_finite() || seconds < 0. {
                    return Err("Invalid seek position".into());
                }
                if let Some(s) = &self.sink {
                    s.try_seek(Duration::from_secs_f64(seconds))
                        .map_err(|e| format!("Seek unavailable: {e}"))?;
                    self.state.position = seconds;
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
            Command::Shuffle(v) => self.state.shuffle = v,
            Command::Repeat(v) => {
                if !["off", "all", "one"].contains(&v.as_str()) {
                    return Err("Invalid repeat mode".into());
                }
                self.state.repeat = v;
            }
            Command::Remove(i) => {
                if i >= self.tracks.len() {
                    return Err("Track no longer in queue".into());
                }
                if self.state.index == Some(i) {
                    self.handle(Command::Stop)?;
                    self.state.index = None;
                } else if self.state.index.is_some_and(|n| n > i) {
                    self.state.index = self.state.index.map(|n| n - 1);
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
        let (tx, rx) = mpsc::channel::<Message>();
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
                    tracks,
                    state: saved,
                    eq: shared_eq,
                    spectrum: Arc::new(Mutex::new(vec![0.; 32])),
                };
                loop {
                    match rx.recv_timeout(Duration::from_millis(30)) {
                        Ok(message) => {
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
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    if player.state.playing {
                        if let Some(s) = &player.sink {
                            player.state.position = s.get_pos().as_secs_f64();
                        }
                        if player.sink.as_ref().is_some_and(|s| s.empty()) {
                            if let Err(e) = player.advance(true) {
                                player.state.playing = false;
                                player.state.error = Some(e);
                            }
                        }
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
            .send(Message { command, reply: tx })
            .map_err(|_| "Audio worker stopped")?;
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Audio command timed out")?
    }
}
