const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const elements = new Map(),
  calls = [];
function element() {
  return {
    innerHTML: "",
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    remove() {
      elements.delete("#" + this.id);
    },
    addEventListener() {},
    querySelector() {
      return { focus() {} };
    },
  };
}
elements.set("#app", element());
elements.set("#toast", element());
const settings = {
  theme: "dark",
  language: "en",
  direction: "ltr",
  fit: "width",
  dataSaver: false,
  komgaUrl: "",
  komgaUser: "",
};
const book = {
  id: "local:test",
  title: '<script>alert("bad")</script>',
  author: "Author",
  description: "Text",
  source: "local",
  status: "Local",
  tags: ["Offline"],
  chapters: [
    {
      id: "chapter",
      title: "Test",
      number: "1",
      pages: 20,
      downloaded: true,
      path: "test.cbz",
    },
  ],
};
let sourceResolvers = [];
const invoke = async (name, args) => {
  calls.push({ name, args });
  if (name === "extension_list") return [];
  if (name === "apk_state") return { repositories: [], installed: [] };
  if (name === "cloud_status")
    return { configured: false, signedIn: false, profile: "guest" };
  if (name === "verification_plan") return { enabled: false };
  if (name === "snapshot")
    return { books: [book], progress: [], settings, dataDir: "test" };
  if (name === "open_chapter") return { pages: 20, pdf: false };
  if (name === "page_data")
    return new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer;
  if (name === "save_progress") return;
  if (name === "search_source")
    return new Promise((resolve) => sourceResolvers.push(resolve));
  throw Error("Unexpected command " + name);
};
const context = {
  console,
  Blob,
  URL,
  ArrayBuffer,
  Uint8Array,
  setTimeout() {},
  clearTimeout() {},
  setInterval() {},
  clearInterval() {},
  window: {
    innerWidth: 1200,
    __TAURI__: {
      core: { invoke },
      event: { listen: async () => {} },
      webviewWindow: {
        getCurrentWebviewWindow: () => ({ onDragDropEvent: async () => {} }),
      },
    },
  },
  document: {
    body: {
      classList: { toggle() {} },
      append(el) {
        elements.set("#" + el.id, el);
      },
    },
    querySelector: (s) => elements.get(s) || null,
    querySelectorAll: () => [],
    createElement: element,
    addEventListener() {},
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("features.js", "utf8"), context);
vm.runInContext(fs.readFileSync("app.js", "utf8"), context);
(async () => {
  await new Promise(setImmediate);
  assert(elements.get("#app").innerHTML.includes("&lt;script&gt;"));
  assert(!elements.get("#app").innerHTML.includes("<script>alert"));
  await vm.runInContext("openReader('local:test','chapter',0)", context);
  assert(elements.get("#reader").innerHTML.includes("Page 1"));
  await vm.runInContext("turnPage(1)", context);
  assert(elements.get("#reader").innerHTML.includes("Page 2"));
  for (let i = 0; i < 18; i++) await vm.runInContext("turnPage(1)", context);
  await new Promise(setImmediate);
  assert(vm.runInContext("pageCache.size<=5", context));
  assert(calls.some((c) => c.name === "save_progress" && c.args.completed));
  await vm.runInContext("turnPage(-1)", context);
  assert.equal(
    calls.filter((c) => c.name === "save_progress").at(-1).args.completed,
    true,
  );
  vm.runInContext("closeReader()", context);
  assert.equal(vm.runInContext("pageCache.size", context), 0);
  vm.runInContext("state.page='Browse';state.query='old'", context);
  const old = vm.runInContext("searchSource()", context);
  vm.runInContext("state.query='new'", context);
  const recent = vm.runInContext("searchSource()", context);
  sourceResolvers[1]({
    books: [{ ...book, id: "new", title: "New result" }],
    total: 1,
  });
  await recent;
  sourceResolvers[0]({
    books: [{ ...book, id: "old", title: "Old result" }],
    total: 1,
  });
  await old;
  assert(elements.get("#app").innerHTML.includes("New result"));
  assert(!elements.get("#app").innerHTML.includes("Old result"));
  vm.runInContext(`featureState.extensions=[{id:'org.test',name:'<script>extension</script>',version:'1.0.0',schemaVersion:1,allowedHosts:['api.example.org'],language:'en'}];state.page='Settings';render()`,context);
  assert(elements.get('#app').innerHTML.includes('Managed account sync has not been configured'));
  assert(elements.get('#app').innerHTML.includes('&lt;script&gt;extension&lt;/script&gt;'));
  assert(!elements.get('#app').innerHTML.includes('<script>extension'));
  console.log(
    "PASS frontend: escaped source and extension metadata, binary page loading, navigation, completed status, bounded page cache, stale-search handling, explicit unconfigured-sync state",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
