import { getRenderScript } from './render-markdown.js';
import { getEntityLinksScript } from './entity-links.js';
import { getCardRendererScript } from './card-renderer.js';

// Build-time source assembly. scripts/build-webview.cjs compiles this source into
// static browser JavaScript; no eval/new Function is permitted in the webview.
export function getWebviewSource(): string {
  return [
    getCardRendererScript(),
    getRenderScript(),
    getEntityLinksScript(),
  ].join('\n');
}
