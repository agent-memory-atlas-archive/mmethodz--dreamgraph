import { NarrativeSettingsSchema, mergeEngineSettings } from "../config/engine-settings.js";
import { captureCognitiveProjection, projectionCurrentness, compareProjectionContext } from "./projection-context.js";
import { readCognitiveStore } from "./cognitive-store.js";
import { commitGraphWrites } from "../graph/publication.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { riskDigest } from "./risk-lifecycle.js";
/**
 * DreamGraph Dream Narratives — System Autobiography
 *
 * Generates a coherent narrative of the system's evolving understanding
 * from dream_history, tension_log, and validated_edges.
 *
 * Not a log — a STORY of how understanding developed:
 *   "I started by thinking catalog and cart were unrelated. After 8 cycles,
 *    I discovered they share an implicit session model. This led me to find
 *    that order management has no awareness of session expiry, which became
 *    my highest-urgency tension..."
 *
 * Three depth levels:
 *   executive  — 1-page summary for stakeholders
 *   technical  — detailed findings with entity references
 *   full       — complete cycle-by-cycle narrative
 *
 * On-demand: `generateNarrative()` synthesizes existing data, writes nothing.
 *
 * v5.1 — Continuous Narrative Intelligence:
 *   Adds persistent, auto-accumulated story (`data/system_story.json`).
 *   `generateDiffChapter()` captures what changed since the last chapter.
 *   `maybeAutoNarrate()` is hooked into dream_cycle completion.
 */

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { existsSync } from "node:fs";
import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import { graphEventBus } from "../graph/events.js";
import { dataPath } from "../utils/paths.js";
import { DEFAULT_NARRATIVE_CONFIG } from "./types.js";
import type {
  NarrativeDepth,
  NarrativeChapter,
  SystemNarrative,
  DreamHistoryEntry,
  TensionSignal,
  ResolvedTension,
  ValidatedEdge,
  StoryChapter,
  WeeklyDigest,
  SystemStoryFile,
  NarrativeConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Chapter Construction
// ---------------------------------------------------------------------------

interface EpochData {
  sessions: DreamHistoryEntry[];
  activeTensions: TensionSignal[];
  resolvedTensions: ResolvedTension[];
  promotedEdges: ValidatedEdge[];
  cycleRange: [number, number];
}

/**
 * Divide history into narrative epochs (chapters).
 * Each epoch covers a natural "phase" of understanding.
 */
function divideIntoEpochs(
  sessions: DreamHistoryEntry[],
  allTensions: TensionSignal[],
  resolvedTensions: ResolvedTension[],
  validatedEdges: ValidatedEdge[],
  depth: NarrativeDepth
): EpochData[] {
  if (sessions.length === 0) return [];

  // Determine epoch size based on depth
  const epochSize = depth === "executive" ? Math.max(Math.ceil(sessions.length / 3), 1)
    : depth === "technical" ? Math.max(Math.ceil(sessions.length / 6), 1)
    : Math.max(Math.ceil(sessions.length / 10), 1);

  const epochs: EpochData[] = [];

  for (let i = 0; i < sessions.length; i += epochSize) {
    const chunk = sessions.slice(i, i + epochSize);
    if (chunk.length === 0) continue;

    const minCycle = chunk[0].cycle_number;
    const maxCycle = chunk[chunk.length - 1].cycle_number;

    // Find tensions active during this epoch
    const active = allTensions.filter((t) => {
      const start=Date.parse(t.first_seen),end=Date.parse(t.last_seen);
      return Number.isFinite(start)&&Number.isFinite(end)&&start<=Date.parse(chunk.at(-1)!.timestamp)&&end>=Date.parse(chunk[0].timestamp);
    });

    // Find resolutions during this epoch
    const resolved = resolvedTensions.filter((r) => {
      const resolvedDate = new Date(r.resolved_at).getTime();
      const epochStart = new Date(chunk[0].timestamp).getTime();
      const epochEnd = new Date(chunk[chunk.length - 1].timestamp).getTime();
      return resolvedDate >= epochStart && resolvedDate <= epochEnd;
    });

    // Find edges promoted during this epoch
    const promoted = validatedEdges.filter((e) => {
      return e.dream_cycle >= minCycle && e.dream_cycle <= maxCycle;
    });

    epochs.push({
      sessions: chunk,
      activeTensions: active,
      resolvedTensions: resolved,
      promotedEdges: promoted,
      cycleRange: [minCycle, maxCycle],
    });
  }

  return epochs;
}

/**
 * Generate narrative text for a single epoch.
 */
function narrateEpoch(epoch: EpochData, epochIndex: number, depth: NarrativeDepth): NarrativeChapter {
  const totalEdges = epoch.sessions.reduce((sum, s) => sum + s.generated_edges, 0);
  const totalNodes = epoch.sessions.reduce((sum, s) => sum + s.generated_nodes, 0);
  const totalDecayed = epoch.sessions.reduce((sum, s) => sum + s.decayed_edges + s.decayed_nodes, 0);
  const totalMerged = epoch.sessions.reduce((sum, s) => sum + s.duplicates_merged, 0);
  const totalValidated = epoch.sessions.reduce((sum, s) => sum + (s.normalization?.validated ?? 0), 0);
  const totalRejected = epoch.sessions.reduce((sum, s) => sum + (s.normalization?.rejected ?? 0), 0);
  const totalPromoted = epoch.sessions.reduce((sum, s) => sum + (s.normalization?.promoted ?? 0), 0);

  // Key discoveries
  const discoveries: string[] = [];
  if (totalPromoted > 0) {
    discoveries.push(`${totalPromoted} historical promotions were recorded; present applicability requires current proof`);
  }
  if (epoch.resolvedTensions.length > 0) {
    const byType = new Map<string, number>();
    for (const r of epoch.resolvedTensions) {
      byType.set(r.resolution_type, (byType.get(r.resolution_type) ?? 0) + 1);
    }
    for (const [type, count] of byType) {
      discoveries.push(`${count} tension(s) resolved as ${type.replace(/_/g, " ")}`);
    }
  }
  if (totalMerged > 0) {
    discoveries.push(`${totalMerged} ideas were rediscovered; repetition adds no independent evidence`);
  }
  if (totalDecayed > 0) {
    discoveries.push(`${totalDecayed} speculative items decayed; decay is a retention policy, not a finding about correctness or usefulness`);
  }

  // Tensions addressed
  const tensionsAddressed = epoch.resolvedTensions.map(
    (r) => `"${r.tension_id}" (${r.resolution_type})`
  );

  // Build narrative text based on depth
  const parts: string[] = [];

  if (epochIndex === 0) {
    parts.push(`The system began its exploration with ${epoch.sessions.length} dream cycles.`);
  } else {
    parts.push(`In this phase (cycles ${epoch.cycleRange[0]}–${epoch.cycleRange[1]}), the system continued its analysis.`);
  }

  parts.push(
    `It generated ${totalEdges} speculative edges and ${totalNodes} hypothetical nodes, ` +
    `with ${totalValidated} historical validation outcomes and ${totalRejected} historical rejections. These counts are not current claim verification.`
  );

  if (totalPromoted > 0) {
    parts.push(
      `${totalPromoted} historical promotions were recorded. Inspect current source evidence before using them as architectural conclusions.`
    );
  }

  if (epoch.promotedEdges.length > 0 && depth !== "executive") {
    const edgeDescs = epoch.promotedEdges.slice(0, 3).map(
      (e) => `"${e.from}" → "${e.to}" (${e.relation})`
    );
    parts.push(`Key promoted connections: ${edgeDescs.join("; ")}.`);
  }

  if (epoch.resolvedTensions.length > 0) {
    const fixes = epoch.resolvedTensions.filter(
      (r) => r.resolution_state === "verified"
    );
    const fps = epoch.resolvedTensions.filter(
      (r) => r.resolution_type === "false_positive"
    );

    if (fixes.length > 0) {
      parts.push(
        `${fixes.length} tension(s) were independently verified at the recorded resolution time; later evidence can reopen review.`
      );
    }
    if (fps.length > 0) {
      parts.push(
        `${fps.length} tension(s) were disposed as false positives by their recorded authority; inspect the retained rationale.`
      );
    }
  }

  if (totalDecayed > totalEdges * 0.3) {
    parts.push(
      "A significant portion of speculative ideas decayed under the configured retention policy."
    );
  }

  // Title generation
  let title: string;
  if (epochIndex === 0) {
    title = "The Awakening";
  } else if (totalPromoted > 3) {
    title = "A Phase of Discovery";
  } else if (epoch.resolvedTensions.length > 2) {
    title = "Resolving Contradictions";
  } else if (totalDecayed > totalEdges * 0.5) {
    title = "Selective Forgetting";
  } else if (totalMerged > totalEdges * 0.3) {
    title = "Recurring Observations";
  } else {
    title = `Cycle ${epoch.cycleRange[0]}–${epoch.cycleRange[1]}`;
  }

  return {
    title,
    cycle_range: epoch.cycleRange,
    key_discoveries: discoveries,
    tensions_addressed: tensionsAddressed,
    narrative_text: parts.join(" "),
  };
}

/**
 * Generate the epilogue — overall assessment of the system's state.
 */
function generateEpilogue(
  totalCycles: number,
  activeTensions: TensionSignal[],
  resolvedTensions: ResolvedTension[],
  validatedEdges: ValidatedEdge[]
): string {
  const parts: string[] = [];

  parts.push(`The record covers ${totalCycles} dream cycle(s); activity alone does not measure understanding.`);

  if (validatedEdges.length > 0) {
    parts.push(`${validatedEdges.length} connection(s) have been validated and promoted to the knowledge graph.`);
  }

  if (resolvedTensions.length > 0) {
    const fixed = resolvedTensions.filter((r) => r.resolution_state === "verified").length;
    const fps = resolvedTensions.filter((r) => r.resolution_type === "false_positive").length;
    parts.push(
      `${resolvedTensions.length} historical closures: ${fixed} independently verified at the recorded time, ${fps} disposed as false positives. Current applicability can change.`
    );
  }

  const unresolvedCount = activeTensions.filter((t) => !t.resolved).length;
  if (unresolvedCount === 0) {
    parts.push(
      "No active tensions are recorded. This alone does not establish graph integrity, currentness or project health."
    );
  } else if (unresolvedCount <= 5) {
    parts.push(
      `${unresolvedCount} tension(s) remain; inspect their actual urgency and evidence before choosing an action.`
    );
  } else {
    const topUrgency = Math.max(...activeTensions.filter((t) => !t.resolved).map((t) => t.urgency));
    parts.push(
      `${unresolvedCount} tension(s) remain active, with top urgency ${topUrgency.toFixed(2)}. Inspect their evidence and disposition before allocating further work.`
    );
  }

  return parts.join(" ");
}

/**
 * Assess overall health based on the narrative data.
 */
function assessHealth(
  activeTensions: TensionSignal[],
  validatedEdges: ValidatedEdge[]
): string {
  const unresolved = activeTensions.filter((t) => !t.resolved);
  const maxUrgency = unresolved.length > 0
    ? Math.max(...unresolved.map((t) => t.urgency))
    : 0;

  if (unresolved.length === 0) return "no active tensions — overall health requires the canonical health report";
  if (maxUrgency > 0.8) return "high urgency — inspect recorded tensions";
  if (maxUrgency > 0.5) return "attention needed — moderate tensions remain";
  if (unresolved.length > 20) return "overloaded — too many open tensions";
  return "stable — only low-priority tensions remain";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a system narrative from all available history.
 *
 * @param depth "executive" (short), "technical" (detailed), "full" (cycle-by-cycle)
 */
export async function generateNarrative(
  depth: NarrativeDepth = "technical"
): Promise<SystemNarrative> {
  return withGraphRead(async()=>{
  logger.info(`Generating system narrative (depth: ${depth})`);

  const [history, tensionFile, validatedFile] = await Promise.all([
    engine.loadDreamHistory(),
    engine.loadTensions(),
    engine.loadValidatedEdges(),
  ]);

  const sessions = history.sessions;
  const activeTensions = tensionFile.signals;
  const resolvedTensions = tensionFile.resolved_tensions ?? [];
  const snapshot=await captureCognitiveProjection();
  const current=new Set(snapshot.graph.entities.filter(e=>e.identity.kind==="validated"&&e.assertion_class==="validated_insight").map(e=>e.identity.id));
  const validatedEdges = validatedFile.edges.filter(e=>current.has(e.id));

  // Divide into epochs
  const epochs = divideIntoEpochs(
    sessions,
    activeTensions,
    resolvedTensions,
    validatedEdges,
    depth
  );

  // Generate chapter narratives
  const chapters = epochs.map((epoch, i) => narrateEpoch(epoch, i, depth));

  // Generate epilogue
  const epilogue = generateEpilogue(
    sessions.length,
    activeTensions,
    resolvedTensions,
    validatedEdges
  );

  const overall_health = assessHealth(activeTensions, validatedEdges);

  const narrative: SystemNarrative = {
    projection:snapshot.context,
    title: sessions.length === 0
      ? "A System Awaiting Its First Dream"
      : `The Story of Understanding — ${sessions.length} Dream Cycles`,
    depth,
    generated_at: new Date().toISOString(),
    total_cycles_covered: sessions.length,
    chapters,
    epilogue,
    overall_health,
  };

  logger.info(
    `Narrative generated: ${chapters.length} chapters, ${sessions.length} cycles covered`
  );

  return narrative;
  });
}

// ===========================================================================
// v5.1 — Continuous Narrative Intelligence
// ===========================================================================

const storyPath = () => dataPath("system_story.json");

let narrativeConfig: NarrativeConfig = { ...DEFAULT_NARRATIVE_CONFIG };
let cyclesSinceLastChapter = 0;

// ---------------------------------------------------------------------------
// Story I/O
// ---------------------------------------------------------------------------

function emptyStory(): SystemStoryFile {
  return {
    metadata: {
      description:
        "DreamGraph System Autobiography — a persistent, evolving narrative of system understanding.",
      schema_version: "1.0.0",
      title: "The DreamGraph Chronicle",
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      total_chapters: 0,
      total_cycles_covered: 0,
    },
    chapters: [],
    digests: [],
  };
}

async function loadStory(): Promise<SystemStoryFile> {
  return readCognitiveStore("system_story.json",emptyStory(),["chapters","digests"],["archived_chapters","archived_digests"]);
}

async function saveStory(story: SystemStoryFile): Promise<void> {
  story.metadata.total_chapters = story.chapters.length+(story.archived_chapters?.length??0);
  story.metadata.last_updated = new Date().toISOString();
  const body=JSON.stringify(story,null,2);
  if(Buffer.byteLength(body)>16*1024*1024)throw new Error("NARRATIVE_CAPACITY_REQUIRES_ARCHIVE");
  await commitGraphWrites({actor:"narrator",scope:["system_story.json"],writes:[{file:"system_story.json",content:body}]});
}

// ---------------------------------------------------------------------------
// Diff Chapter Generation
// ---------------------------------------------------------------------------

/**
 * Generate a diff chapter capturing what changed since the last chapter.
 */
export async function generateDiffChapter(): Promise<StoryChapter> {
  return withGraphRead(async()=>{
  const [history, tensionFile, validatedFile] = await Promise.all([
    engine.loadDreamHistory(),
    engine.loadTensions(),
    engine.loadValidatedEdges(),
  ]);

  const story = await loadStory();
  const lastCycleCovered = story.chapters.length > 0
    ? story.chapters[story.chapters.length - 1].cycle_range[1]
    : 0;

  const sessions = history.sessions.filter(
    (s) => s.cycle_number > lastCycleCovered
  );
  const snapshot=await captureCognitiveProjection();
  const current=new Set(snapshot.graph.entities.filter(e=>e.identity.kind==="validated"&&e.assertion_class==="validated_insight").map(e=>e.identity.id));
  const validatedEdges = validatedFile.edges.filter(e=>current.has(e.id));
  const resolvedTensions = tensionFile.resolved_tensions ?? [];

  // Compute diff window
  const newValidated = validatedEdges.filter(
    (e) => e.dream_cycle > lastCycleCovered
  );
  const tensionsCreated = sessions.reduce(
    (sum, s) => sum + s.tension_signals_created, 0
  );
  const tensionsResolved = sessions.reduce(
    (sum, s) => sum + s.tension_signals_resolved, 0
  );

  // Count threats discovered (approximate: high-urgency tensions created)
  const threatsDiscovered = tensionFile.signals.filter(
    (t) => t.urgency >= 0.7 && new Date(t.first_seen).getTime() >
      (sessions.length > 0 ? new Date(sessions[0].timestamp).getTime() : 0)
  ).length;

  const cycleRange: [number, number] = sessions.length > 0
    ? [sessions[0].cycle_number, sessions[sessions.length - 1].cycle_number]
    : [lastCycleCovered + 1, lastCycleCovered + 1];

  // Build narrative text
  const parts: string[] = [];

  if (sessions.length === 0) {
    parts.push("No new dream cycles have occurred since the last chapter.");
  } else {
    parts.push(
      `Since cycle ${lastCycleCovered}, ${sessions.length} new dream cycle(s) were performed (${cycleRange[0]}–${cycleRange[1]}).`
    );

    if (newValidated.length > 0) {
      parts.push(
        `${newValidated.length} new connection(s) were validated and promoted to the knowledge graph.`
      );
      // Describe up to 3 key discoveries
      const described = newValidated.slice(0, 3);
      for (const edge of described) {
        parts.push(
          `Discovered: "${edge.from}" ${edge.relation} "${edge.to}" (confidence: ${edge.confidence.toFixed(2)}).`
        );
      }
      if (newValidated.length > 3) {
        parts.push(`...and ${newValidated.length - 3} more connections.`);
      }
    }

    if (tensionsResolved > 0) {
      parts.push(`${tensionsResolved} tension(s) were resolved during this period.`);
    }

    if (tensionsCreated > 0) {
      parts.push(`${tensionsCreated} new tension(s) emerged.`);
    }

    if (threatsDiscovered > 0) {
      parts.push(
        `${threatsDiscovered} high-urgency tension(s) were identified as potential threats.`
      );
    }

    // Current state summary
    const unresolvedCount = tensionFile.signals.filter((t) => !t.resolved).length;
    if (unresolvedCount > 0) {
      parts.push(`${unresolvedCount} tension(s) remain active.`);
    } else {
      parts.push("No active tensions are recorded; consult the canonical health report for integrity/currentness.");
    }
  }

  // Choose chapter title
  let title: string;
  if (newValidated.length > 3) {
    title = "A Phase of Discovery";
  } else if (tensionsResolved > tensionsCreated) {
    title = "Resolving Open Questions";
  } else if (threatsDiscovered > 0) {
    title = "New Threats Emerge";
  } else if (sessions.length > 0) {
    title = `Progress: Cycles ${cycleRange[0]}–${cycleRange[1]}`;
  } else {
    title = "A Quiet Interlude";
  }

  const chapter: StoryChapter = {
    projection:snapshot.context,
    // NarrativeChapter base fields
    title,
    cycle_range: cycleRange,
    key_discoveries: newValidated.slice(0, 5).map(
      (e) => `${e.from} → ${e.to} (${e.relation})`
    ),
    tensions_addressed: resolvedTensions
      .filter((r) => {
        const ts = new Date(r.resolved_at).getTime();
        const windowStart = sessions.length > 0
          ? new Date(sessions[0].timestamp).getTime()
          : 0;
        return ts >= windowStart;
      })
      .slice(0, 5)
      .map((r) => `${r.tension_id} (${r.resolution_type})`),
    narrative_text: parts.join(" "),
    // StoryChapter extensions
    chapter_number: story.metadata.total_chapters + 1,
    generated_at: new Date().toISOString(),
    diff: {
      new_validated_edges: newValidated.length,
      tensions_created: tensionsCreated,
      tensions_resolved: tensionsResolved,
      threats_discovered: threatsDiscovered,
      archetypes_exchanged: 0, // Will be populated when federation events exist
    },
  };

  return chapter;
  });
}

/**
 * Append a chapter to the persistent story and save.
 */
export async function appendToStory(chapter: StoryChapter): Promise<SystemStoryFile> {
  const committed=await withGraphReconciliation(async()=>{
  const story = await loadStory();
  const id=chapter.id??riskDigest([chapter.projection?.dependencies??null,chapter.cycle_range,chapter.narrative_text]);
  if([...story.chapters,...story.archived_chapters??[]].some(c=>c.id===id))return {story,appended:false};
  if(chapter.projection&&await projectionCurrentness(chapter.projection)!=="current")throw new Error("NARRATIVE_SOURCE_REVISION_CONFLICT");
  chapter={...chapter,id,chapter_number:story.metadata.total_chapters+1};story.chapters.push(chapter);

  // Update total cycles covered
  story.metadata.total_cycles_covered = Math.max(story.metadata.total_cycles_covered,chapter.cycle_range[1]);

  // Prune to max chapters
  if (story.chapters.length > narrativeConfig.max_chapters) {
    (story.archived_chapters??=[]).push(...story.chapters.splice(0,story.chapters.length-narrativeConfig.max_chapters));
  }

  await saveStory(story);
  return {story,appended:true};
  });
  logger.info(
    `Story updated: chapter ${chapter.chapter_number} — "${chapter.title}"`
  );
  if(committed.appended)graphEventBus.emit("narrative.chapter.appended", {
    affected_ids: [],
    payload: {
      chapter_number: chapter.chapter_number,
      title: chapter.title,
      cycle_range: chapter.cycle_range,
      generated_at: chapter.generated_at,
    },
  });
  return committed.story;
}

/**
 * Generate a weekly digest summarizing multiple chapters.
 */
export async function generateWeeklyDigest(): Promise<WeeklyDigest | null> {
  return withGraphReconciliation(async()=>{
  const story = await loadStory();
  if (story.chapters.length === 0) return null;

  // Find chapters since last digest
  const lastDigestCycle = story.digests.length > 0
    ? story.digests[story.digests.length - 1].cycle_range[1]
    : 0;

  const newChapters = story.chapters.filter(
    (c) => c.cycle_range[1] > lastDigestCycle
  );

  if (newChapters.length < 2) return null; // Need at least 2 chapters for a digest

  // Aggregate stats
  const totalNewEdges = newChapters.reduce(
    (sum, c) => sum + c.diff.new_validated_edges, 0
  );
  const totalTensionsCreated = newChapters.reduce(
    (sum, c) => sum + c.diff.tensions_created, 0
  );
  const totalTensionsResolved = newChapters.reduce(
    (sum, c) => sum + c.diff.tensions_resolved, 0
  );
  const totalThreats = newChapters.reduce(
    (sum, c) => sum + c.diff.threats_discovered, 0
  );

  // Determine health trend
  const firstHalf = newChapters.slice(0, Math.floor(newChapters.length / 2));
  const secondHalf = newChapters.slice(Math.floor(newChapters.length / 2));
  const firstHalfEdges = firstHalf.reduce(
    (sum, c) => sum + c.diff.new_validated_edges, 0
  );
  const secondHalfEdges = secondHalf.reduce(
    (sum, c) => sum + c.diff.new_validated_edges, 0
  );
  const healthTrend: "improving" | "stable" | "degrading" =
    secondHalfEdges > firstHalfEdges * 1.2
      ? "improving"
      : secondHalfEdges < firstHalfEdges * 0.8
        ? "degrading"
        : "stable";

  // Key changes
  const keyChanges: string[] = [];
  if (totalNewEdges > 0)
    keyChanges.push(`${totalNewEdges} new validated edges promoted`);
  if (totalTensionsResolved > 0)
    keyChanges.push(`${totalTensionsResolved} tensions resolved`);
  if (totalTensionsCreated > 0)
    keyChanges.push(`${totalTensionsCreated} new tensions emerged`);
  if (totalThreats > 0)
    keyChanges.push(`${totalThreats} high-urgency threats discovered`);

  // Top tensions from chapters
  const topTensions = [
    ...new Set(newChapters.flatMap((c) => c.tensions_addressed)),
  ].slice(0, 5);

  // Top discoveries
  const topDiscoveries = [
    ...new Set(newChapters.flatMap((c) => c.key_discoveries)),
  ].slice(0, 5);

  const cycleRange: [number, number] = [
    newChapters[0].cycle_range[0],
    newChapters[newChapters.length - 1].cycle_range[1],
  ];

  const summary =
    `Weekly digest covering cycles ${cycleRange[0]}–${cycleRange[1]} ` +
    `(${newChapters.length} chapters). ` +
    `Historical promotion activity ${healthTrend === "improving" ? "increased" : healthTrend === "degrading" ? "decreased" : "remained stable"}; this is not a health or usefulness measurement. ` +
    `${totalNewEdges} connection(s) validated, ${totalTensionsResolved} tension(s) resolved, ` +
    `${totalTensionsCreated} new tension(s) created.`;

  const digest: WeeklyDigest = {
    projection:(await captureCognitiveProjection()).context,interpretation:"historical_activity",
    id: `digest_${randomUUID()}`,
    generated_at: new Date().toISOString(),
    cycle_range: cycleRange,
    summary,
    key_changes: keyChanges,
    health_trend: healthTrend,
    top_tensions: topTensions,
    top_discoveries: topDiscoveries,
  };

  // Persist
  story.digests.push(digest);
  if (story.digests.length > 52) {
    (story.archived_digests??=[]).push(...story.digests.splice(0,story.digests.length-52));
  }
  await saveStory(story);

  logger.info(`Weekly digest generated: cycles ${cycleRange[0]}–${cycleRange[1]}`);
  return digest;
  });
}

/**
 * Hook called after each dream_cycle completion.
 * Auto-generates a chapter if enough cycles have passed.
 */
export async function maybeAutoNarrate(): Promise<StoryChapter | null> {
  if (!narrativeConfig.auto_narrate) return null;

  const [history,priorStory]=await withGraphRead(()=>Promise.all([engine.loadDreamHistory(),loadStory()]));
  const latestCycle=Math.max(0,...history.sessions.map(s=>s.cycle_number));
  cyclesSinceLastChapter=Math.max(0,latestCycle-priorStory.metadata.total_cycles_covered);

  if (cyclesSinceLastChapter < narrativeConfig.narrative_interval) {
    logger.debug(
      `Narrator: ${cyclesSinceLastChapter}/${narrativeConfig.narrative_interval} cycles until next chapter`
    );
    return null;
  }

  logger.info("Narrator: auto-generating new chapter");
  cyclesSinceLastChapter = 0;

  const chapter = await generateDiffChapter();
  await appendToStory(chapter);

  // Check if a digest is due
  const story = await loadStory();
  const chaptersSinceLastDigest = story.digests.length > 0
    ? story.chapters.filter(
      (c) => c.cycle_range[1] > story.digests[story.digests.length - 1].cycle_range[1]
    ).length
    : story.chapters.length;

  if (
    chaptersSinceLastDigest >=
    Math.ceil(narrativeConfig.digest_interval / narrativeConfig.narrative_interval)
  ) {
    await generateWeeklyDigest();
  }

  return chapter;
}

/**
 * Update narrative configuration at runtime.
 */
export function updateNarrativeConfig(
  newConfig: Partial<NarrativeConfig>
): void {
  narrativeConfig = mergeEngineSettings(NarrativeSettingsSchema, narrativeConfig, newConfig);
  logger.info(`Narrative config updated: ${JSON.stringify(narrativeConfig)}`);
}

/**
 * Return a snapshot of the current narrative configuration.
 */
export function getNarrativeConfig(): NarrativeConfig {
  return { ...narrativeConfig };
}

/**
 * Load the persistent system story for resource serving.
 */
export async function getSystemStory(): Promise<SystemStoryFile> {
  return withGraphRead(async()=>{
    const story=await loadStory();
    const chapters=[...story.chapters,...story.archived_chapters??[]];
    const dependencies=[...new Set(chapters.flatMap(chapter=>Object.keys(chapter.projection?.dependencies??{})))];
    const fresh=(await captureCognitiveProjection(dependencies)).context;
    for(const chapter of chapters)chapter.currentness=compareProjectionContext(chapter.projection,fresh);
    return story;
  });
}
