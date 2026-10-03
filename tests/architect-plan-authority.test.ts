import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleArchitectRoute } from "../src/architect/routes.js";
import * as lifecycle from "../src/instance/lifecycle.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { commitGraphWrites } from "../src/graph/publication.js";
import { getPlanAuthorityScope } from "../src/architect/plan-registry.js";
import { readPlanAuthority, applyPlanCommand } from "../src/discipline/plan-authority.js";
import { withSessionContext } from "../src/server/session-context.js";
import { JSDOM } from "jsdom";
import { randomUUID } from "node:crypto";
let root: string, old: string, url: string, server: Server, spy: any, counter: number;
const markdown = "# Fixture\n\nStatus: completed\n\n### Slice 0 - First\n\n- id: first\n- status: verified\n\nAcceptance: real first check.\n\n### Slice 1 - Second\n\n- id: second\n- Depends on: first\n\nAcceptance: real second check.\n";
beforeEach(async () => {
  old = getDataDir(); root = await mkdtemp(join(tmpdir(), "dg-architect-c14-"));
  await mkdir(join(root, "plans")); await mkdir(join(root, "data")); setDataDirOverride(join(root, "data"));
  await writeFile(join(root, "plans", "fixture.md"), markdown); await writeFile(join(root, "plans", "fixture.implementation-log.md"), "### audit — status: verified\nNot a verification receipt.\n");
  spy = vi.spyOn(lifecycle, "getActiveScope").mockReturnValue({ uuid: "fixture-instance", projectRoot: root } as any); counter = 0;
  server = createServer((req, res) => {
    void withSessionContext({ principal: "operator", session_id: "browser", directory: join(root, "data"), channel: "browser", environment: {}, continuation_key: "fixture-key", saveEnvironment: async () => {} }, async () => {
      if (!await handleArchitectRoute(req, res, new URL(req.url!, "http://localhost").pathname)) { res.statusCode = 404; res.end(); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); url = `http://127.0.0.1:${(server.address() as any).port}/api/architect/v1/plans/fixture`;
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await releaseGraphWriter(join(root, "data")); spy.mockRestore(); setDataDirOverride(old); await rm(root, { recursive: true, force: true }); });
async function post(suffix: string, body: unknown) { const response = await fetch(url + suffix, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { response, data: await response.json() as any }; }
async function detail() { return (await (await fetch(url)).json() as any).plan; }
async function reviewed() {
  const preview = (await (await fetch(url + "/lifecycle/preview")).json() as any).preview;
  const request = { operation_id: "import", preview_hash: preview.preview_hash, review_id: "explicit-import" };
  const result = await post("/lifecycle/review", request); expect(result.response.status).toBe(200); return { preview, request, result };
}
async function command(command: unknown, extras = {}) {
  const plan = await detail(), op = plan.operational_state;
  return post("/lifecycle/commands", { operation_id: `command-${++counter}`, expected_revision: op.revision, expected_definition_hash: op.definition_hash, command, ...extras });
}
async function started() { await reviewed(); expect((await command({ type: "review_plan", review_id: "design-review" })).response.status).toBe(200);
  expect((await command({ type: "approve_scope", approval_id: "approved", owner: "operator", scope: ["first", "second"], parallel_limit: 1 })).response.status).toBe(200);
  expect((await command({ type: "start_slice", slice_id: "first" })).response.status).toBe(200); }
it("anchors slice definitions to exact UTF-16 source positions rather than earlier title mentions", async () => {
  const source = "# Wrapped plan 🪷\n\nSee Slice 5 - Actual work after the long introduction.\n\n" + "A long wrapping paragraph. ".repeat(200) + "\n\n### Slice 5 - Actual work\n\n- id: actual\n\nAcceptance: real definition.\n";
  await writeFile(join(root, "plans", "fixture.md"), source);
  const plan = await detail(), slice = plan.registry.slices.find((s:any) => s.id === "actual");
  expect(slice.source_offset).toBe(source.indexOf("### Slice 5"));
  expect(plan.markdown.slice(slice.source_offset)).toMatch(/^### Slice 5 - Actual work/);
});
it("reads never import legacy success; preview/import retain exact bytes and recover one lost reply", async () => {
  const plan = await detail(); expect(plan).toMatchObject({ status: "completed", operational_state: { source: "legacy_review_projection", current_slice_id: null, active_slice: null, progress: { verified: 0 }, reported_progress: { verified: 1 } } });
  await expect(readFile(join(root, "data", "plan_state.json"))).rejects.toMatchObject({ code: "ENOENT" });
  const imported = await reviewed(); const before = await readFile(join(root, "data", "plan_state.json"), "utf8");
  const retry = await post("/lifecycle/review", imported.request); expect(retry.response.status).toBe(200); expect(retry.data.result.replayed).toBe(true);
  expect(await readFile(join(root, "data", "plan_state.json"), "utf8")).toBe(before);
  expect((Object.values(JSON.parse(before).records)[0] as any).backups[0].markdown).toBe(markdown);
  expect((await post("/lifecycle/review", { ...imported.request, review_id: "changed" })).response.status).toBe(409);
  expect((await detail()).operational_state).toMatchObject({ source: "typed_plan_authority", plan_lifecycle: "draft", progress: { verified: 0 } });
  expect((await detail()).registry.slices[0]).toMatchObject({ status: "pending", status_source: "typed_plan_authority" });
});
it("legacy progress keeps explicit statuses, reads exact structured log events and refuses to infer completion or execution", async () => {
  await writeFile(join(root, "plans", "fixture.md"), "# Legacy progress\n\nStatus: implementing\n\n### Slice 0 - Finished\n\n- id: first\n- status: verified\n\n### Slice 1 - Work\n\n- id: second\n- Depends on: first\n\n### Slice 2 - Follow-up\n\n- id: third\n- Depends on: second\n\n### Slice 3 - Untouched\n\n- id: fourth\n- Depends on: first\n");
  await writeFile(join(root, "plans", "fixture.implementation-log.md"), "### 2026-10-01T10:00:00Z — slice: first — status: in_progress\nOld event must not override explicit verification.\n\n### 2026-10-02T10:00:00Z — slice: second — status: in_progress\n- Resume note: Continue this task.\n\n### 2026-10-02T11:00:00Z — slice: slices 2–3 — status: verified\nA range and generic narrative must never verify slices.\n");
  const plan = await detail(), op = plan.operational_state;
  expect(op).toMatchObject({ source: "legacy_review_projection", plan_lifecycle: "implementing", current_slice_id: "second", current_status: "in_progress",
    active_slice: null, running_slice_ids: [], execution_state: "idle", verified_slice_ids: [], next_slice: { id: "fourth" }, next_eligibility: { can_start: false },
    progress: { verified: 0 }, reported_progress: { required: 4, completed: 1, current: 1 }, task_memory_binding: { binding_status: "review_required", current_slice_id: "second", next_slice_id: "fourth" } });
  expect(plan.registry.slices).toMatchObject([{ status: "verified", status_source: "markdown", verification_fresh: false },
    { status: "in_progress", status_source: "implementation_log", running: false }, { status: "pending" }, { status: "pending" }]);
  expect((await (await fetch(url.replace("/fixture", ""))).json() as any).plans[0].operational_state).toEqual(op);
  const preview = (await (await fetch(url + "/lifecycle/preview")).json() as any).preview;
  expect(preview.existing_revision).toBeNull(); expect(preview.state.lifecycle).toBe("draft"); expect(preview.state.slices.every((slice: any) => slice.status === "pending")).toBe(true);
  await expect(readFile(join(root, "data", "plan_state.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("the frozen actual Ashoka definition and log keep completed cards muted and current work navigable before lifecycle import", async () => {
  await writeFile(join(root, "plans", "fixture.md"), await readFile(join(process.cwd(), "tests/fixtures/ashoka/legacy-progress-plan.md"), "utf8"));
  await writeFile(join(root, "plans", "fixture.implementation-log.md"), await readFile(join(process.cwd(), "tests/fixtures/ashoka/legacy-progress-log.md"), "utf8"));
  const plan = await detail(), rows = plan.registry.slices, current = rows.find((row: any) => row.status === "in_progress");
  expect(current.title).toMatch(/^Slice 25/); expect(plan.operational_state.reported_progress.completed).toBe(26);
  expect(plan.operational_state).toMatchObject({ current_slice_id: current.id, plan_lifecycle: "implementing", execution_state: "idle", active_slice: null, next_eligibility: { can_start: false } });
  const base = new URL(url).origin, errors: string[] = [];
  const html = (await (await fetch(base + "/architect")).text()).replace(/<script src="[^"]+"><\/script>\s*/g, "");
  const dom = new JSDOM(html, { url: base + "/architect?plan=fixture", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(window) {
    const win = window as any;
    window.addEventListener("error", event => errors.push(String(event.error?.message ?? event.message)));
    win.fetch = (resource: any, init: any) => fetch(new URL(String(resource), base), init);
    win.EventSource = class { addEventListener() {} close() {} }; win.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    Object.defineProperty(window.crypto, "randomUUID", { value: randomUUID });
  } });
  try {
    const document = dom.window.document, deadline = Date.now() + 5000;
    while (document.querySelectorAll('#slice-list .slice-completed').length !== 26) {
      if (Date.now() > deadline) throw new Error("Legacy progress did not render: " + errors.join("; "));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(document.querySelector('#plan-chips')!.textContent).toContain("26/32 completed (reported)");
    expect(document.querySelector('#plan-chips')!.textContent).toContain("implementing (reported)");
    expect(document.querySelectorAll('.slice-running')).toHaveLength(0);
    expect(document.querySelector('#slice-list .slice-current')!.textContent).toContain("Slice 25");
    const filter = document.querySelector('#slice-status-filter') as HTMLSelectElement;
    filter.value = "open"; filter.dispatchEvent(new dom.window.Event("change")); expect(document.querySelectorAll('#slice-list [data-slice-id]')).toHaveLength(6);
    (document.querySelector('#slice-jump-current') as HTMLElement).click(); expect((document.activeElement as HTMLElement).dataset.sliceId).toBe(current.id);
    expect(document.querySelector('button.plan-item[data-plan-id="fixture"]')!.textContent).toContain("implementing (reported) | idle");
    expect(document.querySelector('#architect-pulse-plan')!.textContent).toContain("implementing/idle (reported)"); expect(errors).toEqual([]);
    await expect(readFile(join(root, "data", "plan_state.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { dom.window.close(); }
});
it("actual graph receipt and accepted review converge detail/list; implemented does not advance or complete the plan", async () => {
  await started(); expect((await detail()).operational_state).toMatchObject({ current_slice_id: "first", active_slice: null, execution_state: "idle", progress: { verified: 0 } });
  const graph = await commitGraphWrites({ writes: [{ file: "features.json", content: JSON.stringify({ features: [{ id: "f", name: "Fixture" }] }) }], actor: "fixture-implementation", operation_id: "material-change", scope: ["fixture:source"] });
  expect(graph.receipt.outcome).toBe("committed");
  expect((await command({ type: "record_implementation", slice_id: "first", receipt_ids: ["material-change"], effect_obligation_ids: [], required_stages: [], evidence_ids: ["fixture-source"] })).response.status).toBe(200);
  expect((await detail()).operational_state).toMatchObject({ current_status: "implemented", progress: { implemented: 1, verified: 0 } });
  expect((await command({ type: "begin_verification", slice_id: "first" })).response.status).toBe(200);
  const view = (await readPlanAuthority(await getPlanAuthorityScope("fixture")))!;
  expect((await command({ type: "finish_verification", slice_id: "first", implementation_revision: view.state.slices[0].implementation_revision,
    acceptance_hash: view.state.definition.slices[0].acceptance_hash, passed: true, evidence_ids: ["actual-fixture-check"], review_id: "accepted-review", reason: "Passed fixture check" })).response.status).toBe(200);
  const plan = await detail(); expect(plan.operational_state).toMatchObject({ current_slice_id: null, active_slice: null, last_completed_slice: { id: "first" }, next_slice: { id: "second" }, progress: { verified: 1, required: 2 } });
  const index = await (await fetch(url.replace("/fixture", ""))).json() as any; expect(index.plans[0].operational_state).toEqual(plan.operational_state);
  expect(plan.status).toBe("implementing"); expect((await command({ type: "complete_plan", review_id: "premature" })).response.status).toBe(400);
  expect((await command({ type: "reopen_slice", slice_id: "first", reason: "Evidence changed" })).response.status).toBe(200);
  expect((await detail()).operational_state).toMatchObject({ current_slice_id: "first", last_completed_slice: null, progress: { verified: 0 } });
});
it("rejects client-forged identity/leases and stale concurrent transitions without another effect", async () => {
  await reviewed(); const plan = await detail(); const body = { operation_id: "review", expected_revision: plan.operational_state.revision, expected_definition_hash: plan.operational_state.definition_hash, command: { type: "review_plan", review_id: "review" } };
  expect((await post("/lifecycle/commands", { ...body, actor: { kind: "runtime" } })).response.status).toBe(400);
  expect((await post("/lifecycle/commands", body)).response.status).toBe(200);
  expect((await post("/lifecycle/commands", body)).data.result.replayed).toBe(true);
  expect((await post("/lifecycle/commands", { ...body, operation_id: "competing" })).response.status).toBe(409);
  expect((await command({ type: "admit_execution", slice_id: "first", lease_id: "forged", execution_id: "forged", generation: 1, kind: "implementation", expires_at: new Date(Date.now() + 60_000).toISOString() })).response.status).toBe(403);
});
it("archive refuses a running/recovery lease and keeps original artifacts on failure", async () => {
  await started(); const view = (await readPlanAuthority(await getPlanAuthorityScope("fixture")))!;
  await applyPlanCommand({ actor: { id: "supervisor", kind: "runtime", instance_id: view.state.instance_id, project_id: view.state.project_id }, plan_id: "fixture", operation_id: "fixture-admission",
    expected_revision: view.state.revision, expected_definition_hash: view.state.definition_hash,
    command: { type: "admit_execution", slice_id: "first", lease_id: "fixture-lease", execution_id: "fixture-job", generation: 1, kind: "implementation", expires_at: new Date(Date.now() + 60_000).toISOString() } });
  expect((await post("/archive", {})).response.status).toBe(409); expect(await readFile(join(root, "plans", "fixture.md"), "utf8")).toBe(markdown);
  expect((await detail()).operational_state).toMatchObject({ active_slice: { id: "first" }, execution_state: "running" });
});
it("the real Architect script exposes readable running/current markers, slice filters and keyboard navigation", async () => {
  await started();
  const view = (await readPlanAuthority(await getPlanAuthorityScope("fixture")))!;
  await applyPlanCommand({ actor: { id: "supervisor", kind: "runtime", instance_id: view.state.instance_id, project_id: view.state.project_id }, plan_id: "fixture", operation_id: "ui-fixture-admission",
    expected_revision: view.state.revision, expected_definition_hash: view.state.definition_hash,
    command: { type: "admit_execution", slice_id: "first", lease_id: "ui-fixture-lease", execution_id: "ui-fixture-job", generation: 1, kind: "implementation", expires_at: new Date(Date.now() + 60_000).toISOString() } });
  const base = new URL(url).origin, html = (await (await fetch(base + "/architect")).text()).replace(/<script src="[^"]+"><\/script>\s*/g, "");
  const errors: string[] = [];
  const dom = new JSDOM(html, { url: base + "/architect?plan=fixture", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(window) {
      const win = window as any;
      window.addEventListener("error", event => errors.push(String(event.error?.message ?? event.message)));
      win.fetch = (resource: any, init: any) => fetch(new URL(String(resource), base), init);
      win.EventSource = class { addEventListener() {} close() {} };
      win.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
      Object.defineProperty(window.crypto, "randomUUID", { value: randomUUID });
    } });
  try {
    const document = dom.window.document, deadline = Date.now() + 5000;
    while (!document.querySelector('#slice-list [data-slice-id="first"]')) {
      if (Date.now() > deadline) throw new Error("Architect did not render the governed plan: " + errors.join("; "));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const first = document.querySelector('#slice-list [data-slice-id="first"]')!;
    expect(first.classList.contains("slice-running")).toBe(true); expect(first.classList.contains("slice-current")).toBe(true);
    expect(document.querySelector("#plan-chips")!.textContent).toContain("Running slice");
    const filter = document.querySelector("#slice-status-filter") as HTMLSelectElement;
    filter.value = "completed"; filter.dispatchEvent(new dom.window.Event("change")); expect(document.querySelectorAll("#slice-list [data-slice-id]")).toHaveLength(0);
    (document.querySelector("#slice-jump-current") as HTMLElement).click();
    expect(filter.value).toBe("all"); expect((document.activeElement as HTMLElement).dataset.sliceId).toBe("first");
    document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement?.id).toBe("center-plan-body"); expect(errors).toEqual([]);
  } finally { dom.window.close(); }
});
