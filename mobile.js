// Android and Linux WebViews need a bundled PDF viewer. Render one page at a time
// so large books don't allocate a canvas for every page.
function isAndroid() {
  return /Android/i.test(globalThis.navigator?.userAgent || "");
}
function usesCanvasPdf() {
  return /Android|Linux/i.test(globalThis.navigator?.userAgent || "");
}
async function openMobilePdf(url) {
  const pdfjs = await import("./vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
  return pdfjs.getDocument({ url, isEvalSupported: false }).promise;
}
async function renderMobilePdf(reader, canvas) {
  if (!canvas || !reader.pdfDocument) return;
  reader.pdfRender?.cancel();
  canvas.dataset.action = "page-click";
  const page = await reader.pdfDocument.getPage(reader.page + 1);
  if (!canvas.isConnected) return;
  const natural = page.getViewport({ scale: 1 });
  const available = Math.max(240, canvas.parentElement.clientWidth - 16);
  const scale = Math.min(2, globalThis.devicePixelRatio || 1) * Math.min(2, available / natural.width);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width / Math.min(2, globalThis.devicePixelRatio || 1)}px`;
  reader.pdfRender = page.render({ canvasContext: canvas.getContext("2d"), viewport });
  try { await reader.pdfRender.promise; }
  catch (error) { if (error.name !== "RenderingCancelledException") throw error; }
}
