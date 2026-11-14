fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        // Newer Android devices may use 16 KiB memory pages. Align native
        // ELF segments accordingly; 4 KiB devices remain compatible.
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg=-Wl,-z,common-page-size=16384");
    }
    tauri_build::build()
}
