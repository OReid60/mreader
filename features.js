// Native extension management and managed account sync. No credentials enter page storage.
const featureState = {
  extensions: [],
  cloud: { configured: false, signedIn: false },
  syncing: false,
  syncError: "",
  syncTimer: null,
  plan: null,
};
function sourceLabel(id) {
  if (id.startsWith("ext:"))
    return (
      featureState.extensions.find((e) => "ext:" + e.id === id)?.name ||
      id.slice(4)
    );
  return { local: "Local", mangadex: "MangaDex", komga: "Komga" }[id] || id;
}
function extensionOptions() {
  return featureState.extensions
    .map(
      (e) =>
        `<option value="ext:${esc(e.id)}" ${state.source === "ext:" + e.id ? "selected" : ""}>${esc(e.name)} · ${esc(e.language)}</option>`,
    )
    .join("");
}
function extensionView() {
  return `<section class="feature-panel"><div class="feature-heading"><div><h2>Native source extensions</h2><p>Portable JSON manifests. Install the same extension on desktop, phone, and tablet builds.</p></div><div class="button-row"><label class="secondary">Import manifest<input type="file" id="extension-file" accept=".json" hidden></label>${button("extension-example", "Install MangaDex example")}</div></div>${featureState.extensions.length ? featureState.extensions.map((e) => `<div class="extension-row"><div><b>${esc(e.name)}</b><small>${esc(e.id)} · v${esc(e.version)} · schema ${e.schemaVersion}</small><p>Network access: ${e.allowedHosts.map(esc).join(", ")}</p></div><div class="button-row">${button("extension-export", "Export", "secondary", `data-extension="${esc(e.id)}"`)}${button("extension-remove", "Uninstall", "secondary", `data-extension="${esc(e.id)}"`)}</div></div>`).join("") : '<p class="sub">No native extensions installed. Built-in sources remain available.</p>'}<p class="feature-note">Schema v1 supports JSON API sources. Android APK extensions and executable scripts are not accepted. Updating a manifest keeps its source and chapter IDs.</p></section>`;
}
function accountView() {
  const c = featureState.cloud;
  return `<section class="feature-panel"><div class="feature-heading"><div><h2>Account & cross-device progress</h2><p>${c.profile === "account" ? "Your account library is stored separately from this device’s guest library." : "Sign in to the same account on supported builds to share your library and reading progress."}</p></div><span class="connection-pill">${!c.configured ? "Not configured" : c.signedIn ? "Signed in" : "Ready to sign in"}</span></div>${c.signedIn ? `<p>${esc(c.email || "Your account")}</p><p class="sub">${featureState.syncing ? "Syncing…" : c.lastSync ? "Last synced " + new Date(c.lastSync).toLocaleString() : "Not synced yet"}${featureState.syncError ? " · " + esc(featureState.syncError) : ""}</p><div class="button-row">${button("cloud-sync", "Sync now", "primary")}${button("cloud-logout", "Sign out")}</div>` : !c.configured ? '<p class="notice">Managed account sync has not been configured for this build. Local reading and extensions work now; cross-device sync requires a managed project connection.</p>' : `<form id="account-form" class="account-form"><input name="email" type="email" required autocomplete="username" placeholder="Email" aria-label="Account email"><input name="password" type="password" minlength="8" required autocomplete="current-password" placeholder="Password" aria-label="Account password"><div class="button-row"><button type="submit" class="primary">Sign in</button><button type="submit" class="secondary" name="register" value="yes">Create account</button></div></form>`}<details class="service-setup"><summary>Managed service setup</summary><p>Configure once per build/device using a Supabase project with the supplied sync schema. This does not run a server on your computer. Never enter a secret or service-role key.</p><form id="cloud-config-form" class="account-form"><input name="url" type="url" required value="${esc(c.url || "")}" placeholder="https://project.supabase.co" aria-label="Managed project URL"><input name="publicKey" required value="${esc(c.publicKey || "")}" placeholder="Public publishable / anon key" aria-label="Public project key"><button class="secondary" type="submit" ${c.signedIn ? "disabled" : ""}>Save service connection</button></form></details><p class="feature-note">Sync shares metadata, extension definitions, favorites, and reading progress. It excludes passwords, local file paths, and manga bytes. Local files must be imported on each device. Use the same account on each device to share progress.</p></section>`;
}
function releaseCoverCache() {
  for (const url of coverCache.values()) URL.revokeObjectURL(url);
  coverCache.clear();
  coverFailed.clear();
}
async function loadFeatures() {
  const [extensions, cloud, plan] = await Promise.all([
    api("extension_list"),
    api("cloud_status"),
    api("verification_plan"),
  ]);
  featureState.extensions = extensions;
  featureState.cloud = cloud;
  featureState.plan = plan;
  if (cloud.signedIn && !plan.enabled) await syncAccount(true);
  if (!plan.enabled) {
    setInterval(() => {
      if (featureState.cloud.signedIn && !state.busy) syncAccount(true);
    }, 30000);
  }
  return plan;
}
function queueAccountSync() {
  if (!featureState.cloud.signedIn || featureState.plan?.enabled) return;
  clearTimeout(featureState.syncTimer);
  featureState.syncTimer = setTimeout(() => syncAccount(true), 1500);
}
async function syncAccount(quiet = false) {
  if (featureState.syncing || state.busy) return;
  featureState.syncing = true;
  try {
    const result = await api("cloud_sync");
    applySnapshot(result.snapshot);
    featureState.cloud = result.status;
    featureState.extensions = result.extensions;
    featureState.syncError = "";
    if (
      !state.reader &&
      !document.activeElement?.matches("input,textarea,select")
    )
      render();
    if (!quiet) toast("Account library and progress synced");
  } catch (e) {
    featureState.syncError = String(e);
    if (!quiet) toast(e);
  } finally {
    featureState.syncing = false;
  }
}
async function refreshExtensions(list) {
  featureState.extensions = list;
  releaseCoverCache();
  if (
    state.source.startsWith("ext:") &&
    !list.some((e) => "ext:" + e.id === state.source)
  )
    state.source = "mangadex";
  render();
  queueAccountSync();
}
document.addEventListener("change", async (e) => {
  if (e.target.id !== "extension-file") return;
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 131072) throw Error("Manifest exceeds 128 KiB");
    const manifest = JSON.parse(await file.text());
    const layer = document.createElement("div");
    layer.className = "modal-backdrop";
    layer.id = "extension-review";
    layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="Review extension"><h2>Review ${esc(manifest.name || "extension")}</h2><p>Version ${esc(manifest.version)} · ${esc(manifest.id)}</p><p>Declared network hosts:</p><ul>${(manifest.allowedHosts || []).map((h) => `<li>${esc(h)}</li>`).join("")}</ul><p>Only install manifests from authors you trust.</p><div class="button-row">${button("extension-confirm", "Install manifest", "primary")}${button("extension-cancel", "Cancel")}</div></section>`;
    layer.pendingManifest = manifest;
    document.body.append(layer);
  } catch (err) {
    toast(err);
  }
});
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  try {
    switch (t.dataset.action) {
      case "extension-confirm": {
        const layer = document.querySelector("#extension-review");
        await refreshExtensions(
          await api("extension_install", { manifest: layer.pendingManifest }),
        );
        layer.remove();
        toast("Native extension installed");
        break;
      }
      case "extension-cancel":
        document.querySelector("#extension-review")?.remove();
        break;
      case "extension-example":
        await refreshExtensions(await api("extension_example"));
        toast("Example installed. Select it in Browse.");
        break;
      case "extension-remove":
        await refreshExtensions(
          await api("extension_remove", { id: t.dataset.extension }),
        );
        toast("Extension removed. Your reading progress is preserved.");
        break;
      case "extension-export": {
        const ext = featureState.extensions.find(
          (e) => e.id === t.dataset.extension,
        );
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(ext, null, 2)], {
            type: "application/json",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = ext.id + ".mreader.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        break;
      }
      case "cloud-sync":
        await syncAccount();
        render();
        break;
      case "cloud-logout":
        if (state.busy) throw Error("Wait for the current import to finish");
        applySnapshot(await api("cloud_logout"));
        featureState.cloud = await api("cloud_status");
        featureState.extensions = await api("extension_list");
        releaseCoverCache();
        render();
        toast("Signed out. Guest library restored.");
        break;
    }
  } catch (err) {
    toast(err);
  }
});
document.addEventListener("submit", async (e) => {
  if (!["cloud-config-form", "account-form"].includes(e.target.id)) return;
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    if (e.target.id === "cloud-config-form") {
      featureState.cloud = await api("cloud_configure", {
        url: form.get("url"),
        publicKey: form.get("publicKey"),
      });
      render();
      toast("Managed service configured");
    } else {
      if (state.busy) throw Error("Wait for the current import to finish");
      const result = await api("cloud_auth", {
        email: form.get("email"),
        password: form.get("password"),
        register: e.submitter?.name === "register",
      });
      e.target.reset();
      featureState.cloud = result.status;
      applySnapshot(result.snapshot);
      featureState.extensions = await api("extension_list");
      releaseCoverCache();
      render();
      if (result.confirmationRequired)
        toast("Check your email to confirm the account, then sign in.");
      else await syncAccount();
    }
  } catch (err) {
    toast(err);
  }
});

async function runVerification(plan) {
  const checks = [];
  const check = (name, ok, details = {}) => {
    if (!ok) throw Error(name + " failed");
    checks.push({ name, ok, ...details });
  };
  let report;
  try {
    if (plan.display === "2") check(
      "display-two",
      window.screen.availLeft >= 1920 || window.screenX >= 1920,
      { screenX: window.screenX, screenY: window.screenY },
    );
    else check("virtual-display", window.screen.width > 0);
    const imported = await api("import_paths", { paths: plan.files });
    check(
      "local-import",
      imported.imported === plan.files.length && imported.errors.length === 0,
    );
    applySnapshot(imported.snapshot);
    render();
    const archive = state.books.find((b) =>
      b.path.toLowerCase().endsWith(".cbz"),
    );
    check("archive-index", archive?.chapters[0].pages === 3);
    await openReader(archive.id, archive.chapters[0].id, 0);
    await document.querySelector(".reading-page").decode();
    check(
      "local-page-render",
      document.querySelector(".reading-page").naturalWidth > 0,
    );
    await turnPage(1);
    await document.querySelector(".reading-page").decode();
    check("local-page-navigation", state.reader.page === 1);
    closeReader();
    const pdf = state.books.find((b) => b.path.toLowerCase().endsWith(".pdf"));
    const pdfBytes = new Uint8Array(
      await api("page_data", {
        bookId: pdf.id,
        chapterId: pdf.chapters[0].id,
        page: 0,
      }),
    );
    check(
      "pdf-import",
      String.fromCharCode(...pdfBytes.slice(0, 5)) === "%PDF-",
    );
    const pdfUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
    const pdfDocument = await openMobilePdf(pdfUrl);
    check("mobile-pdf-page-count", pdfDocument.numPages > 0);
    await api("save_progress", { bookId: pdf.id, chapterId: pdf.chapters[0].id, page: 0, completed: false, totalPages: pdfDocument.numPages });
    const countedPdf = (await api("snapshot")).books.find(book => book.id === pdf.id);
    check("mobile-pdf-count-persisted", countedPdf.chapters[0].pages === pdfDocument.numPages);
    let invalidCountRejected = false;
    try {
      await api("save_progress", { bookId: archive.id, chapterId: archive.chapters[0].id, page: 0, completed: false, totalPages: 999 });
    } catch { invalidCountRejected = true; }
    check("image-page-count-protected", invalidCountRejected);
    const pdfCanvas = document.createElement("canvas");
    pdfCanvas.style.position = "fixed";
    pdfCanvas.style.left = "-10000px";
    document.body.append(pdfCanvas);
    await renderMobilePdf({ pdfDocument, page: 0 }, pdfCanvas);
    check("mobile-pdf-canvas-render", pdfCanvas.width > 0 && pdfCanvas.height > 0);
    pdfCanvas.remove();
    await pdfDocument.destroy();
    URL.revokeObjectURL(pdfUrl);
    if (plan.offline) {
      await openReader(pdf.id, pdf.chapters[0].id, 0);
      check("pdf-reader-uses-canvas", !!state.reader?.pdfDocument && !!document.querySelector("canvas.reading-page"));
      await turnPage(1);
      check("pdf-reader-progress", (await api("snapshot")).progress.some(progress => progress.bookId === pdf.id && progress.page === 1));
      closeReader();
      // Keep the verified interface visible briefly for the CI screenshot.
      await new Promise(resolve => setTimeout(resolve, 3000));
      await api("verification_finish", { report: { ok: true, checks, cloudConfigured: featureState.cloud.configured, completedAt: new Date().toISOString() } });
      return;
    }
    const catalog = await api("search_source", {
      source: "mangadex",
      query: "Everyday Host",
      offset: 0,
    });
    const remote = catalog.books[0];
    check("live-catalog", !!remote);
    applySnapshot(await api("add_book", { book: remote }));
    const remoteBook = await api("chapters", {
      bookId: remote.id,
      refresh: false,
    });
    state.books = state.books.map((b) =>
      b.id === remoteBook.id ? remoteBook : b,
    );
    state.page = "Library";
    render();
    const coverBytes = await api("cover_data", { book: remoteBook });
    const imageUrl = URL.createObjectURL(
      new Blob([coverBytes], { type: "image/jpeg" }),
    );
    coverCache.set(remoteBook.id, imageUrl);
    render();
    const coverElement = [...document.querySelectorAll(".cover-art")].find(
      (el) => el.tagName === "IMG" && el.src === imageUrl,
    );
    await coverElement.decode();
    check("cover-fix-native-and-webview", coverElement.naturalWidth > 0, {
      width: coverElement.naturalWidth,
      height: coverElement.naturalHeight,
      bytes: coverBytes.byteLength,
    });
    const chapter =
      remoteBook.chapters.find((c) => c.pages > 0 && c.pages <= 12) ||
      remoteBook.chapters[0];
    await openReader(remoteBook.id, chapter.id, 0);
    await document.querySelector(".reading-page").decode();
    check(
      "live-page-render",
      document.querySelector(".reading-page").naturalWidth > 0,
    );
    await turnPage(1);
    await document.querySelector(".reading-page").decode();
    closeReader();
    check(
      "progress-saved",
      (await api("snapshot")).progress.some(
        (p) => p.bookId === remoteBook.id && p.page === 1,
      ),
    );
    featureState.extensions = await api("extension_example");
    const extCatalog = await api("search_source", {
      source: "ext:org.mreader.mangadex",
      query: "Everyday Host",
      offset: 0,
    });
    check("native-extension-search", extCatalog.books.length > 0);
    applySnapshot(await api("add_book", { book: extCatalog.books[0] }));
    const extBook = await api("chapters", {
      bookId: extCatalog.books[0].id,
      refresh: false,
    });
    state.books = state.books.map((b) => (b.id === extBook.id ? extBook : b));
    check("native-extension-chapters", extBook.chapters.length > 0);
    const extChapter =
      extBook.chapters.find((c) => c.pages > 0 && c.pages <= 12) ||
      extBook.chapters[0];
    await openReader(extBook.id, extChapter.id, 0);
    await document.querySelector(".reading-page").decode();
    check(
      "native-extension-page-render",
      document.querySelector(".reading-page").naturalWidth > 0,
    );
    closeReader();
    const offline = await api("download_chapter", {
      bookId: remoteBook.id,
      chapterId: chapter.id,
    });
    check(
      "chapter-download",
      offline.chapters.some((c) => c.id === chapter.id && c.downloaded),
    );
    const bytes = await api("page_data", {
      bookId: remoteBook.id,
      chapterId: chapter.id,
      page: 0,
    });
    check("offline-page-read", bytes.byteLength > 1000);
    report = {
      ok: true,
      checks,
      cloudConfigured: featureState.cloud.configured,
      completedAt: new Date().toISOString(),
    };
  } catch (e) {
    report = {
      ok: false,
      checks,
      error: String(e),
      completedAt: new Date().toISOString(),
    };
  }
  await api("verification_finish", { report });
}
