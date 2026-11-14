use crate::model::{Book, Chapter};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use zip::ZipArchive;
pub const MAX_PAGE: u64 = 64 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
pub enum Index {
    Zip {
        archive: Mutex<ZipArchive<File>>,
        entries: Vec<(String, usize)>,
    },
    Images(Vec<PathBuf>),
    Rar {
        path: PathBuf,
        entries: Vec<String>,
    },
    Pdf(PathBuf),
}
pub struct LocalReader {
    indexes: Mutex<HashMap<String, Arc<Index>>>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn image(name: &str) -> bool {
    matches!(
        Path::new(name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp"
    ) && !name.contains("__MACOSX")
        && !Path::new(name)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .starts_with('.')
}
pub fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "cbz" | "zip" | "cbr" | "rar" | "pdf"
    )
}
fn sevenzip() -> Result<PathBuf> {
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in ["7z", "7zz", "7z.exe"] {
                let file = dir.join(name);
                if file.is_file() {
                    return Ok(file);
                }
            }
        }
    }
    for p in [
        PathBuf::from("C:\\Program Files\\7-Zip\\7z.exe"),
        PathBuf::from("C:\\Program Files (x86)\\7-Zip\\7z.exe"),
    ] {
        if p.exists() {
            return Ok(p);
        }
    }
    Err("CBR/RAR requires 7-Zip. Install 7-Zip or convert this archive to CBZ.".into())
}
impl LocalReader {
    pub fn clear_indexes(&self) -> Result<()> {
        self.indexes.lock().map_err(err)?.clear();
        Ok(())
    }
    pub fn new() -> Self {
        Self {
            indexes: Mutex::new(HashMap::new()),
        }
    }
    pub fn index(&self, path: &str) -> Result<Arc<Index>> {
        if let Some(v) = self.indexes.lock().map_err(err)?.get(path) {
            return Ok(v.clone());
        }
        let p = Path::new(path);
        let idx = if p.is_dir() {
            let mut files = Vec::new();
            for entry in fs::read_dir(p).map_err(err)? {
                let e = entry.map_err(err)?;
                if e.file_type().map_err(err)?.is_file() && image(&e.path().to_string_lossy()) {
                    files.push(e.path())
                }
            }
            files.sort_by(|a, b| natord::compare(&a.to_string_lossy(), &b.to_string_lossy()));
            Index::Images(files)
        } else {
            match p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase()
                .as_str()
            {
                "cbz" | "zip" => {
                    let mut archive = ZipArchive::new(File::open(p).map_err(err)?).map_err(err)?;
                    if archive.len() > 100_000 {
                        return Err("Archive contains too many entries".into());
                    }
                    let mut entries = Vec::new();
                    for i in 0..archive.len() {
                        let f = archive.by_index(i).map_err(err)?;
                        if !f.is_dir() && image(f.name()) {
                            if f.size() > MAX_PAGE {
                                return Err(format!("Page {} exceeds the 64 MiB limit", f.name()));
                            }
                            entries.push((f.name().to_string(), i))
                        }
                    }
                    entries.sort_by(|a, b| natord::compare(&a.0, &b.0));
                    Index::Zip {
                        archive: Mutex::new(archive),
                        entries,
                    }
                }
                "cbr" | "rar" => {
                    let out = hidden_command(sevenzip()?)
                        .args(["l", "-slt", "-ba", "-p-", "--"])
                        .arg(p)
                        .output()
                        .map_err(err)?;
                    if !out.status.success() {
                        return Err(
                            "Cannot read RAR archive (it may be encrypted or damaged)".into()
                        );
                    }
                    let text = String::from_utf8_lossy(&out.stdout).replace("\r\n", "\n");
                    let mut entries = Vec::new();
                    for block in text.split("\n\n") {
                        let lines: HashMap<_, _> =
                            block.lines().filter_map(|l| l.split_once(" = ")).collect();
                        if let Some(name) = lines.get("Path") {
                            if image(name) {
                                if lines
                                    .get("Size")
                                    .and_then(|s| s.parse::<u64>().ok())
                                    .unwrap_or(MAX_PAGE + 1)
                                    > MAX_PAGE
                                {
                                    return Err("RAR page exceeds 64 MiB".into());
                                }
                                entries.push(name.to_string())
                            }
                        }
                    }
                    entries.sort_by(|a, b| natord::compare(a, b));
                    Index::Rar {
                        path: p.to_owned(),
                        entries,
                    }
                }
                "pdf" => {
                    if fs::metadata(p).map_err(err)?.len() > 256 * 1024 * 1024 {
                        return Err("PDF exceeds the 256 MiB limit".into());
                    }
                    Index::Pdf(p.to_owned())
                }
                _ => return Err("Choose a CBZ, ZIP, CBR, RAR, PDF, or image folder".into()),
            }
        };
        if idx.len() == 0 {
            return Err("No supported image pages were found".into());
        }
        let idx = Arc::new(idx);
        let mut cache = self.indexes.lock().map_err(err)?;
        if cache.len() >= 32 {
            cache.clear()
        }
        cache.insert(path.into(), idx.clone());
        Ok(idx)
    }
    pub fn read(&self, path: &str, page: usize) -> Result<Vec<u8>> {
        let index = self.index(path)?;
        if page >= index.len() {
            return Err("Page index is outside this chapter".into());
        }
        match &*index {
            Index::Zip { archive, entries } => {
                let mut zip = archive.lock().map_err(err)?;
                let f = zip.by_index(entries[page].1).map_err(err)?;
                let mut out = Vec::new();
                f.take(MAX_PAGE + 1).read_to_end(&mut out).map_err(err)?;
                if out.len() as u64 > MAX_PAGE {
                    return Err("Page exceeds 64 MiB".into());
                }
                Ok(out)
            }
            Index::Images(paths) => {
                if fs::metadata(&paths[page]).map_err(err)?.len() > MAX_PAGE {
                    return Err("Page exceeds 64 MiB".into());
                }
                fs::read(&paths[page]).map_err(err)
            }
            Index::Rar { path, entries } => {
                let mut child = hidden_command(sevenzip()?)
                    .args(["e", "-so", "-y", "-spd", "-p-", "--"])
                    .arg(path)
                    .arg(&entries[page])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .map_err(err)?;
                let mut bytes = Vec::new();
                child
                    .stdout
                    .take()
                    .ok_or("Cannot read 7-Zip output")?
                    .take(MAX_PAGE + 1)
                    .read_to_end(&mut bytes)
                    .map_err(err)?;
                if bytes.len() as u64 > MAX_PAGE {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Page exceeds 64 MiB".into());
                }
                if !child.wait().map_err(err)?.success() {
                    return Err("7-Zip could not decode this page".into());
                }
                Ok(bytes)
            }
            Index::Pdf(p) => fs::read(p).map_err(err),
        }
    }
    pub fn import(&self, path: &Path) -> Result<Book> {
        let path = fs::canonicalize(path).map_err(err)?;
        let canonical = path.to_string_lossy().to_string();
        let mut chapters = Vec::new();
        if path.is_dir() {
            self.scan(&path, &mut chapters, 0)?;
        } else {
            let idx = self.index(&canonical)?;
            chapters.push(Chapter {
                id: format!("local:{}", fingerprint(&path)?),
                title: path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                number: "1".into(),
                pages: idx.len(),
                path: canonical.clone(),
                downloaded: true,
                group: "Local file".into(),
            })
        }
        if chapters.is_empty() {
            return Err("This folder contains no supported manga files or image pages".into());
        }
        chapters.sort_by(|a, b| natord::compare(&a.path, &b.path));
        for (i, c) in chapters.iter_mut().enumerate() {
            c.number = (i + 1).to_string()
        }
        let id = if path.is_file() {
            chapters[0].id.clone()
        } else {
            let mut hash = Sha256::new();
            hash.update(b"mreader-folder-v1");
            hash.update(chapters[0].id.as_bytes());
            format!("local:{:x}", hash.finalize())
        };
        Ok(Book{id,title:path.file_stem().unwrap_or_default().to_string_lossy().to_string(),author:"Local library".into(),description:"Imported from your computer. Original files remain in place; keep them available at their imported location.".into(),cover:String::new(),source:"local".into(),remote_id:String::new(),path:canonical,status:"Local".into(),tags:vec!["Offline".into()],chapters,favorite:false})
    }
    fn scan(&self, path: &Path, out: &mut Vec<Chapter>, depth: usize) -> Result<()> {
        if depth > 4 {
            return Ok(());
        }
        let entries = fs::read_dir(path)
            .map_err(err)?
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(err)?;
        let has_images = entries.iter().any(|e| {
            e.file_type().map(|f| f.is_file()).unwrap_or(false)
                && image(&e.path().to_string_lossy())
        });
        if has_images {
            let key = path.to_string_lossy();
            let idx = self.index(&key)?;
            out.push(Chapter {
                id: format!("local:{}", fingerprint(path)?),
                title: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                number: String::new(),
                pages: idx.len(),
                path: key.to_string(),
                downloaded: true,
                group: "Image folder".into(),
            })
        }
        for e in entries {
            let typ = e.file_type().map_err(err)?;
            if typ.is_symlink() {
                continue;
            }
            if typ.is_dir() {
                self.scan(&e.path(), out, depth + 1)?
            } else if typ.is_file() && supported(&e.path()) {
                let mut b = self.import(&e.path())?;
                out.append(&mut b.chapters)
            }
        }
        Ok(())
    }
}
fn fingerprint(path: &Path) -> Result<String> {
    fn add_file(hash: &mut Sha256, path: &Path) -> Result<()> {
        let mut file = File::open(path).map_err(err)?;
        let mut buf = [0u8; 131072];
        loop {
            let n = file.read(&mut buf).map_err(err)?;
            if n == 0 {
                break;
            }
            hash.update(&buf[..n]);
        }
        Ok(())
    }
    let mut hash = Sha256::new();
    if path.is_dir() {
        let mut files = fs::read_dir(path)
            .map_err(err)?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().map(|t| t.is_file()).unwrap_or(false)
                    && image(&e.path().to_string_lossy())
            })
            .map(|e| e.path())
            .collect::<Vec<_>>();
        files.sort_by(|a, b| natord::compare(&a.to_string_lossy(), &b.to_string_lossy()));
        for file in files {
            let name = file.file_name().unwrap_or_default().to_string_lossy();
            hash.update((name.len() as u64).to_le_bytes());
            hash.update(name.as_bytes());
            hash.update(fs::metadata(&file).map_err(err)?.len().to_le_bytes());
            add_file(&mut hash, &file)?;
        }
    } else {
        add_file(&mut hash, path)?;
    }
    Ok(format!("{:x}", hash.finalize()))
}
impl Index {
    pub fn len(&self) -> usize {
        match self {
            Self::Zip { entries, .. } => entries.len(),
            Self::Images(p) => p.len(),
            Self::Rar { entries, .. } => entries.len(),
            Self::Pdf(_) => 1,
        }
    }
}
fn hidden_command(path: PathBuf) -> Command {
    let mut c = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn cbz_natural_order_and_bounds() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        let p = root.join("test.cbz");
        let mut z = zip::ZipWriter::new(File::create(&p).unwrap());
        for (name, data) in [
            ("10.png", b"ten".as_slice()),
            ("2.png", b"two".as_slice()),
            ("__MACOSX/1.png", b"ignore".as_slice()),
            ("note.txt", b"ignore".as_slice()),
        ] {
            z.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            z.write_all(data).unwrap()
        }
        z.finish().unwrap();
        let r = LocalReader::new();
        let b = r.import(&p).unwrap();
        assert_eq!(b.chapters[0].pages, 2);
        assert_eq!(r.read(&b.chapters[0].path, 0).unwrap(), b"two");
        assert!(r.read(&b.chapters[0].path, 2).is_err());
        drop(r);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn empty_folder_is_rejected() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        assert!(LocalReader::new().import(&root).is_err());
        fs::remove_dir_all(root).unwrap()
    }
    #[test]
    fn same_archive_on_two_devices_has_stable_ids() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        let first = root.join("Desktop.cbz");
        let second = root.join("Tablet.cbz");
        let mut zip = zip::ZipWriter::new(File::create(&first).unwrap());
        zip.start_file("1.png", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"same manga page").unwrap();
        zip.finish().unwrap();
        fs::copy(&first, &second).unwrap();
        let reader = LocalReader::new();
        let a = reader.import(&first).unwrap();
        let b = reader.import(&second).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.chapters[0].id, b.chapters[0].id);
        drop(reader);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn nested_image_folders_use_natural_chapter_and_page_order() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        for name in ["Chapter 10", "Chapter 2"] {
            let path = root.join(name);
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("10.png"), b"ten").unwrap();
            fs::write(path.join("2.png"), b"two").unwrap();
        }
        let reader = LocalReader::new();
        let book = reader.import(&root).unwrap();
        assert_eq!(book.chapters.len(), 2);
        assert!(book.chapters[0].path.ends_with("Chapter 2"));
        assert_eq!(reader.read(&book.chapters[0].path, 0).unwrap(), b"two");
        drop(reader);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn sevenzip_import_pipeline_reads_selected_entry_only() {
        if sevenzip().is_err() {
            return;
        }
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("container.cbr");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        for (name, bytes) in [("10.png", b"ten".as_slice()), ("2.png", b"two".as_slice())] {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        let reader = LocalReader::new();
        let book = reader.import(&archive).unwrap();
        assert_eq!(book.chapters[0].pages, 2);
        assert_eq!(reader.read(&book.chapters[0].path, 0).unwrap(), b"two");
        drop(reader);
        fs::remove_dir_all(root).unwrap();
    }
}
