/** Core operational reads cannot turn corrupt or withdrawn persisted history into absence. */
import { readFile } from "node:fs/promises";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { loadPublicationState, publicationContentHash } from "../graph/publication.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
export async function readCognitiveStore<T extends { metadata: unknown }>(file: string, empty: T, arrays: string[], optional: string[] = []): Promise<T> {
  return withGraphRead(async () => {
  const publication = await loadPublicationState();
  try {
    const body = await readFile(dataPath(file), "utf8");
    if (publication.stores[file] && publication.stores[file].hash !== publicationContentHash(body)) throw new Error(`UNPUBLISHED_COGNITIVE_CHANGE:${file}`);
    const doc = JSON.parse(stripBom(body));
    if (!doc || typeof doc !== "object" || arrays.some(key => !Array.isArray(doc[key])) || optional.some(key => doc[key] !== undefined && !Array.isArray(doc[key]))) throw new Error(`COGNITIVE_STORE_INVALID:${file}`);
    return { ...empty, ...doc, metadata: { ...empty.metadata as object, ...doc.metadata } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !publication.stores[file]) return empty;
    throw error;
  }
  });
}
