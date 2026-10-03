# TDD Plan v2: Cognitive Output — Implementation Plan

**Source:** `plans/TDD_COGNITIVE_OUTPUT.md` (product spec)
**Gate:** `plans/TDD_COGNITIVE_OUTPUT_READINESS_REVIEW.md` (all blockers addressed below)
**Status:** Implementation-ready
**Scope:** `extensions/vscode/` only — no daemon, no MCP protocol changes

---

## Baseline Reality

These facts were verified against the live codebase and constrain every decision in this plan.

| Fact | Value |
|------|-------|
| Rendering engine | `div.textContent = content` — raw plain text, no HTML |
| Webview architecture | Inline HTML string in `chat-panel.ts` (~1125 lines), no separate webview files |
| Framework | Vanilla JS, no React/Vue/Svelte, no bundler |
| Dependencies | Single production dep: `@modelcontextprotocol/sdk` |
| `markdown-it` | **NOT** in `package.json` dependencies (only in root lockfile) |
| `dompurify` | **NOT** installed anywhere |
| CSP policy | `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:` |
| Streaming | `streamingContent += chunk` → `streamingEl.textContent += chunk` |
| Message protocol | Union types with `type` discriminator, inline in `chat-panel.ts` |
| Build | `tsc -p ./tsconfig.json` → `dist/` |
| Test framework | Node `assert` + `suite/test` (VS Code extension test host) |
| Existing test | `src/test/chat-memory.test.ts` only |

---

## MVP Definition — Slice 1

**Ship target:** Safe markdown rendering with code block copy, external link handling, and streaming integrity.

### In Scope

| Feature | Tests |
|---------|-------|
| markdown-it rendering (headings, bold, italic, inline code, lists, tables) | T-1.1, T-1.4, T-1.5, T-1.6 |
| Fenced code blocks with language class | T-1.2 |
| Code block copy button | T-1.3 |
| XSS prevention via DOMPurify | T-1.8, T-1.8b, T-1.8c |
| External links open via extension host | T-1.9 |
| Streaming markdown integrity (debounced rerender) | T-1.7 |
| Streaming debounce at ~80ms | T-P.1 |
| Render budget < 250ms for large messages | T-P.2 |

### Explicitly Deferred (Not in Slice 1)

| Feature | Deferred To |
|---------|-------------|
| Entity links (explicit URIs) | Slice 2 |
| Implicit entity detection | Slice 5+ |
| Structured cards (entity/adr/tension/insight) | Slice 3 |
| Graph-backed verification markers | Slice 4 |
| Verdict banner, tool trace, action blocks | Slice 4–5 |
| Empty state with example prompts | Slice 2 (low effort, but not MVP) |
| Thinking indicator overhaul | Slice 2 |
| Message hover actions (copy/retry/pin) | Slice 5+ |
| Role header / context footer | Slice 5+ |
| Secret/sensitive data redaction (S-2) | Slice 4 (before tool trace ships) |
| Action safety gating (S-6) | Slice 5 (ships WITH action blocks) |

---

## Module Ownership Map

Slice 1 introduces a clean separation. No file exceeds one responsibility.

```
extensions/vscode/src/
├── chat-panel.ts              ← MODIFY: webview plumbing, message dispatch, streaming lifecycle
│                                 REMOVE: inline textContent rendering
│                                 ADD: import and call render-markdown
│
├── webview/                   ← NEW DIRECTORY
│   ├── render-markdown.ts     ← NEW: script-string generator for inline webview JS
│   │                             Exports getRenderScript(): string
│   │                             NOT a pure TS rendering utility — the webview has no module system
│   │                             Contains the markdown-it config, DOMPurify config, and renderMarkdown()
│   │                             function as a JavaScript string template
│   ├── protocol.ts            ← NEW: all message payload types (discriminated unions)
│   └── styles.ts              ← NEW: CSS string constants (extracted from chat-panel.ts inline styles)
│
├── types.ts                   ← EXISTS: shared types (no changes in Slice 1)
└── ...
```

### File Responsibilities

| File | Owns | Does NOT Own |
|------|------|-------------|
| `chat-panel.ts` | Webview lifecycle, `postMessage` dispatch, streaming accumulation, `getHtml()` shell, attachment handling | Markdown parsing, sanitization, CSS constants |
| `webview/render-markdown.ts` | `getRenderScript(): string` — returns the JavaScript source for the webview-side render pipeline. Contains markdown-it instantiation, DOMPurify configuration, `renderMarkdown(content)` function, and code-block enhancement logic as a JS string template. **This is Option A architecture: script-string generator, not a bundled module.** | Message protocol, streaming logic, webview lifecycle, DOM manipulation outside the render function |
| `webview/protocol.ts` | All `ExtensionToWebview` and `WebviewToExtension` message type definitions | Rendering, business logic |
| `webview/styles.ts` | CSS string constants for all webview styles | HTML structure, JS behavior |

### Why This Structure

- `render-markdown.ts` is a **script-string generator**: `() → JavaScript source string`. The webview has no module system, so this file produces the JS text that gets injected into the `getHtml()` template. Unit tests validate the generated string contains expected patterns and that `markdown-it` (which does run in Node) produces correct HTML structures.
- `protocol.ts` is **the single source of truth** for message shapes. Both extension host and webview code import from here (or duplicate the types — the webview JS is inline, so the types serve as documentation and compile-time checking for the host side).
- `styles.ts` stops the CSS-in-string problem from growing. Slice 2+ will add entity link styles, card styles, etc.

---

## Message Contracts

### Existing Messages (No Changes in Slice 1)

These already work and are not modified:

| Message | Direction | Payload |
|---------|-----------|---------|
| `ready` | webview → ext | `{}` |
| `send` | webview → ext | `{ text: string }` |
| `clear` | webview → ext | `{}` |
| `stop` | webview → ext | `{}` |
| `addMessage` | ext → webview | `{ role: string, content: string }` |
| `stream-start` | ext → webview | `{}` |
| `stream-chunk` | ext → webview | `{ chunk: string }` |
| `stream-thinking` | ext → webview | `{ visible: boolean }` |
| `stream-end` | ext → webview | `{}` |
| `state` | ext → webview | `{ messages: ChatMessage[] }` |
| `error` | ext → webview | `{ message: string }` |

### New Messages — Slice 1

| Message | Direction | Type | Payload | Response | Notes |
|---------|-----------|------|---------|----------|-------|
| `openExternalLink` | webview → ext | fire-and-forget | `{ url: string }` | none | Webview intercepts `<a>` clicks, posts URL to host. Host calls `vscode.env.openExternal`. |
| `copyToClipboard` | webview → ext | fire-and-forget | `{ text: string }` | none | Code block copy button posts content to host. Host calls `vscode.env.clipboard.writeText`. Avoids requiring clipboard permission in webview CSP. |

### New Messages — Slice 2 (Defined Now, Implemented Later)

| Message | Direction | Type | Payload | Response | Notes |
|---------|-----------|------|---------|----------|-------|
| `navigateEntity` | webview → ext | fire-and-forget | `{ uri: string }` | none | Entity link click. URI format: `type://name`. Host resolves entity. |

### New Messages — Slice 4 (Defined Now, Implemented Later)

| Message | Direction | Type | Payload | Response | Notes |
|---------|-----------|------|---------|----------|-------|
| `verifyEntities` | webview → ext | request | `{ requestId: string, names: string[] }` | `entityStatus` | Batch verification. One in-flight at a time. |
| `entityStatus` | ext → webview | response | `{ requestId: string, results: Record<string, { status: 'verified'\|'latent'\|'unverified'\|'tension', confidence: number, lastValidated?: string }> }` | none | Response to `verifyEntities`. Correlated by `requestId`. |
| `toolTrace` | ext → webview | fire-and-forget | `{ calls: Array<{ tool: string, argsSummary: string, filesAffected: string[], durationMs: number }> }` | none | Sent once at stream-end. Only sent if tools were used. |
| `executeAction` | webview → ext | request | `{ requestId: string, action: string, context: Record<string, unknown> }` | `actionResult` | User clicked action button. Host validates before executing. |
| `actionResult` | ext → webview | response | `{ requestId: string, success: boolean, error?: string }` | none | Result of action execution. |

### Protocol Type Definitions

```typescript
// webview/protocol.ts

// ── Webview → Extension ─────────────────────────────────────
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'clear' }
  | { type: 'stop' }
  | { type: 'pickAttachments' }
  | { type: 'removeAttachment'; id: string }
  | { type: 'pasteImage'; dataBase64: string; mimeType: string }
  | { type: 'changeProvider'; provider: string }
  | { type: 'changeModel'; model: string }
  | { type: 'setApiKey' }
  | { type: 'saveDraft'; text: string }
  // Slice 1
  | { type: 'openExternalLink'; url: string }
  | { type: 'copyToClipboard'; text: string }
  // Slice 2
  | { type: 'navigateEntity'; uri: string }
  // Slice 4+
  | { type: 'verifyEntities'; requestId: string; names: string[] }
  | { type: 'executeAction'; requestId: string; action: string; context: Record<string, unknown> }

// ── Extension → Webview ─────────────────────────────────────
export type ExtensionToWebviewMessage =
  | { type: 'addMessage'; role: string; content: string }
  | { type: 'stream-start' }
  | { type: 'stream-chunk'; chunk: string }
  | { type: 'stream-thinking'; visible: boolean }
  | { type: 'stream-end' }
  | { type: 'state'; messages: Array<{ role: string; content: string }> }
  | { type: 'updateModels'; providers: unknown }
  | { type: 'setAttachments'; attachments: unknown[] }
  | { type: 'error'; message: string }
  | { type: 'restoreDraft'; text: string }
  // Slice 4+
  | { type: 'entityStatus'; requestId: string; results: Record<string, EntityVerification> }
  | { type: 'toolTrace'; calls: ToolTraceEntry[] }
  | { type: 'actionResult'; requestId: string; success: boolean; error?: string }

export interface EntityVerification {
  status: 'verified' | 'latent' | 'unverified' | 'tension';
  confidence: number;
  lastValidated?: string;
}

export interface ToolTraceEntry {
  tool: string;
  argsSummary: string;
  filesAffected: string[];
  durationMs: number;
}
```

---

## Test Strategy

### Test Framework and Environment

| Test Type | Framework | Environment | Location |
|-----------|-----------|-------------|----------|
| Render pipeline unit tests | `node:test` (`suite`/`test`) + `node:assert` | Plain Node (no VS Code host) | `src/test/render-markdown.test.ts` |
| Security sanitization tests | `node:test` + `node:assert` | Plain Node | `src/test/render-security.test.ts` |
| Protocol type correctness | TypeScript compiler | Build-time | `webview/protocol.ts` (compiles = pass) |
| Integration tests | Manual smoke | VS Code Extension Development Host | Smoke checklist below |

**Slice 1 test harness decision:** Plain `node:test` runner only. No VS Code extension test host, no `linkedom`, no `jsdom`.

Rationale:
- `render-markdown.ts` in Slice 1 is a **script-string generator** (see Module Architecture below). Its output is a JavaScript string, not a DOM.
- Slice 1 unit tests validate the **generated script string** contains expected patterns (e.g., `DOMPurify.sanitize`, `md.render`, correct allowlists) and that the render function template produces correct HTML when fed through `markdown-it` in Node (markdown-it runs in Node without a DOM).
- DOMPurify requires a DOM. In Slice 1 we do NOT test DOMPurify output in Node. DOMPurify sanitization is verified via manual smoke tests (SM-1 through SM-5) and by the XSS test fixtures that assert `markdown-it` output does not contain dangerous patterns even before sanitization.
- If Slice 3 adds `linkedom` for DOM-level card rendering tests, that is a Slice 3 decision, not a Slice 1 dependency.

**Existing extension tests** (`src/test/chat-memory.test.ts`) remain unchanged and run in their current harness.

### Test-to-Phase Mapping

#### Slice 1 — Automated Tests

| Test ID | Test Name | Assert On |
|---------|-----------|-----------|
| T-1.1 | Basic markdown elements | Output contains `<strong>`, `<em>`, `<code>` |
| T-1.2 | Fenced code blocks | Output contains `<pre><code class="language-ts">` |
| T-1.3 | Code block copy button | Output contains copy button HTML adjacent to `<pre>` |
| T-1.4 | Headings | Output contains `<h2>`, `<h3>` with correct text |
| T-1.5 | Tables | Output contains `<table>`, `<th>`, `<td>` |
| T-1.6 | Lists | Output contains `<ul>`, `<ol>`, `<li>` |
| T-1.7 | Partial markdown safety | Partial input `**bol` does not produce broken tags |
| T-1.8 | XSS script tag | Output does NOT contain `<script>` |
| T-1.8b | XSS javascript URI | Output does NOT contain `javascript:` |
| T-1.8c | XSS attribute injection | Output does NOT contain `onerror` |
| T-1.9 | External links | Output `<a>` tags have `target="_blank"` and `rel="noopener noreferrer"` |
| T-S3.4 | Copy safety | `renderMarkdown` input/output roundtrip contains no active HTML |

#### Slice 1 — Manual Smoke Tests

| # | Scenario | Expected |
|---|----------|----------|
| SM-1 | Open Architect, send "explain markdown" → response renders with bold, code blocks, headings | Styled output, not raw `**text**` |
| SM-2 | During streaming, observe progressive rendering | No broken HTML, no flicker, debounced updates |
| SM-3 | Click a code block copy button | Content copied, button shows "Copied" briefly |
| SM-4 | Click an external link in a response | Opens in default browser, webview stays |
| SM-5 | Send a message that triggers a very long response (>4 KB) | Renders within 250ms after stream-end, no scroll jank |
| SM-6 | Package extension with `vsce package`, install `.vsix`, open Architect | Markdown renders correctly (libraries loaded from packaged install) |
| SM-7 | Delete `markdown-it.min.js` from installed extension, reopen Architect | Falls back to plaintext, error logged in Output channel |

### Fixture Strategy

Test fixtures live in `src/test/fixtures/`:

```
src/test/fixtures/
├── markdown-basic.md        ← headings, bold, italic, code, lists, tables
├── markdown-code-blocks.md  ← multiple fenced blocks with language tags
├── markdown-xss.md          ← script tags, javascript: URIs, onerror attributes
├── markdown-partial.md      ← intentionally incomplete markdown (streaming simulation)
└── markdown-large.md        ← 6 KB message for performance baseline
```

---

## Dependency Changes

### New Production Dependencies

| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| `markdown-it` | `^14.0.0` | ~100 KB | Markdown → HTML parsing |
| `dompurify` | `^3.2.0` | ~7 KB minified | HTML sanitization (primary XSS defense) |

### Installation

```bash
cd extensions/vscode
npm install markdown-it dompurify
npm install -D @types/markdown-it @types/dompurify
```

### Webview Bundling Problem

**Problem:** The webview runs in an iframe-like sandbox. It cannot `require()` or `import` Node modules. Currently all webview JS is inline in the `getHtml()` template string.

**Solution for Slice 1:**

`markdown-it` and `dompurify` must be available inside the webview. Two options:

| Option | Approach | Tradeoff |
|--------|----------|----------|
| **A — Inline UMD bundles** | Read the UMD/browser builds of `markdown-it` and `dompurify` from `node_modules`, embed as `<script>` tags in `getHtml()` with the CSP nonce | No bundler needed. Increases `getHtml()` size by ~110 KB. Libraries loaded on every webview open. |
| **B — Extension-side rendering** | Run `markdown-it` + `DOMPurify` (via `jsdom` or a server-side DOMPurify variant) in the extension host. Send sanitized HTML to the webview. | Clean separation. Webview receives safe HTML. But requires `jsdom` or `linkedom` as a dependency for `DOMPurify` (it needs a DOM). |
| **C — Pre-bundle into a webview JS file** | Use `esbuild` to bundle `markdown-it` + `dompurify` + webview JS into a single `dist/webview.js`. Reference via `webview.asWebviewUri()`. | Cleanest long-term. Requires adding `esbuild` to build pipeline. |

**Recommended: Option A for Slice 1, migrate to Option C in Slice 3.**

Rationale:
- Option A requires zero build tooling changes
- The two libraries total ~110 KB unminified, acceptable for a sidebar webview
- Option C is the right long-term answer but is a build infrastructure change that should not block MVP
- Option B adds server-side DOM dependencies, which is worse than either A or C

### Option A Implementation Detail

In `getHtml()`:

```typescript
// Read browser builds at activation time (cached)
const markdownItSource = fs.readFileSync(
  path.join(context.extensionPath, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js'),
  'utf-8'
);
const domPurifySource = fs.readFileSync(
  path.join(context.extensionPath, 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
  'utf-8'
);
```

Then in the HTML template:

```html
<script nonce="${nonce}">${markdownItSource}</script>
<script nonce="${nonce}">${domPurifySource}</script>
<script nonce="${nonce}">
  const md = window.markdownit();
  function renderMarkdown(content) {
    return DOMPurify.sanitize(md.render(content));
  }
  // ... rest of webview JS
</script>
```

### CSP Update

No CSP changes needed for Option A — library code runs under the same nonce-based `script-src` policy.

### Packaging & Runtime Guarantees

**Asset availability contract:**
The browser builds `node_modules/markdown-it/dist/markdown-it.min.js` and `node_modules/dompurify/dist/purify.min.js` MUST be present in the packaged `.vsix`.

**Packaging steps:**
1. Verify `.vscodeignore` does NOT exclude `node_modules/markdown-it/dist/` or `node_modules/dompurify/dist/`
2. After `vsce package`, inspect the `.vsix` (it's a zip) and confirm both `.min.js` files are included
3. Add this as a manual verification item in the smoke test checklist

**Fallback behavior:**
If either file read fails at runtime (file missing, permission error, corrupt content):
- Log an explicit error: `"[DreamGraph] Failed to load ${lib} browser build — falling back to plaintext rendering"`
- Fall back to the existing `textContent` rendering path (raw markdown, no HTML)
- The webview remains functional, just without rich rendering
- Do NOT crash, throw, or show an empty panel

**Dev-mode vs packaged-mode:**
- In dev mode (`F5` launch): files are read from `context.extensionPath + '/node_modules/...'`
- In packaged mode: same path, but relative to the installed extension directory
- Both paths use the same `context.extensionPath` base — no conditional logic needed

---

## Implementation Steps — Slice 1

### Step 1: Install Dependencies

```bash
cd extensions/vscode
npm install markdown-it dompurify
npm install -D @types/markdown-it @types/dompurify
```

Verify `node_modules/markdown-it/dist/markdown-it.min.js` and `node_modules/dompurify/dist/purify.min.js` exist.

### Step 2: Create `webview/protocol.ts`

Extract all message type definitions from `chat-panel.ts` inline comments into the typed union shown in the Message Contracts section above. This file is compile-time only — the webview JS does not import it.

### Step 3: Create `webview/styles.ts`

Extract the CSS string from `getHtml()` in `chat-panel.ts` into a separate file that exports a `getStyles(): string` function. Add new styles for:

- `.markdown-body` — container for rendered markdown content
- `.markdown-body pre` — code block styling with `--vscode-textCodeBlock-background`
- `.markdown-body pre .copy-btn` — positioned top-right, VS Code button theming
- `.markdown-body table` — bordered table with header row distinction
- `.markdown-body a` — link styling with `--vscode-textLink-foreground`
- `.markdown-body h2, h3` — heading weight without breaking message bubble

### Step 4: Create `webview/render-markdown.ts`

This file exports a `getRenderScript(): string` function that returns the webview-side JavaScript for the markdown render pipeline. It is called from `getHtml()` to inject the render function.

The render function exposed to the webview:

```javascript
// Inside webview context (injected as string)
const md = window.markdownit({ html: false, linkify: true, typographer: false });

function renderMarkdown(content) {
  const raw = md.render(content);
  const clean = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','strong','em','code',
                   'pre','blockquote','ul','ol','li','table','thead','tbody',
                   'tr','th','td','a','img','span','div','hr'],
    ALLOWED_ATTR: ['href','src','alt','class','target','rel'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
  });
  return clean;
}
```

**Key decisions:**
- `html: false` in markdown-it config — do NOT allow raw HTML pass-through from LLM output. The LLM is untrusted; letting it emit arbitrary HTML increases attack surface.
- DOMPurify allowlist is explicit (not a blocklist).
- `ALLOW_DATA_ATTR: false` — no `data-*` attributes from LLM content.

### Step 5: Modify `chat-panel.ts` — Library Injection

In `getHtml()`, inject the browser builds of `markdown-it` and `dompurify` as inline `<script>` tags before the main webview script. Cache the file reads at class construction time.

### Step 6: Modify `chat-panel.ts` — Render Path

Replace the two rendering paths:

**Before (message render):**
```javascript
div.textContent = content;
```

**After (message render):**
```javascript
div.innerHTML = renderMarkdown(content);
```

**Before (streaming):**
```javascript
streamingEl.textContent += chunk;
```

**After (streaming):**
```javascript
streamingContent += chunk;
// Debounced rerender
clearTimeout(renderTimer);
renderTimer = setTimeout(() => {
  streamingEl.innerHTML = renderMarkdown(streamingContent);
}, 80);
```

### Streaming Render Contract

One explicit rule governs all partial-content rendering during streaming:

1. **During streaming**, incomplete markdown is rendered best-effort by `markdown-it` on every debounce interval (~80ms). No syntax repair beyond what `markdown-it` does by default (it handles unclosed tags gracefully).
2. **No code-copy buttons** are injected during streaming. They are added once at `stream-end`.
3. **No structured card parsing** occurs during streaming (Slice 1–3). Incomplete fenced blocks render as plain code blocks until `stream-end`.
4. **No entity link detection** occurs during streaming (Slice 2+). Entity linkification runs once at `stream-end`.
5. **Scroll anchoring:** After each debounced rerender, if the user was scrolled to the bottom before the rerender, scroll position is restored to the bottom. If the user has scrolled up manually, position is preserved (no forced scroll-to-bottom).

This means the streaming render path is: `accumulate chunk → debounce → markdown-it.render(accumulated) → DOMPurify.sanitize() → innerHTML assignment`. All post-processing (copy buttons, entity links, cards, verification) is deferred to `stream-end`.

### Step 7: Modify `chat-panel.ts` — Code Block Copy Buttons

After `renderMarkdown()` produces HTML, inject copy buttons into code blocks:

```javascript
function addCopyButtons(container) {
  container.querySelectorAll('pre > code').forEach(block => {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyToClipboard', text: block.textContent });
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
    block.parentElement.style.position = 'relative';
    block.parentElement.insertBefore(btn, block);
  });
}
```

**Idempotency rule:** Copy buttons are added **only after final render** for each message lifecycle:
- **Completed messages** (from `addMessage` or `state` hydration): `renderMarkdown()` → `innerHTML` assignment → `addCopyButtons()` once.
- **Streaming messages:** Copy buttons are NOT added during streaming. They are added once at `stream-end`, after the final `renderMarkdown()` call.
- **Rerenders** (e.g., webview visibility restore): The entire `innerHTML` is rebuilt from source content via `renderMarkdown()`, then `addCopyButtons()` runs once on the fresh DOM. No stale buttons survive because `innerHTML` replacement destroys previous DOM.

This means: no `data-copy-enhanced` guard needed. The pattern is always **rebuild then enhance**, never **enhance in place**.

### Step 8: Modify `chat-panel.ts` — Link Interception

Intercept all `<a>` clicks in the webview to route through the extension host:

```javascript
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  e.preventDefault();
  const href = link.getAttribute('href');
  if (href && href.startsWith('http')) {
    vscode.postMessage({ type: 'openExternalLink', url: href });
  }
});
```

### Step 9: Modify `chat-panel.ts` — Extension Host Message Handlers

Add handlers for the two new message types:

```typescript
case 'openExternalLink': {
  const url = message.url;
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }
  break;
}
case 'copyToClipboard': {
  if (typeof message.text === 'string') {
    vscode.env.clipboard.writeText(message.text);
  }
  break;
}
```

**Security note:** The `openExternalLink` handler validates that the URL uses `http://` or `https://` scheme. No `javascript:`, `file:`, `vscode:`, or other schemes are allowed.

### Step 10: Write Unit Tests

Create `src/test/render-markdown.test.ts` using `node:test`:

```typescript
import { suite, test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';

// Tests run markdown-it in Node (no DOM needed) to validate HTML structure.
// DOMPurify sanitization is NOT tested in Node — it requires a DOM and is
// verified via manual smoke tests. See Test Strategy section.

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

suite('Markdown Rendering', () => {
  test('T-1.1: bold, italic, inline code', () => {
    const html = md.render('**bold** *italic* `code`');
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<code>code<\/code>/);
  });

  test('T-1.2: fenced code block with language', () => {
    const html = md.render('```ts\nconst x = 1;\n```');
    assert.match(html, /<pre><code class="language-ts">/);
  });

  test('T-1.4: headings', () => {
    const html = md.render('## Heading 2\n### Heading 3');
    assert.match(html, /<h2>Heading 2<\/h2>/);
    assert.match(html, /<h3>Heading 3<\/h3>/);
  });

  test('T-1.5: tables', () => {
    const html = md.render('| A | B |\n|---|---|\n| 1 | 2 |');
    assert.match(html, /<table>/);
    assert.match(html, /<th>A<\/th>/);
    assert.match(html, /<td>1<\/td>/);
  });

  test('T-1.6: lists', () => {
    const html = md.render('- a\n- b\n\n1. c\n2. d');
    assert.match(html, /<ul>/);
    assert.match(html, /<ol>/);
    assert.match(html, /<li>/);
  });

  test('T-1.7: partial markdown does not break', () => {
    const html = md.render('**bol');
    assert.doesNotMatch(html, /<strong>[^<]*$/); // no unclosed strong tag
  });
});

suite('XSS Prevention (markdown-it with html:false)', () => {
  test('T-1.8: script tags are escaped', () => {
    const html = md.render('<script>alert("xss")</script>');
    assert.doesNotMatch(html, /<script>/);
  });

  test('T-1.8b: javascript: URIs are not active links', () => {
    const html = md.render('[click](javascript:alert(1))');
    assert.doesNotMatch(html, /javascript:/);
  });

  test('T-1.8c: onerror attributes are escaped', () => {
    const html = md.render('<img src=x onerror="alert(1)">');
    assert.doesNotMatch(html, /onerror/);
  });
});
```

**What these tests cover:** `markdown-it` structural output with `html: false`. This validates that the first stage of the pipeline (markdown parsing) produces correct structure and that `html: false` blocks raw HTML/script injection before DOMPurify even runs.

**What these tests do NOT cover:** DOMPurify sanitization output. That is verified via smoke tests SM-1 through SM-5 in the Extension Development Host.

### Step 11: Verify Build

```bash
cd extensions/vscode
npm run build
```

Ensure no TypeScript errors. The new files under `webview/` compile as part of the existing `rootDir: ./src` config.

---

## Implementation Steps — Slice 2

**Prerequisite:** Slice 1 merged and stable.

### Scope

| Feature | Tests |
|---------|-------|
| Explicit entity URI linkification | T-2.1, T-2.2, T-2.3, T-2.5 |
| Entity links inert inside code blocks | T-2.4 |
| Entity link click → host navigation | T-2.3 |
| Entity link URI injection safety | T-S1.4, T-S3.1 |
| Empty state with example prompts | T-6.4 |
| Thinking indicator overhaul | T-6.2 |

### New Files

| File | Purpose |
|------|---------|
| `webview/entity-links.ts` | Post-process rendered HTML: regex scan for `type://name` URIs, wrap in `<a class="entity-link">`, skip content inside `<pre>`/`<code>` |

### New Message Handlers

- `navigateEntity` — webview → ext — host resolves entity URI and opens detail

### Entity Link Processing

Runs AFTER `renderMarkdown()`, BEFORE DOM insertion:

```javascript
function linkifyEntities(html) {
  const pattern = /\b(feature|workflow|entity|adr|tension|edge|file):\/\/[\w.\/@→-]+/g;
  // Skip matches inside <pre>...</pre> and <code>...</code>
  // Replace matches with <a class="entity-link" data-type="$1" data-uri="$0">icon $name</a>
  return processed;
}
```

---

## Implementation Steps — Slice 3

**Prerequisite:** Slice 2 merged and stable.

### Scope

| Feature | Tests |
|---------|-------|
| Structured card rendering (entity, adr, tension, insight) | T-3.1 through T-3.5 |
| Card collapse/expand | T-3.6 |
| Cards during streaming (fallback to code block until complete) | T-3.7 |
| Unknown block type fallback | T-3.5 |
| Malformed card content handling | Review item #8 |

### New Files

| File | Purpose |
|------|---------|
| `webview/card-renderer.ts` | Custom markdown-it fence plugin: detect `entity`/`adr`/`tension`/`insight` language tags, parse YAML-like body, emit card HTML |

### Build Migration

**Migrate from Option A (inline libraries) to Option C (esbuild bundle).**

At this point the webview JS is complex enough to justify a bundler:

```bash
npm install -D esbuild
```

Add to `package.json` scripts:

```json
"build:webview": "esbuild src/webview/index.ts --bundle --outfile=dist/webview.js --format=iife --platform=browser"
```

The `getHtml()` method switches from inline `<script>` tags to a `<script src="${webviewJs}">` reference using `webview.asWebviewUri()`.

### Card Data Source

Cards are driven by **markdown fences in LLM output**. The LLM is instructed via system prompt to use these block types. No post-processing transforms or tool payloads — the fence syntax is the contract.

If the fence body is malformed (invalid YAML-like syntax, missing required fields):
- Render as a regular code block with the fence language tag shown
- No error, no broken card, no crash

---

## Implementation Steps — Slice 4

**Prerequisite:** Slice 3 merged and stable. Protocol for `verifyEntities`/`entityStatus` proven.

### Scope

| Feature | Tests |
|---------|-------|
| Verdict banner (rendered from LLM structured output) | T-5.1, T-5.2 |
| Collapsible tool trace | T-5.3, T-5.4, T-5.5 |
| Graph-backed verification markers | T-4.1 through T-4.7 |
| Batched verification (one round-trip) | T-4.5 |
| Secret/sensitive data redaction | T-S2.1, T-S2.2, T-S2.3 |
| Provenance labels | T-S4.1, T-S4.2, T-S4.3 |
| Verification rate limiting | T-S7.4 |

### Graph Verification Data Flow

1. Message stream completes (`stream-end`)
2. Webview extracts all entity-like tokens from rendered content (excluding `<pre>`/`<code>`)
3. Webview posts `{ type: 'verifyEntities', requestId, names }` — max one in-flight
4. Extension host calls `McpClient` → daemon `query_resource` with batch of names
5. Extension host posts `{ type: 'entityStatus', requestId, results }` back
6. Webview applies markers in a single `requestAnimationFrame` pass

**Fallback when verification unavailable:**
- If daemon is disconnected: skip verification, show no markers, log warning
- If batch returns partial results: mark missing entities as `unverified`
- If request times out (5s): cancel, show no markers for that message

### Tool Trace Data Source

Tool trace entries are sourced **exclusively from actual executed tool calls in the chat panel's tool-result continuation loop** — the same `tool_use` / `tool_result` records that drive the agentic iteration in `chat-panel.ts`.

Specifically:
- Each `ToolTraceEntry` corresponds to a real `tool_use` block that was executed, received a `tool_result`, and was fed back into the next iteration
- Tool names, durations, and affected files come from the extension host's execution records, not from LLM prose, fenced blocks, or client-side parsing
- If the model mentions a tool in narrative text but did not actually execute it, that tool does NOT appear in the trace
- If a tool call failed or was rejected, it DOES appear in the trace with its failure status

This is required by **ADR-007** (Preserve end-to-end agentic tool execution loop in VS Code chat panel). The tool trace UI is a view over real execution, not a narration layer.

At `stream-end`, assemble `ToolTraceEntry[]` from these execution records and post as `toolTrace` message. **No new daemon API needed.**

### Secret Redaction Strategy

Redaction happens **extension-side, before posting content to webview**:

```typescript
const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|passwd|auth)\s*[:=]\s*\S+/gi,
  /(?:sk-|pk-|ghp_|gho_|github_pat_)\S+/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g,
];

function redactSecrets(content: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) =>
    text.replace(pattern, (match) => {
      const colonIdx = match.search(/[:=]\s*/);
      if (colonIdx >= 0) {
        return match.slice(0, colonIdx + 1) + ' ****';
      }
      return match.slice(0, 8) + '****';
    }),
    content
  );
}
```

Applied in the streaming path before posting chunks to webview, and on completed messages before posting `addMessage`.

---

## Implementation Steps — Slice 5

**Prerequisite:** Slice 4 merged and stable.

### Scope

| Feature | Tests |
|---------|-------|
| Action blocks with primary/secondary buttons | T-5.6, T-5.7, T-5.8 |
| Action execution safety gating | T-S6.1 through T-S6.4 |
| Resource exhaustion limits | T-S7.1, T-S7.2, T-S7.3 |
| Message hover actions (copy/retry/pin) | T-6.5 |
| Role header and context footer | T-6.1, T-6.3 |
| Instance isolation verification | T-S5.1, T-S5.2 |
| Implicit entity detection (2b) | T-2b.1 through T-2b.3 |

### Action Execution Safety Constraints

These are non-negotiable rules that gate Slice 5 shipping:

1. **No action auto-executes.** Action buttons render as interactive but require explicit user click.
2. **No optimistic success.** Button shows loading state on click. Success state only after host confirms completion.
3. **Destructive actions require confirmation.** File writes, graph mutations, entity deletions trigger `vscode.window.showWarningMessage` confirmation before execution.
4. **Action allowlist.** Extension host maintains a list of permitted action types. Unknown action types are rejected with error.
5. **Tool trace reflects reality.** Tool trace entries are assembled from actual `McpClient` execution records. No narrated or inferred tool calls appear in the trace.
6. **No action may bypass the real tool execution path.** All action execution goes through the existing `McpClient` → daemon pipeline.
7. **Action provenance is logged.** Every action execution (success or failure) is appended to the event log with timestamp, action type, source message ID, and outcome.

### Resource Limits

| Limit | Value | Behavior |
|-------|-------|----------|
| Max message render size | 100 KB | Truncate with "[Response truncated]" + "Show full" action |
| Max entity links per message | 100 | Cap with notice |
| Max card nesting depth | 1 (no nesting) | Inner fences treated as plain text |
| Max verification batch size | 50 names | Split into sequential batches |
| Verification timeout | 5 seconds | Cancel, show no markers |

---

## Delivery Sequence Summary

| Slice | Contents | Dependencies Added | Build Changes |
|-------|----------|-------------------|---------------|
| **1 — Safe Markdown** | markdown-it, DOMPurify, code copy, link routing, streaming debounce | `markdown-it`, `dompurify` (prod) | No TypeScript build pipeline changes. Adds runtime dependency on browser build assets from `node_modules/` — must be verified present in packaged `.vsix`. |
| **2 — Entity Links** | Explicit URI linkification, entity click → host, empty state, thinking indicator | None | None |
| **3 — Cards** | Structured fenced blocks, collapse/expand, fallback rendering | `esbuild` (dev) | Webview bundle |
| **4 — Verification & Trace** | Graph markers, verdict banner, tool trace, secret redaction, provenance | None | None |
| **5 — Actions & Polish** | Action blocks, safety gating, hover actions, role header, resource limits, implicit entities | None | None |

Each slice is independently mergeable and leaves the extension in a working state.

---

## Exit Criteria

This plan is implementation-ready because it provides:

- [x] Named MVP slice (Slice 1: Safe Markdown Foundation)
- [x] Module/file ownership map (chat-panel.ts + webview/ directory)
- [x] Message protocol definitions (all types, directions, payloads, correlation)
- [x] Test strategy mapped to repo tooling (`node:test` for Slice 1 unit tests, manual smoke for DOM/DOMPurify)
- [x] Action safety constraints (7 non-negotiable rules)
- [x] Graph verification assumptions and fallback behavior (daemon query, batch, timeout)
- [x] Explicit deferral list per slice
- [x] Dependency bundling strategy (Option A → Option C migration)
- [x] Security invariants addressed per slice (S-suites gate their phase)

---

## Provenance

This plan was produced by reviewing:
- `plans/TDD_COGNITIVE_OUTPUT.md` — product and UX specification (1100+ lines)
- `plans/TDD_COGNITIVE_OUTPUT_READINESS_REVIEW.md` — readiness gate (all 17 items addressed)
- `extensions/vscode/src/chat-panel.ts` — live codebase baseline
- `extensions/vscode/package.json` — dependency reality
- `extensions/vscode/tsconfig.json` — build configuration

All 10 readiness review questions answered:
1. Markdown rendering: `webview/render-markdown.ts`
2. Entity URI transformation: `webview/entity-links.ts`
3. Protocol types: `webview/protocol.ts`
4. Entity status resolution: Extension host via `McpClient` → daemon
5. Tool trace production: Extension host assembles from agentic loop execution records
6. Graph verification fallback: Skip markers, show no indicators, log warning
7. Semantic cards: Parsed from markdown fences (LLM prompt convention)
8. Test framework: Node `assert` + `suite`/`test` + `linkedom` for DOM
9. Action buttons: Loading state only, no optimistic success, host-validated
10. MVP merge scope: Slice 1 (markdown + sanitization + code copy + link routing)
