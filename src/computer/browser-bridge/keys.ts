/** Key names the model may use ("Enter", "Control+A", "Shift+Tab", "F5", "a") mapped to CDP key events. */

export interface CdpKey { key: string; code: string; keyCode: number; text?: string; location?: number }
export interface KeyChord { modifiers: number; keys: CdpKey[]; modifierKeys: CdpKey[] }

const NAMED: Record<string, CdpKey> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
};
const MODIFIERS: Record<string, { bit: number; key: CdpKey }> = {
  alt: { bit: 1, key: { key: "Alt", code: "AltLeft", keyCode: 18, location: 1 } },
  control: { bit: 2, key: { key: "Control", code: "ControlLeft", keyCode: 17, location: 1 } },
  ctrl: { bit: 2, key: { key: "Control", code: "ControlLeft", keyCode: 17, location: 1 } },
  meta: { bit: 4, key: { key: "Meta", code: "MetaLeft", keyCode: 91, location: 1 } },
  cmd: { bit: 4, key: { key: "Meta", code: "MetaLeft", keyCode: 91, location: 1 } },
  shift: { bit: 8, key: { key: "Shift", code: "ShiftLeft", keyCode: 16, location: 1 } },
};

function single(name: string, shifted: boolean): CdpKey {
  const lower = name.toLowerCase();
  if (NAMED[lower]) return NAMED[lower];
  const fn = /^f([1-9]|1[0-2])$/.exec(lower);
  if (fn) return { key: `F${fn[1]}`, code: `F${fn[1]}`, keyCode: 111 + Number(fn[1]) };
  if (name.length === 1) {
    const upper = name.toUpperCase();
    if (/[a-z]/i.test(name)) {
      const text = shifted ? upper : name.toLowerCase();
      return { key: text, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text };
    }
    if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
    return { key: name, code: "", keyCode: 0, text: name };
  }
  throw new Error(`BROWSER_KEY_UNKNOWN: ${name}`);
}

/** Parses "Control+Shift+K". The last part is the key; the others are modifiers. */
export function parseKeyChord(chord: string): KeyChord {
  const parts = chord.split("+").map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error("BROWSER_KEY_UNKNOWN: empty key");
  // "Control++" means the plus key.
  if (chord.endsWith("++")) parts.push("+");
  const last = parts.pop()!;
  let modifiers = 0; const modifierKeys: CdpKey[] = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) throw new Error(`BROWSER_KEY_UNKNOWN: ${part}`);
    modifiers |= modifier.bit; modifierKeys.push(modifier.key);
  }
  const key = single(last, (modifiers & 8) !== 0);
  // A chord with Control/Alt/Meta does not type text.
  return { modifiers, modifierKeys, keys: [modifiers & 7 ? { ...key, text: undefined } : key] };
}
