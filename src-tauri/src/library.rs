use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::{prelude::*, probe::Probe};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub duration: f64,
    pub format: String,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub bit_depth: u8,
    pub channels: u8,
    pub track_number: u32,
    pub disc_number: u32,
    pub cover: Option<String>,
    pub quality: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub tracks: Vec<Track>,
    pub warnings: Vec<String>,
}
pub fn quality(format: &str, bitrate: u32) -> String {
    if ["MP3", "AAC", "M4A", "OGG", "OPUS", "WMA"].contains(&format) {
        "LQ"
    } else if bitrate > 1500 {
        "HR"
    } else {
        "SQ"
    }
    .into()
}
fn thumbnail(bytes: &[u8]) -> Option<String> {
    if bytes.len() > 20 * 1024 * 1024 {
        return None;
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(96 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().ok()?.thumbnail(320, 320);
    let mut out = Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(out.into_inner())
    ))
}
fn directory_cover(parent: &Path) -> Option<String> {
    let files = fs::read_dir(parent).ok()?;
    let mut candidates = Vec::new();
    for file in files.flatten() {
        let path = file.path();
        let ext = path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        if ["jpg", "jpeg", "png", "webp"].contains(&ext.as_str()) {
            let stem = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            let rank = match stem.as_str() {
                "cover" => 0,
                "folder" => 1,
                "front" => 2,
                "album" => 3,
                _ => 4,
            };
            candidates.push((rank, path));
        }
    }
    candidates.sort();
    for (_, path) in candidates {
        if fs::metadata(&path).ok()?.len() <= 20 * 1024 * 1024 {
            if let Some(c) = fs::read(path).ok().and_then(|b| thumbnail(&b)) {
                return Some(c);
            }
        }
    }
    None
}
pub fn scan(paths: Vec<String>) -> ScanResult {
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    let mut warnings = Vec::new();
    for name in paths {
        let path = PathBuf::from(name);
        if path.is_dir() {
            for item in WalkDir::new(&path).follow_links(false) {
                match item {
                    Ok(entry) if entry.file_type().is_file() => files.push(entry.into_path()),
                    Err(e) => warnings.push(e.to_string()),
                    _ => {}
                }
            }
        } else if path.is_file() {
            files.push(path)
        } else {
            warnings.push(format!("File not found: {}", path.display()))
        }
    }
    files.sort();
    let mut covers: HashMap<PathBuf, Option<String>> = HashMap::new();
    let mut tracks = Vec::new();
    for path in files {
        let ext = path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        if !["mp3", "flac", "wav", "aiff", "aif", "m4a", "aac", "ogg"].contains(&ext.as_str()) {
            continue;
        }
        let path = fs::canonicalize(&path).unwrap_or(path);
        let path_string = path.to_string_lossy().into_owned();
        if !seen.insert(path_string.to_lowercase()) {
            continue;
        }
        let tagged = match Probe::open(&path).and_then(|p| p.read()) {
            Ok(t) => t,
            Err(e) => {
                warnings.push(format!("{}: {e}", path.display()));
                continue;
            }
        };
        let p = tagged.properties();
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        let title = tag
            .and_then(|t| t.title())
            .map(|s| s.into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
        let artist = tag
            .and_then(|t| t.artist())
            .map(|s| s.into_owned())
            .unwrap_or_else(|| "Unknown artist".into());
        let parent = path.parent().unwrap_or(Path::new("."));
        let album = tag
            .and_then(|t| t.album())
            .map(|s| s.into_owned())
            .unwrap_or_else(|| {
                parent
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
        let album_artist = tag
            .and_then(|t| t.get_string(&ItemKey::AlbumArtist))
            .unwrap_or(&artist)
            .to_owned();
        let folder_cover = covers
            .entry(parent.to_path_buf())
            .or_insert_with(|| directory_cover(parent));
        let cover = folder_cover.clone().or_else(|| {
            tag.and_then(|t| t.pictures().first())
                .and_then(|p| thumbnail(p.data()))
        });
        let duration = p.duration().as_secs_f64();
        let bitrate = p
            .audio_bitrate()
            .or(p.overall_bitrate())
            .unwrap_or_else(|| {
                if duration > 0. {
                    (fs::metadata(&path).map(|m| m.len()).unwrap_or(0) as f64 * 8.
                        / duration
                        / 1000.) as u32
                } else {
                    0
                }
            });
        // Lofty supplies decoded bit depth for ALAC; AAC has no PCM bit depth property.
        let format = if ext == "m4a"
            && tag
                .map(|t| t.tag_type() == lofty::tag::TagType::Mp4Ilst)
                .unwrap_or(false)
            && p.bit_depth().unwrap_or(0) > 0
        {
            "ALAC".into()
        } else {
            ext.to_uppercase()
        };
        tracks.push(Track {
            id: path_string.clone(),
            path: path_string,
            title,
            artist,
            album,
            album_artist,
            duration,
            quality: quality(&format, bitrate),
            format,
            bitrate,
            sample_rate: p.sample_rate().unwrap_or(0),
            bit_depth: p.bit_depth().unwrap_or(0),
            channels: p.channels().unwrap_or(2),
            track_number: tag.and_then(|t| t.track()).unwrap_or(0),
            disc_number: tag.and_then(|t| t.disk()).unwrap_or(1),
            cover,
        });
    }
    ScanResult { tracks, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quality_boundaries() {
        assert_eq!(quality("FLAC", 1500), "SQ");
        assert_eq!(quality("FLAC", 1501), "HR");
        assert_eq!(quality("MP3", 320), "LQ");
        assert_eq!(quality("ALAC", 2000), "HR");
    }
    #[test]
    fn missing_file_is_reported() {
        let scan = scan(vec!["does-not-exist.flac".into()]);
        assert!(scan.tracks.is_empty());
        assert_eq!(scan.warnings.len(), 1);
    }
}
