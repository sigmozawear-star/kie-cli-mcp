// Self-contained MCP Apps widget (SEP-1865 / io.modelcontextprotocol/ui).
// One HTML document serves three modes (candidates | upload | result); the
// server substitutes __KIE_MODE__ before returning the ui:// resource.
//
// The MCP Apps postMessage protocol is implemented inline (no CDN script), so
// the sandbox only needs connect/resource domains for media and uploads.
// The widget never sees the Kie API key and never calls Kie: it only renders
// URLs it is given and sends chat messages via `ui/message`.
//
// NOTE: this file is a String.raw template. Do not use backticks or "${" in
// the HTML/CSS/JS below.

export const WIDGET_HTML_TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Kie widget</title>
<style>
:root {
  color-scheme: light dark;
  --bg: var(--color-background-primary, #ffffff);
  --bg2: var(--color-background-secondary, #f4f4f2);
  --bg3: var(--color-background-tertiary, #ebebe8);
  --fg: var(--color-text-primary, #1f1e1d);
  --fg2: var(--color-text-secondary, #5e5d59);
  --line: var(--color-border-primary, rgba(31,30,29,.15));
  --accent: var(--color-text-info, #2c6bd6);
  --accent-bg: var(--color-background-info, #e8effc);
  --ok: var(--color-text-success, #2f7d32);
  --ok-bg: var(--color-background-success, #e6f4e7);
  --bad: var(--color-text-danger, #b3261e);
  --radius: var(--border-radius-lg, 12px);
  --radius-sm: var(--border-radius-md, 8px);
  --font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: var(--color-background-primary, #262624);
    --bg2: var(--color-background-secondary, #30302e);
    --bg3: var(--color-background-tertiary, #3a3a37);
    --fg: var(--color-text-primary, #f5f4ef);
    --fg2: var(--color-text-secondary, #b7b5a9);
    --line: var(--color-border-primary, rgba(245,244,239,.16));
    --accent: var(--color-text-info, #8ab4ff);
    --accent-bg: var(--color-background-info, #23324d);
    --ok: var(--color-text-success, #8bd48f);
    --ok-bg: var(--color-background-success, #1f3a22);
    --bad: var(--color-text-danger, #ff9a92);
  }
}
:root[data-theme="dark"] {
  --bg: var(--color-background-primary, #262624);
  --bg2: var(--color-background-secondary, #30302e);
  --bg3: var(--color-background-tertiary, #3a3a37);
  --fg: var(--color-text-primary, #f5f4ef);
  --fg2: var(--color-text-secondary, #b7b5a9);
  --line: var(--color-border-primary, rgba(245,244,239,.16));
  --accent: var(--color-text-info, #8ab4ff);
  --accent-bg: var(--color-background-info, #23324d);
  --ok: var(--color-text-success, #8bd48f);
  --ok-bg: var(--color-background-success, #1f3a22);
  --bad: var(--color-text-danger, #ff9a92);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body { font: 14px/1.45 var(--font); color: var(--fg); padding: 4px 2px 8px; overflow-x: hidden; }
#app { max-width: 100%; }
.q { font-weight: 600; font-size: 15px; margin: 0 0 10px; overflow-wrap: anywhere; }
.muted { color: var(--fg2); font-size: 12.5px; }
.grid { display: grid; gap: 10px; grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); }
@media (max-width: 599px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 8px; } }
.card { background: var(--bg2); border: 1px solid var(--line); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 6px; min-width: 0; transition: border-color .15s, opacity .15s; }
.card.chosen { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
.card.dim { opacity: .45; }
.media { position: relative; width: 100%; aspect-ratio: 9 / 16; background: var(--bg3); border-radius: var(--radius-sm); overflow: hidden; display: flex; align-items: center; justify-content: center; }
.media img, .media video { width: 100%; height: 100%; object-fit: contain; display: block; background: var(--bg3); }
.media img { cursor: zoom-in; }
.media audio { width: 92%; }
.media .err { padding: 10px; text-align: center; font-size: 12px; color: var(--fg2); overflow-wrap: anywhere; }
.media .err a { color: var(--accent); }
.tag { position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,.6); color: #fff; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px; max-width: calc(100% - 12px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.label { font-size: 12.5px; color: var(--fg2); overflow-wrap: anywhere; min-height: 0; }
button { font: inherit; font-size: 13px; font-weight: 600; border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--bg); color: var(--fg); padding: 8px 10px; cursor: pointer; min-height: 36px; touch-action: manipulation; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); }
button:disabled { opacity: .5; cursor: default; }
button.primary:disabled { opacity: 1; }
.pick { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: stretch; }
.row input[type=text] { flex: 1 1 220px; min-width: 0; font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px 10px; min-height: 36px; }
.row input::placeholder { color: var(--fg2); }
.status { margin-top: 10px; font-size: 13px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--ok-bg); color: var(--ok); overflow-wrap: anywhere; }
.status.bad { background: transparent; color: var(--bad); border: 1px solid var(--bad); }
.status code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; user-select: all; }
.btns { display: flex; gap: 6px; }
.btns button { flex: 1 1 0; min-width: 0; padding: 7px 6px; font-size: 12.5px; }
.drop { border: 2px dashed var(--line); border-radius: var(--radius); padding: 22px 12px; text-align: center; background: var(--bg2); cursor: pointer; }
.drop.over { border-color: var(--accent); background: var(--accent-bg); }
.drop strong { display: block; margin-bottom: 4px; }
.files { display: grid; gap: 8px; margin-top: 10px; grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); }
@media (max-width: 599px) { .files { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
.bar { height: 4px; background: var(--bg3); border-radius: 2px; overflow: hidden; }
.bar > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
.fname { font-size: 12px; color: var(--fg2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fstate { font-size: 12px; }
.fstate.ok { color: var(--ok); } .fstate.bad { color: var(--bad); }
.hidden { display: none !important; }
.loading { color: var(--fg2); padding: 14px 4px; }
</style>
</head>
<body>
<div id="app"><div class="loading">Loading…</div></div>
<script>
(function () {
  "use strict";
  var MODE = "__KIE_MODE__";
  var PROTOCOL_VERSION = "2026-01-26";
  var APP_INFO = { name: "kie-widgets", version: "1.0.0" };

  // ---------- MCP Apps postMessage JSON-RPC ----------
  var nextId = 1;
  var pending = {};
  var host = { caps: {}, ctx: {}, ready: false };
  var data = { args: null, result: null };

  function post(msg) { try { window.parent.postMessage(msg, "*"); } catch (e) {} }
  function request(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
      setTimeout(function () {
        if (pending[id]) { delete pending[id]; reject(new Error("No response from host (" + method + ")")); }
      }, timeoutMs || 30000);
    });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && m.id !== null && !m.method) {
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      if (m.error) p.reject(new Error(m.error.message || "Host error"));
      else p.resolve(m.result);
      return;
    }
    if (m.method && m.id !== undefined && m.id !== null) {
      // Host → app request.
      if (m.method === "ping" || m.method === "ui/resource-teardown") {
        post({ jsonrpc: "2.0", id: m.id, result: {} });
      } else {
        post({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
      }
      return;
    }
    switch (m.method) {
      case "ui/notifications/tool-input":
        data.args = (m.params && m.params.arguments) || {};
        render();
        break;
      case "ui/notifications/tool-result":
        data.result = m.params || {};
        render();
        break;
      case "ui/notifications/tool-cancelled":
        showFatal("The tool call was cancelled.");
        break;
      case "ui/notifications/host-context-changed":
        host.ctx = Object.assign({}, host.ctx, m.params || {});
        applyHostContext();
        break;
    }
  });

  function applyHostContext() {
    var ctx = host.ctx || {};
    var root = document.documentElement;
    if (ctx.theme === "dark" || ctx.theme === "light") root.setAttribute("data-theme", ctx.theme);
    var vars = ctx.styles && ctx.styles.variables;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        if (k.indexOf("--") === 0 && vars[k] != null && vars[k] !== "") root.style.setProperty(k, String(vars[k]));
      });
    }
    var css = ctx.styles && ctx.styles.css && ctx.styles.css.fonts;
    if (css && !document.getElementById("host-fonts")) {
      var st = document.createElement("style"); st.id = "host-fonts"; st.textContent = css; document.head.appendChild(st);
    }
    var inset = ctx.safeAreaInsets;
    if (inset) {
      document.body.style.paddingLeft = Math.max(2, inset.left || 0) + "px";
      document.body.style.paddingRight = Math.max(2, inset.right || 0) + "px";
    }
  }

  function setupAutoResize() {
    var scheduled = false, lastW = 0, lastH = 0;
    function measure() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        var el = document.documentElement;
        var prev = el.style.height;
        el.style.height = "max-content";
        var h = Math.ceil(el.getBoundingClientRect().height);
        el.style.height = prev;
        var w = Math.ceil(window.innerWidth);
        if (w !== lastW || h !== lastH) {
          lastW = w; lastH = h;
          notify("ui/notifications/size-changed", { width: w, height: h });
        }
      });
    }
    measure();
    var ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    ro.observe(document.body);
    document.addEventListener("load", measure, true); // images/videos finishing load
  }

  function connect() {
    request("ui/initialize", {
      appInfo: APP_INFO,
      appCapabilities: { availableDisplayModes: ["inline"] },
      protocolVersion: PROTOCOL_VERSION
    }, 15000).then(function (res) {
      res = res || {};
      host.caps = res.hostCapabilities || {};
      host.ctx = res.hostContext || {};
      host.ready = true;
      applyHostContext();
      notify("ui/notifications/initialized", {});
      setupAutoResize();
      render();
    }).catch(function (e) {
      setupAutoResize();
      if (!data.args && !data.result) showFatal("Could not connect to the host: " + e.message);
    });
  }

  // ---------- helpers ----------
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.keys(v).forEach(function (s) { el.style.setProperty(s, v[s]); });
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  function $app() { return document.getElementById("app"); }
  function mount(nodes) { var a = $app(); a.replaceChildren.apply(a, nodes.filter(Boolean)); }
  function showFatal(msg) { mount([h("div", { class: "status bad", text: msg })]); }
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null; }
  function oneLine(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function cols(n) { return String(Math.max(3, Math.min(n, 4))); }
  function sc() {
    var r = data.result;
    if (r && r.structuredContent && typeof r.structuredContent === "object") return r.structuredContent;
    return null;
  }
  function memoryKey(id) { return "kie-widget:" + MODE + ":" + id; }
  function remember(id, text) { try { localStorage.setItem(memoryKey(id), text); } catch (e) {} }
  function recall(id) { try { return localStorage.getItem(memoryKey(id)); } catch (e) { return null; } }

  function openLink(url) {
    if (host.ready) {
      return request("ui/open-link", { url: url }).then(function (r) {
        if (r && r.isError) throw new Error("refused");
      }).catch(function () { try { window.open(url, "_blank", "noopener"); } catch (e) {} });
    }
    try { window.open(url, "_blank", "noopener"); } catch (e) {}
    return Promise.resolve();
  }

  function sendChat(text) {
    return request("ui/message", { role: "user", content: [{ type: "text", text: text }] }, 30000)
      .then(function (r) { if (r && r.isError) throw new Error("Host rejected the message"); return r; });
  }

  function mediaEl(url, kind, tagText) {
    var box = h("div", { class: "media" });
    var fail = function () {
      box.replaceChildren(h("div", { class: "err" }, ["Preview unavailable. ",
        h("a", { href: "#", text: "Open", onclick: function (e) { e.preventDefault(); openLink(url); } })]));
    };
    var el;
    if (kind === "video") {
      el = h("video", { src: url, controls: true, playsinline: true, muted: true, preload: "metadata", loop: true });
      el.addEventListener("error", fail);
    } else if (kind === "audio") {
      el = h("audio", { src: url, controls: true, preload: "metadata" });
      el.addEventListener("error", fail);
    } else {
      el = h("img", { src: url, alt: tagText || "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
      el.addEventListener("error", fail);
      el.addEventListener("click", function () { openLink(url); });
    }
    box.appendChild(el);
    if (tagText) box.appendChild(h("span", { class: "tag", text: tagText }));
    return box;
  }

  // ---------- mode: candidates ----------
  var cand = { sent: null, busy: false };
  function renderCandidates() {
    var a = sc() || data.args;
    if (!a || !Array.isArray(a.candidates)) return;
    var decision = String(a.decision_id || "");
    var allowNote = a.allow_note !== false;
    var allowNone = a.allow_none !== false;
    if (!cand.sent) cand.sent = recall(decision);
    var locked = !!cand.sent || cand.busy;
    var list = a.candidates.filter(function (c) { return c && safeUrl(c.url); });

    var statusBox = h("div", { class: "status hidden", role: "status", "aria-live": "polite" });
    function finish(text, chosenId) {
      cand.busy = true; renderCandidates();
      sendChat(text).then(function () {
        cand.sent = text; cand.busy = false; cand.chosen = chosenId; remember(decision, text); renderCandidates();
      }).catch(function (e) {
        cand.busy = false; renderCandidates();
        var s = $app().querySelector(".status");
        if (s) {
          s.className = "status bad";
          s.replaceChildren("Could not send (" + e.message + "). Copy and paste into the chat: ", h("code", { text: text }));
        }
      });
    }

    var grid = h("div", { class: "grid", style: { "--cols": cols(list.length) } }, list.map(function (c) {
      var id = String(c.id);
      var kind = c.kind === "video" ? "video" : "image";
      var chosen = cand.sent && cand.sent === "WYBÓR " + decision + ": " + id;
      return h("div", { class: "card" + (chosen ? " chosen" : (cand.sent ? " dim" : "")) }, [
        mediaEl(c.url, kind, id),
        c.label ? h("div", { class: "label", text: String(c.label) }) : null,
        h("button", {
          class: "pick" + (chosen ? " primary" : ""), disabled: locked, title: "Choose " + id,
          text: chosen ? "Chosen: " + id : "Choose " + id,
          onclick: function () { finish("WYBÓR " + decision + ": " + id, id); }
        })
      ]);
    }));

    var note = null;
    if (allowNote || allowNone) {
      var input = allowNote ? h("input", { type: "text", placeholder: "something else: …", "aria-label": "something else", disabled: locked, maxlength: "2000" }) : null;
      var sendNote = function () {
        var t = oneLine(input && input.value);
        if (!t) { if (input) input.focus(); return; }
        finish("WYBÓR " + decision + ": inaczej — " + t, null);
      };
      if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendNote(); } });
      note = h("div", { class: "row" }, [
        input,
        allowNote ? h("button", { disabled: locked, text: "Send", onclick: sendNote }) : null,
        allowNone ? h("button", { disabled: locked, text: "None — redraw",
          onclick: function () { finish("WYBÓR " + decision + ": żadne — przerysuj", null); } }) : null
      ]);
    }
    if (cand.sent) { statusBox.className = "status"; statusBox.replaceChildren("Sent: ", h("code", { text: cand.sent })); }
    else if (cand.busy) { statusBox.className = "status"; statusBox.textContent = "Sending…"; }

    mount([
      a.question ? h("p", { class: "q", text: String(a.question) }) : null,
      grid, note, statusBox
    ]);
  }

  // ---------- mode: upload ----------
  var up = { files: [], sent: null, busy: false, seq: 0 };
  function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.ceil(n / 1024) + " KB"; }
  function kindOf(file) { var t = (file.type || "").toLowerCase(); return t.indexOf("video/") === 0 ? "video" : t.indexOf("image/") === 0 ? "image" : null; }

  function b64(buf) {
    var bytes = new Uint8Array(buf), out = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(out);
  }

  function uploadDirect(cfg, item) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", cfg.url, true);
      xhr.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(item.file.name || "upload"));
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) { item.progress = e.loaded / e.total * 0.95; drawUpload(); } };
      xhr.onload = function () {
        var body = null; try { body = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && body && body.url) resolve(body);
        else { var err = new Error((body && body.error) || ("HTTP " + xhr.status)); err.http = xhr.status; reject(err); }
      };
      xhr.onerror = function () { var err = new Error("network"); err.network = true; reject(err); };
      xhr.send(item.file);
    });
  }

  function uploadViaTools(cfg, item) {
    var CHUNK = cfg.chunk_bytes || 524288;
    var total = Math.max(1, Math.ceil(item.file.size / CHUNK));
    var fileId = "f" + Date.now().toString(36) + "-" + (++up.seq);
    var i = 0;
    function next() {
      var blob = item.file.slice(i * CHUNK, Math.min(item.file.size, (i + 1) * CHUNK));
      return blob.arrayBuffer().then(function (buf) {
        return request("tools/call", { name: "media_upload_chunk", arguments: {
          ticket: cfg.ticket, file_id: fileId, index: i, total: total,
          filename: item.file.name || "upload", content_type: item.file.type || "application/octet-stream",
          data_base64: b64(buf)
        } }, 180000);
      }).then(function (res) {
        var s = res && res.structuredContent;
        if (!res || res.isError || !s) {
          var t = res && res.content && res.content[0] && res.content[0].text;
          throw new Error(t || "upload via host failed");
        }
        i++;
        item.progress = Math.min(0.98, i / total);
        drawUpload();
        if (s.url) return s;
        if (i >= total) throw new Error("no URL after the last chunk");
        return next();
      });
    }
    return next();
  }

  function startUpload(cfg, item) {
    item.state = "up"; item.progress = 0.02; drawUpload();
    var p = cfg.url ? uploadDirect(cfg, item).catch(function (e) {
      // Network/CSP failure → fall back to chunked upload through the host's tools/call.
      if (e.network && host.caps && host.caps.serverTools && cfg.ticket) { item.via = "tools"; return uploadViaTools(cfg, item); }
      throw e;
    }) : uploadViaTools(cfg, item);
    p.then(function (res) {
      item.state = "ok"; item.progress = 1; item.url = res.url; drawUpload(); maybeAutoSend(cfg);
    }).catch(function (e) {
      item.state = "bad"; item.error = e.message === "network" ? "cannot reach the upload server" : e.message; drawUpload();
    });
  }

  function addFiles(cfg, fileList) {
    if (up.sent || up.busy) return;
    var accept = cfg.accept, max = cfg.max_files;
    var live = up.files.filter(function (f) { return f.state !== "bad"; }).length;
    Array.prototype.slice.call(fileList).forEach(function (file) {
      var item = { file: file, state: "new", progress: 0, url: null, error: null, preview: null, kind: kindOf(file) };
      if (live >= max) { item.state = "bad"; item.error = "limit of " + max + " file(s)"; }
      else if (!item.kind || accept.indexOf(item.kind) < 0) { item.state = "bad"; item.error = "file type not allowed"; }
      else if (item.kind === "image" && file.size > cfg.max_image_bytes) { item.state = "bad"; item.error = "image > " + fmtBytes(cfg.max_image_bytes); }
      else if (item.kind === "video" && file.size > cfg.max_video_bytes) { item.state = "bad"; item.error = "video > " + fmtBytes(cfg.max_video_bytes); }
      try { item.preview = URL.createObjectURL(file); } catch (e) {}
      up.files.push(item);
      if (item.state === "new") { live++; startUpload(cfg, item); }
    });
    drawUpload();
  }

  function doneUrls() { return up.files.filter(function (f) { return f.state === "ok" && f.url; }).map(function (f) { return f.url; }); }
  function inFlight() { return up.files.some(function (f) { return f.state === "up"; }); }
  function maybeAutoSend(cfg) { if (!inFlight() && doneUrls().length >= cfg.max_files) sendUploads(cfg); }

  function sendUploads(cfg) {
    var urls = doneUrls();
    if (!urls.length || up.sent || up.busy || inFlight()) return;
    var text = "UPLOAD " + cfg.decision_id + ": " + urls.join(" · ");
    up.busy = true; drawUpload();
    sendChat(text).then(function () { up.sent = text; up.busy = false; remember(cfg.decision_id, text); drawUpload(); })
      .catch(function (e) { up.busy = false; up.err = { msg: e.message, text: text }; drawUpload(); });
  }

  var upCfg = null;
  function renderUpload() {
    var s = sc(); var a = data.args || {};
    if (!s && !a.decision_id) return;
    var u = (s && s.upload) || {};
    upCfg = {
      decision_id: String((s && s.decision_id) || a.decision_id || ""),
      question: (s && s.question) || a.question || "",
      accept: ((s && s.accept) || a.accept || ["image", "video"]).filter(function (k) { return k === "image" || k === "video"; }),
      max_files: Math.max(1, Number((s && s.max_files) || a.max_files || 1)),
      url: safeUrl(u.url), ticket: u.ticket || null, chunk_bytes: u.chunk_bytes,
      max_image_bytes: u.max_image_bytes || 26214400, max_video_bytes: u.max_video_bytes || 52428800,
      ready: !!(s && s.upload)
    };
    if (!up.sent) up.sent = recall(upCfg.decision_id);
    drawUpload();
  }

  function drawUpload() {
    var cfg = upCfg; if (!cfg) return;
    var locked = !!up.sent || up.busy || !cfg.ready;
    var acceptAttr = cfg.accept.map(function (k) { return k + "/*"; }).join(",");
    var input = h("input", { type: "file", class: "hidden", accept: acceptAttr, multiple: cfg.max_files > 1 });
    input.addEventListener("change", function () { addFiles(cfg, input.files); input.value = ""; });
    var kinds = cfg.accept.map(function (k) { return k === "image" ? "images" : "videos"; }).join(" and ");
    var drop = h("div", { class: "drop", role: "button", tabindex: "0", "aria-disabled": locked ? "true" : "false" }, [
      h("strong", { text: cfg.ready ? (locked ? "Sent" : "Click to choose files, or drop them here") : "Preparing upload…" }),
      h("span", { class: "muted", text: kinds + " · max " + cfg.max_files + " file(s) · images up to " + fmtBytes(cfg.max_image_bytes) + ", videos up to " + fmtBytes(cfg.max_video_bytes) })
    ]);
    if (!locked) {
      drop.addEventListener("click", function () { input.click(); });
      drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
      drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer) addFiles(cfg, e.dataTransfer.files); });
    }
    var tiles = up.files.length ? h("div", { class: "files", style: { "--cols": cols(Math.max(up.files.length, 2)) } }, up.files.map(function (f) {
      var media = h("div", { class: "media" });
      if (f.preview && f.kind === "video") media.appendChild(h("video", { src: f.preview, muted: true, playsinline: true, preload: "metadata" }));
      else if (f.preview && f.kind === "image") media.appendChild(h("img", { src: f.preview, alt: f.file.name }));
      var st = f.state === "ok" ? h("div", { class: "fstate ok", text: "Uploaded ✓" + (f.via === "tools" ? " (via host)" : "") })
        : f.state === "bad" ? h("div", { class: "fstate bad", text: "Error: " + f.error })
        : h("div", { class: "fstate", text: "Uploading… " + Math.round(f.progress * 100) + "%" });
      return h("div", { class: "card" }, [media, h("div", { class: "fname", text: f.file.name + " · " + fmtBytes(f.file.size) }),
        h("div", { class: "bar" }, [h("i", { style: { width: Math.round(f.progress * 100) + "%" } })]), st]);
    })) : null;
    var n = doneUrls().length;
    var sendBtn = h("button", { class: "primary", disabled: locked || !n || inFlight(),
      text: up.busy ? "Sending…" : "Send to chat" + (n ? " (" + n + ")" : ""), onclick: function () { sendUploads(cfg); } });
    var status = null;
    if (up.sent) status = h("div", { class: "status" }, ["Sent: ", h("code", { text: up.sent })]);
    else if (up.err) status = h("div", { class: "status bad" }, ["Could not send (" + up.err.msg + "). Copy and paste into the chat: ", h("code", { text: up.err.text })]);
    mount([cfg.question ? h("p", { class: "q", text: String(cfg.question) }) : null, drop, input, tiles,
      up.sent ? null : h("div", { class: "row" }, [sendBtn]), status]);
  }

  // ---------- mode: result ----------
  var res = { sentRef: null, busy: false, refreshing: false };
  function fileName(url, taskId) {
    var m = /\/([^\/?#]+)(?:[?#]|$)/.exec(url);
    return (m && decodeURIComponent(m[1])) || ("kie-" + taskId);
  }
  function mimeOf(url, kind) {
    var ext = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(url) || [])[1];
    ext = ext ? ext.toLowerCase() : "";
    var map = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
      mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
    return map[ext] || (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png");
  }
  function download(url, taskId, kind) {
    var name = fileName(url, taskId);
    var fallback = function () { return openLink(url); };
    if (host.ready && host.caps && host.caps.downloadFile) {
      return request("ui/download-file", { contents: [{ type: "resource_link", uri: url, name: name, mimeType: mimeOf(url, kind) }] })
        .then(function (r) { if (r && r.isError) return fallback(); }).catch(fallback);
    }
    return fallback();
  }
  function renderResult() {
    var s = sc();
    if (!s || !Array.isArray(s.results)) {
      if (data.args && data.args.task_ids) mount([h("div", { class: "loading", text: "Loading results for " + data.args.task_ids.length + " task(s)…" })]);
      return;
    }
    var cards = [];
    s.results.forEach(function (r) {
      var items = (r.items || []).filter(function (it) { return safeUrl(it.url); });
      if (r.status === "completed" && items.length) {
        items.forEach(function (it, idx) {
          var tag = items.length > 1 ? r.task_id.slice(0, 8) + " #" + (idx + 1) : r.task_id.slice(0, 10);
          var refText = "REF " + r.task_id + ": " + it.url;
          var isSent = res.sentRef === refText;
          cards.push(h("div", { class: "card" + (isSent ? " chosen" : "") }, [
            mediaEl(it.url, it.kind, tag),
            h("div", { class: "label", text: (r.api_type ? r.api_type + " · " : "") + r.task_id }),
            h("div", { class: "btns" }, [
              h("button", { text: "Download", onclick: function () { download(it.url, r.task_id, it.kind); } }),
              h("button", { class: isSent ? "primary" : "", disabled: !!res.sentRef || res.busy,
                text: isSent ? "Sent" : "Use as reference",
                onclick: function () {
                  res.busy = true; renderResult();
                  sendChat(refText).then(function () { res.sentRef = refText; res.busy = false; renderResult(); })
                    .catch(function (e) { res.busy = false; res.err = { msg: e.message, text: refText }; renderResult(); });
                } })
            ])
          ]));
        });
      } else {
        var label = r.status === "failed" ? "Failed" + (r.error ? ": " + r.error : "")
          : r.status === "completed" ? "Completed, no result URL" : r.status === "not_found" ? "Task not found" : "In progress…";
        cards.push(h("div", { class: "card" }, [
          h("div", { class: "media" }, [h("div", { class: "err", text: label })]),
          h("div", { class: "label", text: (r.api_type ? r.api_type + " · " : "") + r.task_id })
        ]));
      }
    });
    var waiting = s.results.filter(function (r) { return r.status === "processing" || r.status === "pending"; });
    var refresh = (waiting.length && host.caps && host.caps.serverTools) ? h("div", { class: "row" }, [
      h("button", { disabled: res.refreshing, text: res.refreshing ? "Refreshing…" : "Refresh (" + waiting.length + " in progress)",
        onclick: function () {
          res.refreshing = true; renderResult();
          request("tools/call", { name: "show_result", arguments: { task_ids: s.results.map(function (r) { return r.task_id; }) } }, 60000)
            .then(function (out) { if (out && out.structuredContent) data.result = out; })
            .catch(function () {}).then(function () { res.refreshing = false; renderResult(); });
        } })]) : null;
    var status = res.sentRef ? h("div", { class: "status" }, ["Sent: ", h("code", { text: res.sentRef })])
      : res.err ? h("div", { class: "status bad" }, ["Could not send (" + res.err.msg + "). Copy and paste into the chat: ", h("code", { text: res.err.text })]) : null;
    mount([h("div", { class: "grid", style: { "--cols": cols(cards.length) } }, cards), refresh, status]);
  }

  function render() {
    try {
      if (MODE === "candidates") renderCandidates();
      else if (MODE === "upload") renderUpload();
      else if (MODE === "result") renderResult();
    } catch (e) { showFatal("Widget error: " + (e && e.message)); }
  }

  connect();
})();
</script>
</body>
</html>`;

export type WidgetMode = "candidates" | "upload" | "result";

export function widgetHtml(mode: WidgetMode): string {
  return WIDGET_HTML_TEMPLATE.replace("__KIE_MODE__", mode);
}
