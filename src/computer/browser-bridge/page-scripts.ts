/**
 * Scripts that run in DreamGraph's isolated world on the page (Page.createIsolatedWorld). The page's own scripts
 * cannot see this world, so element references and helpers stay private and the page's globals stay untouched.
 * Each script is a function expression called with Runtime.callFunctionOn / Runtime.evaluate.
 */

/** Builds the page snapshot: one line per relevant element, with stable refs (e1, e2 …) for actionable ones. */
export const SNAPSHOT_SCRIPT = String.raw`(function (limits) {
  const dg = globalThis.__dreamgraph || (globalThis.__dreamgraph = { refs: new Map(), ids: new WeakMap(), seq: 0 });
  const maxLines = limits && limits.maxLines || 600, maxChars = limits && limits.maxChars || 24000;
  const INTERACTIVE_ROLES = new Set(["button","link","checkbox","radio","tab","menuitem","menuitemcheckbox","menuitemradio","option","switch",
    "textbox","searchbox","combobox","slider","spinbutton","treeitem","gridcell","listbox","menu","menubar","tablist","tree","grid","dialog","alertdialog"]);
  const TAG_ROLE = { A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", SUMMARY: "button", H1: "heading", H2: "heading",
    H3: "heading", H4: "heading", H5: "heading", H6: "heading", IMG: "img", CANVAS: "canvas", VIDEO: "video", IFRAME: "iframe", DIALOG: "dialog",
    LABEL: "label", NAV: "navigation", MAIN: "main", FORM: "form", TABLE: "table", LI: "listitem", UL: "list", OL: "list" };
  const clean = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max || 100);
  const quote = value => JSON.stringify(value);
  function inputRole(el) {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox") return "checkbox"; if (type === "radio") return "radio"; if (type === "range") return "slider";
    if (["button","submit","reset","image"].includes(type)) return "button"; if (type === "file") return "file-input";
    if (type === "number") return "spinbutton"; if (type === "search") return "searchbox"; return "textbox";
  }
  function role(el) {
    const explicit = (el.getAttribute("role") || "").split(" ")[0];
    if (explicit) return explicit;
    if (el.tagName === "INPUT") return inputRole(el);
    if (el.tagName === "A" && !el.hasAttribute("href")) return "";
    if (el.isContentEditable && (el.parentElement === null || !el.parentElement.isContentEditable)) return "textbox";
    return TAG_ROLE[el.tagName] || "";
  }
  function labelled(el) {
    const by = el.getAttribute("aria-labelledby");
    if (by) { const text = by.split(/\s+/).map(id => { const ref = document.getElementById(id); return ref ? ref.textContent : ""; }).join(" "); if (clean(text)) return clean(text); }
    const aria = el.getAttribute("aria-label"); if (clean(aria)) return clean(aria);
    if (el.labels && el.labels.length) { const text = Array.from(el.labels).map(label => label.textContent).join(" "); if (clean(text)) return clean(text); }
    for (const attribute of ["alt", "title", "placeholder"]) { const value = el.getAttribute(attribute); if (clean(value)) return clean(value); }
    return "";
  }
  function name(el, r) {
    const label = labelled(el); if (label) return label;
    if (["textbox","searchbox","combobox","spinbutton","slider","file-input"].includes(r) || el.tagName === "CANVAS" || el.tagName === "IFRAME") return "";
    return clean(el.innerText !== undefined ? el.innerText : el.textContent, 100);
  }
  function visible(el) {
    if (!el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 || el.getClientRects().length > 0;
  }
  function interactive(el, r) {
    if (INTERACTIVE_ROLES.has(r) || r === "file-input" || r === "canvas" || r === "iframe" || r === "video") return true;
    if (el.hasAttribute("onclick") || el.tabIndex >= 0 && el.hasAttribute("tabindex")) return true;
    if (getComputedStyle(el).cursor === "pointer" && !(el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer")) return true;
    return false;
  }
  function refOf(el) {
    let ref = dg.ids.get(el);
    if (!ref) { ref = "e" + (++dg.seq); dg.ids.set(el, ref); }
    dg.refs.set(ref, new WeakRef(el));
    return ref;
  }
  function directText(el) {
    let text = ""; for (const node of el.childNodes) if (node.nodeType === 3) text += node.textContent;
    return clean(text, 160);
  }
  const lines = []; let chars = 0, truncated = false, shown = 0;
  const vw = innerWidth, vh = innerHeight;
  function push(line) {
    if (lines.length >= maxLines || chars + line.length > maxChars) { truncated = true; return false; }
    lines.push(line); chars += line.length + 1; return true;
  }
  function describe(el, r, depth) {
    const parts = [(r || el.tagName.toLowerCase())];
    const container = ["navigation","main","form","list","table","menu","menubar","tablist","tree","grid","listbox","dialog","alertdialog"].includes(r);
    const n = container ? labelled(el) : name(el, r); if (n) parts.push(quote(n));
    const ref = refOf(el); parts.push("[ref=" + ref + "]");
    if (r === "heading") parts.push("[level=" + el.tagName.slice(1) + "]");
    if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("[disabled]");
    if (el.checked || el.getAttribute("aria-checked") === "true") parts.push("[checked]");
    if (el.getAttribute("aria-selected") === "true" || el.selected) parts.push("[selected]");
    const expanded = el.getAttribute("aria-expanded"); if (expanded) parts.push("[expanded=" + expanded + "]");
    if (el === document.activeElement) parts.push("[focused]");
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) parts.push("[offscreen]");
    if (r === "canvas" || r === "img" || r === "video" || r === "iframe") parts.push("[" + Math.round(rect.width) + "x" + Math.round(rect.height) + "]");
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "password") parts.push("value=" + quote(el.value ? "••••" : ""));
      else if (type !== "checkbox" && type !== "radio" && type !== "file") parts.push("value=" + quote(String(el.value || "").slice(0, 200)));
    } else if (el.isContentEditable && r === "textbox") {
      parts.push("value=" + quote(clean(el.innerText, 300)));
    }
    return "  ".repeat(depth) + "- " + parts.join(" ");
  }
  function walk(root, depth, quiet) {
    for (const el of root.children) {
      if (truncated) return;
      if (["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","HEAD","META","LINK"].includes(el.tagName)) continue;
      if (!visible(el)) continue;
      const r = role(el);
      let next = depth;
      const isContainer = r === "dialog" || r === "alertdialog" || r === "navigation" || r === "main" || r === "form" || r === "list" || r === "table" || r === "menu" || r === "tablist" || r === "tree" || r === "grid" || r === "listbox";
      if (interactive(el, r) || r === "heading" || r === "img" && labelled(el) || r === "label" || isContainer) {
        if (!push(describe(el, r, depth))) return;
        shown += 1; next = depth + 1;
        if (!isContainer && r !== "label" && r !== "listbox" && r !== "combobox") {
          // The element's name already carries its text; still walk for nested controls.
          if (el.shadowRoot) walk(el.shadowRoot, next, true);
          walk(el, next, true); continue;
        }
      } else {
        const text = quiet ? "" : directText(el);
        if (text && !push("  ".repeat(depth) + "- text " + quote(text))) return;
      }
      if (el.shadowRoot) walk(el.shadowRoot, next, quiet);
      walk(el, next, quiet);
    }
  }
  if (document.body) walk(document.body, 0, false);
  // Forget refs whose elements are gone.
  for (const [ref, weak] of dg.refs) { const el = weak.deref(); if (!el || !el.isConnected) dg.refs.delete(ref); }
  return { url: location.href, title: document.title, viewport: { width: vw, height: vh, scroll_x: Math.round(scrollX), scroll_y: Math.round(scrollY),
    device_pixel_ratio: devicePixelRatio }, focused: document.activeElement && dg.ids.get(document.activeElement) || null,
    lines: lines.join("\n"), elements: shown, truncated };
})`;

/**
 * Brings a referenced element into view and returns the point to act on (CSS pixels, viewport coordinates),
 * plus whether something else covers it there.
 */
export const RESOLVE_SCRIPT = String.raw`(function (ref) {
  const dg = globalThis.__dreamgraph;
  const weak = dg && dg.refs.get(ref), el = weak && weak.deref();
  if (!el || !el.isConnected) return { error: "BROWSER_REF_STALE" };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { error: "BROWSER_REF_NOT_VISIBLE" };
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  const covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el);
  let cover = null;
  if (covered) cover = (hit.getAttribute("aria-label") || hit.textContent || hit.tagName).replace(/\s+/g, " ").trim().slice(0, 80);
  return { x, y, box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, tag: el.tagName, covered, cover,
    editable: el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA",
    file_input: el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "file" };
})`;

/** Focuses a referenced element and, when asked, selects its current content so typing replaces it. */
export const FOCUS_SCRIPT = String.raw`(function (ref, selectAll) {
  const dg = globalThis.__dreamgraph;
  const weak = dg && dg.refs.get(ref), el = weak && weak.deref();
  if (!el || !el.isConnected) return { error: "BROWSER_REF_STALE" };
  el.focus();
  if (selectAll) {
    if (typeof el.select === "function") el.select();
    else if (el.isContentEditable) { const range = document.createRange(); range.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  }
  return { focused: document.activeElement === el || el.contains(document.activeElement) };
})`;

/** Waits (bounded) until a text appears on the page. */
export const WAIT_TEXT_SCRIPT = String.raw`(function (text, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const check = () => {
      if (document.body && document.body.innerText.includes(text)) return resolve({ found: true, waited_ms: Date.now() - started });
      if (Date.now() - started >= timeoutMs) return resolve({ found: false, waited_ms: Date.now() - started });
      setTimeout(check, 100);
    };
    check();
  });
})`;

/** Binding through which the page hook reports File System Access pickers (needs Runtime enabled on the tab). */
export const FILE_PICKER_BINDING = "__dreamgraphPicker";

/**
 * Runs in the page's own world (Page.addScriptToEvaluateOnNewDocument + once now). Wraps the File System Access
 * pickers so DreamGraph learns when the browser shows an OS file dialog (save/open/folder) and how it ended.
 * The pickers behave exactly as before; only the reports are added.
 */
export const FILE_PICKER_HOOK = String.raw`(function () {
  if (window.__dreamgraphPickerHook) return;
  Object.defineProperty(window, "__dreamgraphPickerHook", { value: true });
  const report = data => { try { if (typeof window.__dreamgraphPicker === "function") window.__dreamgraphPicker(JSON.stringify(data)); } catch (error) { /* reporting must never break the page */ } };
  // DreamGraph intercepts <input type=file> choosers, and Chrome's interception would also abort these pickers.
  // While DreamGraph controls the tab, a picker waits (at most 3 s) until DreamGraph has let this one through.
  const waiting = new Map();
  Object.defineProperty(window, "__dreamgraphPickerGo", { value: id => { const go = waiting.get(id); if (go) { waiting.delete(id); go(); } } });
  let sequence = 0;
  for (const kind of ["showSaveFilePicker", "showOpenFilePicker", "showDirectoryPicker"]) {
    const original = window[kind];
    if (typeof original !== "function") continue;
    const wrapped = function (options) {
      const id = ++sequence, self = this, args = arguments;
      const types = options && Array.isArray(options.types) ? options.types.map(type => ({ description: String(type.description || ""),
        accept: Object.values(type.accept || {}).flat().map(String) })) : [];
      const controlled = typeof window.__dreamgraphPicker === "function" && !window.__dreamgraphPickerOff;
      report({ phase: "open", id, kind: kind === "showSaveFilePicker" ? "save" : kind === "showOpenFilePicker" ? "open" : "folder",
        suggested_name: options && options.suggestedName ? String(options.suggestedName) : null, types, multiple: !!(options && options.multiple) });
      const ready = controlled ? new Promise(resolve => { waiting.set(id, resolve); setTimeout(() => { if (waiting.delete(id)) resolve(); }, 3000); }) : Promise.resolve();
      const result = ready.then(() => original.apply(self, args));
      result.then(
        value => report({ phase: "closed", id, outcome: "chosen", names: [].concat(value).map(handle => handle && handle.name).filter(Boolean) }),
        error => report({ phase: "closed", id, outcome: error && error.name === "AbortError" ? "cancelled" : "error", message: String(error && error.message || error) }));
      return result;
    };
    Object.defineProperty(wrapped, "name", { value: kind });
    window[kind] = wrapped;
  }
})();`;
