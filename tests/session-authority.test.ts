import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionAuthority } from "../src/server/session-authority.js";
import { ComputerControlBindings } from "../src/server/computer-control.js";
import { withSessionContext, sealSessionContinuation, openSessionContinuation } from "../src/server/session-context.js";
import { startSession, getActiveSession, loadSession, listSessions, completeSession } from "../src/discipline/session.js";
import { setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import type { ExecutionPolicy } from "../src/server/execution-policy.js";
let root: string, now: number, service: SessionAuthority;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-session-authority-")); now = Date.now(); setDataDirOverride(root); service = new SessionAuthority("fixture-instance", root, () => new Date(now)); });
afterEach(async () => { await releaseGraphWriter(root); setDataDirOverride(null); await rm(root, { recursive: true, force: true }); });
const grantInput = { execution_id: "execution:1", scope: ["target:1"], capabilities: ["computer_use"], duration_ms: 60000, human_confirmed: true };
const scopedInput = { operation_id: "operator-confirmation:1", execution_id: "execution:1", target_id: "target:1", profile_hash: "sha256:"+"a".repeat(64),
  backend_source_hash: "sha256:"+"b".repeat(64), interact: false, duration_ms: 60000, human_confirmed: true };
describe("private durable authority", () => {
  it("a scoped observation grant pins the exact execution, profile and backend without input permission", async () => {
    const a = await service.create("owner"), b = await service.create("owner");
    const grant = await service.grantScopedComputer(a.context, scopedInput);
    expect(grant).toMatchObject({mode:"scoped",scope:["target:1"]}); expect(grant.confirmations).toHaveLength(1);
    for(const capability of ["computer_observe",`computer_profile:${scopedInput.profile_hash}`,`computer_backend:${scopedInput.backend_source_hash}`])
      expect((await service.assertGrant(a.context,grant.id,"execution:1","target:1",capability)).id).toBe(grant.id);
    for(const capability of ["computer_interact", "computer_use", `computer_profile:sha256:${"c".repeat(64)}`])
      await expect(service.assertGrant(a.context,grant.id,"execution:1","target:1",capability)).rejects.toThrow("SCOPE_REJECTED");
    await expect(service.assertGrant(b.context,grant.id,"execution:1","target:1","computer_observe")).rejects.toThrow("SCOPE_REJECTED");
    await expect(service.assertGrant(a.context,grant.id,"other-execution","target:1","computer_observe")).rejects.toThrow("SCOPE_REJECTED");
  });
  it("lost scoped-grant acknowledgements preserve expiry and revocation across restart and refuse widening", async () => {
    const a=await service.create("owner"), grant=await service.grantScopedComputer(a.context,scopedInput); now+=1000;
    const restarted=new SessionAuthority("fixture-instance",root,()=>new Date(now));
    expect(await restarted.grantScopedComputer(a.context,{...scopedInput})).toEqual(grant);
    await expect(restarted.grantScopedComputer(a.context,{...scopedInput,interact:true})).rejects.toThrow("IDENTITY_CONFLICT");
    await expect(restarted.grantScopedComputer(a.context,{...scopedInput,backend_source_hash:"sha256:"+"c".repeat(64)})).rejects.toThrow("IDENTITY_CONFLICT");
    const revoked=await restarted.revoke(a.context,grant.id);
    expect(await restarted.grantScopedComputer(a.context,scopedInput)).toEqual(revoked);
    await expect(restarted.assertGrant(a.context,grant.id,"execution:1","target:1","computer_observe")).rejects.toThrow();
    const next=await restarted.grantScopedComputer(a.context,{...scopedInput,operation_id:"next",interact:true}); now+=60001;
    expect(await restarted.grantScopedComputer(a.context,{...scopedInput,operation_id:"next",interact:true})).toEqual(next);
    await expect(restarted.assertGrant(a.context,next.id,"execution:1","target:1","computer_interact")).rejects.toThrow();
  });
  it("workers and MCP continuations cannot mint scoped grants or confirm full access", async () => {
    const a=await service.create("owner"), challenge=await service.beginFullAccess(a.context,grantInput);
    for(const context of [{...a.context,channel:"mcp" as const},{...a.context,execution_policy:{} as ExecutionPolicy}]){
      await expect(service.grantScopedComputer(context,scopedInput)).rejects.toThrow("HUMAN_CONTROL_REQUIRED");
      await expect(service.beginFullAccess(context,grantInput)).rejects.toThrow("HUMAN_CONFIRMATION_REQUIRED");
      await expect(service.confirmFullAccess(context,{...challenge,human_confirmed:true})).rejects.toThrow("HUMAN_CONFIRMATION_REQUIRED");
    }
    await expect(service.grantScopedComputer(a.context,{...scopedInput,unexpected:"widen"})).rejects.toThrow();
    await expect(service.grantScopedComputer(a.context,{...scopedInput,duration_ms:300001})).rejects.toThrow();
    expect(await service.ownGrants(a.context)).toEqual([]);
  });
  it("persists isolated selection/settings across service recreation, never bearer secrets", async () => {
    const [a, b] = await Promise.all([service.create("owner"), service.create("owner")]);
    await a.context.saveEnvironment!({ DREAMGRAPH_ARCHITECT_SELECTED_PLAN_ID: "plan-a" });
    const restart = new SessionAuthority("fixture-instance", root, () => new Date(now));
    expect((await restart.authenticate(a.bearer, "owner")).environment.DREAMGRAPH_ARCHITECT_SELECTED_PLAN_ID).toBe("plan-a");
    expect((await restart.authenticate(b.bearer, "owner")).environment).toEqual({});
    await expect(restart.authenticate(a.bearer, "other")).rejects.toThrow("AUTHORITY_REJECTED");
    expect(await readFile(join(root, "session_authority.json"), "utf8")).not.toContain(a.bearer.split('.')[1]);
    await expect(a.context.saveEnvironment!({ DREAMGRAPH_REMOTE_ENABLED: "true" })).rejects.toThrow("SCOPE_REJECTED");
  });
  it("requires two separately scoped confirmations, exact execution and independent expiry/revocation", async () => {
    const a = await service.create("owner"), b = await service.create("owner");
    await expect(service.beginFullAccess(a.context, { ...grantInput, human_confirmed: false })).rejects.toThrow("HUMAN_CONFIRMATION");
    const challenge = await service.beginFullAccess(a.context, grantInput);
    await expect(service.confirmFullAccess(b.context, { ...challenge, human_confirmed: true })).rejects.toThrow("CHALLENGE_REJECTED");
    const grant = await service.confirmFullAccess(a.context, { ...challenge, human_confirmed: true }); expect(grant.confirmations).toHaveLength(2);
    await expect(service.confirmFullAccess(a.context, { ...challenge, human_confirmed: true })).rejects.toThrow("CHALLENGE_REJECTED");
    await expect(service.assertGrant(a.context, grant.id, "wrong", "target:1", "computer_use")).rejects.toThrow("SCOPE_REJECTED");
    expect((await service.assertGrant(a.context, grant.id, "execution:1", "target:1", "computer_use")).id).toBe(grant.id);
    await expect(service.revoke(b.context, grant.id)).rejects.toThrow("OWNER_REJECTED");
    await service.revoke(a.context, grant.id); await expect(service.assertGrant(a.context, grant.id, "execution:1", "target:1", "computer_use")).rejects.toThrow();
    const c = await service.beginFullAccess(a.context, grantInput); now += 120001;
    await expect(service.confirmFullAccess(a.context, { ...c, human_confirmed: true })).rejects.toThrow("CHALLENGE_REJECTED");
  });
  it("signs continuations for one session and isolates concurrent discipline state and resume", async () => {
    const [a, b] = await Promise.all([service.create("owner"), service.create("owner")]);
    const token = withSessionContext(a.context, () => sealSessionContinuation("original-envelope"));
    expect(withSessionContext(a.context, () => openSessionContinuation(token))).toBe("original-envelope");
    expect(() => withSessionContext(b.context, () => openSessionContinuation(token))).toThrow("SESSION_MISMATCH");
    const sessions = await Promise.all([a, b].map((s, index) => withSessionContext(s.context, async () => {
      const created = await startSession({ type: "modification", description: `owner-${index}`, target_scope: [root] });
      expect(getActiveSession()?.id).toBe(created.id); return created;
    })));
    await withSessionContext(a.context, async () => {
      expect(getActiveSession()?.id).toBe(sessions[0].id); expect((await listSessions()).map(s => s.id)).toEqual([sessions[0].id]);
      await expect(loadSession(sessions[1].id, true)).rejects.toThrow("OWNER_REJECTED"); await completeSession("completed");
    });
    await withSessionContext(b.context, async () => { expect(getActiveSession()?.id).toBe(sessions[1].id); await completeSession("completed"); });
  });
  it.each(["stop", "revoke", "expire", "unknown-stop"])("fences Computer Use controls and stops outside the model loop on %s", async action => {
    const [a, b] = await Promise.all([service.create("owner"), service.create("owner")]);
    const c = await service.beginFullAccess(a.context, { ...grantInput, duration_ms: action === "expire" ? 1000 : 60000 }), grant = await service.confirmFullAccess(a.context, { ...c, human_confirmed: true });
    const control = new ComputerControlBindings(service); let stops = 0;
    const bound = await control.bind(a.context, { independently_stoppable: true, stop: async () => { stops++; if (action === "unknown-stop") throw new Error("worker did not acknowledge"); },
      target: { schema: "dreamgraph.computer_target.v1", id: "target:1", instance_id: "fixture-instance", session_id: a.context.session_id,
        host_id: "fixture-worker", surface: "browser", generation: 1, origin: "http://fixture", application: null },
      session: { schema: "dreamgraph.computer_session.v1", id: "computer:1", instance_id: "fixture-instance", session_id: a.context.session_id,
        execution_id: "execution:1", job_id: "job:1", owner: "owner", host_id: "fixture-worker", target_ids: ["target:1"], grant_id: grant.id,
        capability_id: "fixture-control-port-only", fence: 1, policy_revision: "fixture:1", state: "ready",
        created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), terminal_reason: null } });
    await expect(control.stop(b.context, bound.id)).rejects.toThrow("OWNER_REJECTED");
    await expect(control.assertInput(a.context, bound.id, 1, 2)).rejects.toThrow("FENCE_REJECTED");
    expect(await control.assertInput(a.context, bound.id, 1, 1)).toMatchObject({ target_id: "target:1" });
    if (action === "revoke") await new SessionAuthority("fixture-instance", root, () => new Date(now)).revoke(a.context, grant.id);
    else if (action === "expire") await vi.waitFor(() => expect(bound.signal.aborted).toBe(true), { timeout: 2000 });
    else await control.stop(a.context, bound.id);
    await control.stop(a.context, bound.id); expect(stops).toBe(1); expect(bound.signal.aborted).toBe(true);
    await expect(control.assertInput(a.context, bound.id, 1, 1)).rejects.toThrow("COMPUTER_");
    expect(control.status(a.context, bound.id).state).toBe(action === "unknown-stop" ? "recovery_required" : "stopped");
    expect(control.status(a.context, bound.id).physical_seat_qualification).toContain("not_established");
  });
});
