use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

// Real WAV decoders -> DSP -> resampler -> Sink -> device-format mixer, driven
// without an audio device or wall-clock sleeps at natural track boundaries.
struct Harness {
    player: Player,
    output: Option<rodio::mixer::MixerSource>,
    events: mpsc::Receiver<WorkerEvent>,
    _tx: Arc<mpsc::Sender<WorkerEvent>>,
    directory: PathBuf,
}

impl Harness {
    fn new(formats: &[(u32, u16, usize, i16)], rate: u32, channels: u16) -> Self {
        let directory = std::env::temp_dir().join(format!(
            "mikuamp-gapless-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(&directory).unwrap();
        let tracks = formats
            .iter()
            .enumerate()
            .map(|(i, &(rate, channels, frames, value))| {
                let path = directory.join(format!("{i}.wav"));
                let samples = frames * channels as usize;
                let data_size = (samples * 2) as u32;
                let mut wav = Vec::new();
                wav.extend_from_slice(b"RIFF");
                wav.extend_from_slice(&(36 + data_size).to_le_bytes());
                wav.extend_from_slice(b"WAVEfmt ");
                wav.extend_from_slice(&16_u32.to_le_bytes());
                wav.extend_from_slice(&1_u16.to_le_bytes());
                wav.extend_from_slice(&channels.to_le_bytes());
                wav.extend_from_slice(&rate.to_le_bytes());
                wav.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
                wav.extend_from_slice(&(channels * 2).to_le_bytes());
                wav.extend_from_slice(&16_u16.to_le_bytes());
                wav.extend_from_slice(b"data");
                wav.extend_from_slice(&data_size.to_le_bytes());
                for _ in 0..samples {
                    wav.extend_from_slice(&value.to_le_bytes());
                }
                fs::write(&path, wav).unwrap();
                Track {
                    id: i.to_string(),
                    path: path.to_string_lossy().into_owned(),
                    title: format!("Track {i}"),
                    artist: String::new(),
                    album: String::new(),
                    album_artist: String::new(),
                    duration: frames as f64 / rate as f64,
                    format: "WAV".into(),
                    bitrate: 0,
                    sample_rate: rate,
                    bit_depth: 16,
                    channels: channels as u8,
                    track_number: i as u32 + 1,
                    disc_number: 1,
                    cover: None,
                    quality: "SQ".into(),
                }
            })
            .collect::<Vec<_>>();
        let (sink, input) = Sink::new();
        let (mixer, output) = rodio::mixer::mixer(channels, rate);
        mixer.add(Output {
            input,
            channels,
            rate,
        });
        let (tx, events) = mpsc::channel();
        let tx = Arc::new(tx);
        let player = Player {
            stream: None,
            sink: Some(sink),
            output_channels: channels,
            queued: VecDeque::new(),
            wake: Arc::downgrade(&tx),
            state: Snapshot {
                queue: tracks.iter().map(|t| t.id.clone()).collect(),
                volume: 1.,
                output_rate: rate,
                ..Snapshot::default()
            },
            tracks,
            eq: Arc::new(Mutex::new(EqSettings::default())),
            spectrum: Arc::new(Mutex::new(vec![0.; 32])),
        };
        Self {
            player,
            output: Some(output),
            events,
            _tx: tx,
            directory,
        }
    }

    fn start(&mut self, index: usize) {
        self.player.handle(Command::Play(Some(index))).unwrap();
    }

    fn render(&mut self, samples: usize) -> Vec<f32> {
        self.output.as_mut().unwrap().take(samples).collect()
    }

    fn boundaries(&mut self) {
        // Ignore stale wakeups, just as the worker does after seek/skip/clear.
        while self.events.try_recv().is_ok() {
            self.player.refresh();
        }
    }

    fn render_with_boundaries(&mut self, samples: usize) -> Vec<f32> {
        (0..samples)
            .map(|_| {
                let sample = self.output.as_mut().unwrap().next().unwrap();
                self.boundaries();
                sample
            })
            .collect()
    }

    fn command(&mut self, command: Command) -> Result<(), String> {
        // Explicit transport flushes wait for the output callback. Run that
        // callback concurrently, as CPAL does, only for these control tests.
        let running = AtomicBool::new(true);
        let mut output = self.output.take().unwrap();
        let (result, output) = thread::scope(|scope| {
            let render = scope.spawn(|| {
                while running.load(Ordering::Acquire) {
                    output.next();
                    thread::sleep(Duration::from_micros(20));
                }
                output
            });
            let result = self.player.handle(command);
            running.store(false, Ordering::Release);
            (result, render.join().unwrap())
        });
        self.output = Some(output);
        self.boundaries();
        result
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.output.take();
        self.player.sink.take();
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn consecutive_tracks_have_no_missing_duplicate_or_silent_samples_without_worker_polling() {
    // Both tracks are much shorter than the old 30 ms worker interval.
    let mut h = Harness::new(&[(8000, 2, 37, 8192), (8000, 2, 53, -16384)], 8000, 2);
    h.start(0);
    assert_eq!(h.player.state.index, Some(0)); // Preloading must not advance the UI.
    assert_eq!(h.render(74), vec![0.25; 74]);
    h.player.sync_playback();
    assert_eq!(h.player.state.index, Some(0));
    assert_eq!(h.render(2), vec![-0.5; 2]);
    h.player.sync_playback();
    assert_eq!(h.player.state.index, Some(1));
    assert_eq!(h.player.state.position, 1. / 8000.);
    assert_eq!(h.render(104), vec![-0.5; 104]);
    h.boundaries();
    assert_eq!(h.render(1), vec![0.]);
    h.boundaries();
    assert!(!h.player.state.playing);
    assert_eq!(h.player.state.index, Some(1));
    assert_eq!(h.player.state.position, 0.);
}

#[test]
fn mixed_rates_and_channels_match_individually_processed_sources_exactly() {
    let mut h = Harness::new(
        &[
            (44100, 1, 441, 8192),
            (96000, 2, 960, -16384),
            (48000, 1, 480, 4096),
        ],
        48000,
        2,
    );
    let expected = (0..3)
        .flat_map(|index| {
            rodio::source::UniformSourceIterator::new(
                h.player.prepare(index, Duration::ZERO).unwrap().0,
                2,
                48000,
            )
            .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    h.start(0);
    assert_eq!(h.render_with_boundaries(expected.len()), expected);
    assert_eq!(h.player.state.index, Some(2));
    assert!(h.player.state.position <= 0.0101);
}

#[test]
fn repeat_one_and_all_cross_boundaries_and_reset_position() {
    for mode in ["one", "all"] {
        let mut h = Harness::new(&[(8000, 1, 17, 8192), (8000, 1, 23, -16384)], 8000, 1);
        h.player.handle(Command::Repeat(mode.into())).unwrap();
        h.start(1);
        let expected = if mode == "one" {
            vec![-0.5; 47]
        } else {
            [vec![-0.5; 23], vec![0.25; 17], vec![-0.5; 7]].concat()
        };
        assert_eq!(h.render_with_boundaries(expected.len()), expected);
        assert_eq!(h.player.state.index, Some(1));
        h.player.sync_playback();
        assert_eq!(
            h.player.state.position,
            if mode == "one" {
                1. / 8000.
            } else {
                7. / 8000.
            }
        );
        assert!(h.player.state.playing);
    }
}

#[test]
fn repeat_changes_cancel_the_old_successor_without_interrupting_current_audio() {
    let mut h = Harness::new(&[(8000, 1, 100, 8192), (8000, 1, 100, -16384)], 8000, 1);
    h.start(0);
    assert_eq!(h.render(10), vec![0.25; 10]);
    h.player.handle(Command::Repeat("one".into())).unwrap();
    assert_eq!(h.render_with_boundaries(100), vec![0.25; 100]);
    h.player.handle(Command::Repeat("off".into())).unwrap();
    assert_eq!(h.render(90), vec![0.25; 90]);
    assert_eq!(h.render(10), vec![-0.5; 10]);
    h.player.sync_playback();
    assert_eq!(h.player.state.index, Some(1));
}

#[test]
fn removing_pending_and_earlier_entries_preserves_current_identity() {
    let mut h = Harness::new(
        &[
            (8000, 1, 100, 8192),
            (8000, 1, 100, -16384),
            (8000, 1, 100, 4096),
        ],
        8000,
        1,
    );
    h.start(0);
    h.player.handle(Command::Remove(1)).unwrap();
    assert_eq!(h.render(100), vec![0.25; 100]);
    assert_eq!(h.render(1), vec![0.125]);
    // The callback has crossed the boundary, but the worker has not seen it.
    h.player.handle(Command::Remove(0)).unwrap();
    assert_eq!(h.player.state.index, Some(0));
    assert_eq!(h.player.state.queue, vec!["2"]);
    assert_eq!(h.render(99), vec![0.125; 99]);
}

#[test]
fn removal_after_boundary_stops_the_actual_current_track() {
    let mut h = Harness::new(&[(8000, 1, 100, 8192), (8000, 1, 8000, -16384)], 8000, 1);
    h.start(0);
    h.render(101);
    h.command(Command::Remove(1)).unwrap();
    assert!(!h.player.state.playing);
    assert_eq!(h.player.state.index, None);
    assert!(h.player.queued.is_empty());
    assert!(h.render(1000).iter().all(|&s| s == 0.));
}

#[test]
fn pause_seek_manual_skip_previous_stop_and_clear_keep_one_sink() {
    let mut h = Harness::new(&[(8000, 1, 48000, 8192), (8000, 1, 48000, -16384)], 8000, 1);
    h.start(0);
    let sink = h.player.sink.as_ref().unwrap() as *const Sink;
    h.render(100);
    h.command(Command::Pause).unwrap();
    h.render(100); // let Sink's 5 ms controls take effect
    h.player.sync_playback();
    let paused = h.player.state.position;
    assert!(h.render(200).iter().all(|&s| s == 0.));
    h.player.sync_playback();
    assert_eq!(h.player.state.position, paused);
    h.command(Command::Seek(4.)).unwrap();
    assert!(!h.player.state.playing);
    assert_eq!(h.player.state.position, 4.);
    assert!(h.render(100).iter().all(|&s| s == 0.));
    h.command(Command::Previous).unwrap(); // restart after 3 seconds, stay paused
    assert_eq!(h.player.state.index, Some(0));
    assert_eq!(h.player.state.position, 0.);
    assert!(!h.player.state.playing);
    h.command(Command::Play(None)).unwrap();
    h.render(100);
    assert!(h.player.state.playing);
    h.command(Command::Repeat("one".into())).unwrap();
    h.command(Command::Next).unwrap(); // manual skip overrides repeat-one
    assert_eq!(h.player.state.index, Some(1));
    // An explicit flush may leave Rodio's short idle-silence block. Unlike a
    // natural boundary, manual transport is allowed to discard buffered audio.
    assert!(h.render(1024).iter().all(|&s| s == 0. || s == -0.5));
    assert_eq!(h.render(100), vec![-0.5; 100]);
    h.command(Command::Next).unwrap(); // manual Next wraps even with repeat-one
    assert_eq!(h.player.state.index, Some(0));
    h.command(Command::Play(Some(1))).unwrap();
    h.command(Command::Previous).unwrap();
    assert_eq!(h.player.state.index, Some(0));
    h.command(Command::Stop).unwrap();
    assert!(!h.player.state.playing);
    assert_eq!(h.player.state.position, 0.);
    h.command(Command::Play(None)).unwrap();
    h.command(Command::Clear).unwrap();
    assert!(h.player.state.queue.is_empty());
    assert!(h.player.queued.is_empty());
    assert_eq!(h.player.state.index, None);
    assert!(!h.player.state.playing);
    assert!(h.render(1000).iter().all(|&s| s == 0.));
    assert_eq!(h.player.sink.as_ref().unwrap() as *const Sink, sink);
}

#[test]
fn shuffle_preloads_a_different_track_and_manual_next_uses_that_selection() {
    let mut h = Harness::new(
        &[
            (8000, 1, 8000, 8192),
            (8000, 1, 8000, -16384),
            (8000, 1, 8000, 4096),
        ],
        8000,
        1,
    );
    h.player.handle(Command::Shuffle(true)).unwrap();
    h.start(0);
    let selected = h.player.queued[1].index;
    assert_ne!(selected, 0);
    h.command(Command::Next).unwrap();
    assert_eq!(h.player.state.index, Some(selected));
    h.player.handle(Command::Shuffle(false)).unwrap();
    assert_eq!(
        h.player.queued.get(1).map(|t| t.index),
        (selected + 1 < 3).then_some(selected + 1)
    );
    h.player.handle(Command::Repeat("one".into())).unwrap();
    h.player.handle(Command::Shuffle(true)).unwrap();
    assert_eq!(h.player.queued[1].index, selected);
}

#[test]
fn failed_preload_finishes_current_track_and_invalid_seek_keeps_audio() {
    let mut h = Harness::new(&[(8000, 1, 100, 8192), (8000, 1, 100, -16384)], 8000, 1);
    fs::remove_file(&h.player.tracks[1].path).unwrap();
    h.start(0);
    assert!(h
        .player
        .state
        .error
        .as_ref()
        .unwrap()
        .contains("Cannot open Track 1"));
    for pos in [-1., f64::NAN, f64::INFINITY, f64::MAX] {
        assert!(h.player.handle(Command::Seek(pos)).is_err());
    }
    assert_eq!(h.render(100), vec![0.25; 100]);
    h.render(1);
    h.boundaries();
    assert!(!h.player.state.playing);
    assert!(h.player.queued.is_empty());
}

#[test]
fn appending_to_active_queue_preloads_but_replacing_or_restoring_does_not_autoplay() {
    let mut h = Harness::new(&[(8000, 1, 8000, 8192), (8000, 1, 8000, -16384)], 8000, 1);
    let next = h.player.tracks.pop().unwrap();
    h.player.state.queue.pop();
    h.start(0);
    h.player
        .handle(Command::Queue(vec![next.clone()], false))
        .unwrap();
    assert_eq!(h.player.queued[1].index, 1);
    h.command(Command::Queue(vec![next.clone()], true)).unwrap();
    assert!(!h.player.state.playing);
    assert!(h.player.queued.is_empty());
    let saved = Snapshot {
        queue: vec![next.id.clone()],
        index: Some(0),
        playing: true,
        position: 12.,
        ..Snapshot::default()
    };
    let path = h.directory.join("session.json");
    fs::write(&path, serde_json::to_vec(&saved).unwrap()).unwrap();
    let engine = Engine::new(EqSettings::default(), &[next], path);
    engine.send(Command::ClearError).unwrap();
    let state = engine.snapshot.lock().unwrap().clone();
    assert!(!state.playing);
    assert_eq!(state.index, Some(0));
    assert_eq!(state.position, 0.);
    assert_eq!(state.output_rate, 0); // no output device was opened
}

#[test]
fn single_track_repeat_and_duplicate_queue_entries_use_playback_instances() {
    for mode in ["one", "all"] {
        let mut h = Harness::new(&[(8000, 1, 13, 8192)], 8000, 1);
        h.player.handle(Command::Repeat(mode.into())).unwrap();
        h.start(0);
        assert_eq!(h.render_with_boundaries(40), vec![0.25; 40]);
        h.player.sync_playback();
        assert_eq!(h.player.state.index, Some(0));
        assert_eq!(h.player.state.position, 1. / 8000.);
    }
    let mut h = Harness::new(&[(8000, 1, 13, 8192)], 8000, 1);
    h.player
        .handle(Command::Queue(vec![h.player.tracks[0].clone()], false))
        .unwrap();
    h.start(0);
    assert_eq!(h.render(14), vec![0.25; 14]);
    h.player.sync_playback();
    assert_eq!(h.player.state.index, Some(1));
    assert_eq!(h.player.state.position, 1. / 8000.);
}

#[test]
fn seek_after_unobserved_boundary_targets_the_new_track_and_clamps_to_end() {
    let mut h = Harness::new(&[(8000, 1, 13, 8192), (8000, 1, 8000, -16384)], 8000, 1);
    h.start(0);
    h.render(14);
    h.command(Command::Pause).unwrap();
    h.command(Command::Seek(0.5)).unwrap();
    assert_eq!(h.player.state.index, Some(1));
    assert_eq!(h.player.state.position, 0.5);
    assert!(!h.player.state.playing);
    h.command(Command::Seek(999.)).unwrap();
    assert_eq!(h.player.state.position, 1.);
    h.command(Command::Play(None)).unwrap();
    h.render(1024);
    h.boundaries();
    assert!(!h.player.state.playing);
    assert!(h.player.queued.is_empty());
}

#[test]
fn preloaded_source_observes_live_eq_and_publishes_spectrum() {
    let mut h = Harness::new(&[(48000, 2, 100, 8192), (48000, 2, 12000, 8192)], 48000, 2);
    h.start(0);
    assert_eq!(h.render(200), vec![0.25; 200]);
    {
        let mut eq = h.player.eq.lock().unwrap();
        eq.enabled = true;
        eq.preamp = -6.;
    }
    let output = h.render(20000);
    let expected = 0.25 * 10_f32.powf(-6. / 20.);
    assert!((output.last().unwrap() - expected).abs() < 0.0001);
    assert!(h
        .player
        .spectrum
        .lock()
        .unwrap()
        .iter()
        .any(|&bar| bar > 0.));
}

#[test]
fn pending_cancellation_cannot_cancel_a_source_that_has_started() {
    let (tx, rx) = mpsc::channel();
    let tx = Arc::new(tx);
    let (mut source, progress) = Tracked::new(
        rodio::buffer::SamplesBuffer::new(1, 8000, vec![0.25; 2]),
        Duration::ZERO,
        Arc::downgrade(&tx),
    );
    assert!(!progress.started());
    assert_eq!(source.next(), Some(0.25));
    assert!(!progress.cancel_pending());
    assert_eq!(source.next(), Some(0.25));
    assert_eq!(source.next(), None);
    assert!(progress.finished());
    assert_eq!(rx.try_iter().count(), 2); // one start, one end

    let (mut source, progress) = Tracked::new(
        rodio::buffer::SamplesBuffer::new(1, 8000, vec![0.5; 2]),
        Duration::ZERO,
        Arc::downgrade(&tx),
    );
    assert!(progress.cancel_pending());
    assert_eq!(source.next(), None);
    assert!(!progress.started());
    assert_eq!(rx.try_iter().count(), 0);
    drop(tx);
    assert!(matches!(
        rx.try_recv(),
        Err(mpsc::TryRecvError::Disconnected)
    ));
}
