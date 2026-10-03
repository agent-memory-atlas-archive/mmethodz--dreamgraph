import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withDataDirectory } from "../src/utils/paths.js";
import { graphUpgradeNotice } from "../src/graph/upgrade-notice.js";
import { loadPublicationState,commitGraphWrites } from "../src/graph/publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { LegacyGraphUpgrade } from "../src/graph/legacy-upgrade.js";
let directory:string;
beforeEach(async()=>{directory=await fs.mkdtemp(join(tmpdir(),"dg-upgrade-notice-"));});
afterEach(async()=>{vi.restoreAllMocks();await releaseGraphWriter(directory);await fs.rm(directory,{recursive:true,force:true});});
const scope=<T>(work:()=>T)=>withDataDirectory(directory,work),read=()=>scope(()=>graphUpgradeNotice("fixture"));
it("does not call an empty instance or schema placeholders a legacy graph",async()=>{
  expect((await read()).state).toBe("no_format_issue_detected");await fs.writeFile(join(directory,"features.json"),'[{"_schema":"Example only"}]');expect((await read()).state).toBe("no_format_issue_detected");
});
it("identifies populated flat/wrapped legacy and previous formats without inferring freshness from scan age",async()=>{
  await scope(()=>commitGraphWrites({writes:[{file:"features.json",content:'[{"id":"legacy"}]'}],source_reconciliation:{full:true,revision:"managed",scope:["repository:fixture"]}}));
  const file=join(directory,"publication_state.json"),state=JSON.parse(await fs.readFile(file,"utf8"));state.currency.last_full_scan_at="2001-01-01T00:00:00Z";await fs.writeFile(file,JSON.stringify(state));
  const notice=await read();expect(notice).toMatchObject({state:"review_recommended",files:["features.json"]});expect(notice.message).toContain("last full scan date does not determine");
  await fs.unlink(join(directory,"features.json"));await fs.writeFile(join(directory,"tension_log.json"),'{"schema_version":"1.0.0","signals":[{"id":"prior"}]}');expect((await read()).files).toContain("tension_log.json");
});
it("bounds inspection and avoids reading/parsing the complete candidate or canonical graph during navigation",async()=>{
  await scope(()=>commitGraphWrites({writes:[{file:"features.json",content:"[]"}]}));await scope(loadPublicationState);
  await fs.writeFile(join(directory,"candidate_edges.json"),'{"results":['+'{"dream_id":"one"},'.repeat(10_000)+'{"dream_id":"last"}]}');
  const spy=vi.spyOn(fs,"readFile"),notice=await read();expect(notice.files).toContain("candidate_edges.json");
  expect(spy.mock.calls.some(call=>String(call[0]).endsWith("candidate_edges.json"))).toBe(false);
});
it("reports unsupported or corrupt format detection explicitly",async()=>{
  await fs.writeFile(join(directory,"tension_log.json"),'{"schema_version":"99.0.0","signals":[]}');expect((await read()).state).toBe("inspection_required");
  await fs.writeFile(join(directory,"features.json"),"{malformed");expect((await read()).notices.join(" ")).toContain("features.json");
});
it("requires a durable original review receipt, reopens a restored format and keeps notification read-only",async()=>{
  await fs.writeFile(join(directory,"features.json"),'[{"name":"Before"}]');const service=new LegacyGraphUpgrade(directory,"fixture"),preview=await service.preview();
  await service.apply(preview,{reviewed_digest:preview.digest,review_id:"operator",operation_id:"migration"});const before=await fs.readFile(join(directory,"publication_state.json"),"utf8");
  expect((await read()).state).toBe("review_recorded");expect(await fs.readFile(join(directory,"publication_state.json"),"utf8")).toBe(before);
  const restore=await service.previewRestore("migration");await service.restore(restore,{reviewed_digest:restore.digest,review_id:"operator restore",operation_id:"restore"});expect((await read()).state).toBe("review_recommended");
  await fs.writeFile(join(directory,"graph_upgrade_log.json"),'{"schema":"dreamgraph.graph_upgrades.v1","entries":[]}');expect((await read()).state).toBe("inspection_required");
});
