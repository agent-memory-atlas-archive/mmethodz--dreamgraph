/** Durable session preferences/grants over the canonical physical publication owner. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { z } from "zod";
import { AuthorityGrantSchema } from "../graph/contracts.js";
import { commitGraphWrites, loadPublicationState, publicationContentHash, recoverGraphPublication } from "../graph/publication.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { dataPath, getDataDir, withDataDirectory } from "../utils/paths.js";
import { validateEngineEnvValues } from "../config/engine-setting-catalogue.js";
import { stripBom } from "../utils/read-json.js";
import type { SessionContext } from "./session-context.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const utc = z.string().datetime(), id = z.string().min(1).max(512);
const SessionSchema = z.object({ id, principal: id, token_hash: id, created_at: utc, expires_at: utc,
  environment: z.record(z.string().max(16384)) }).strict();
const ChallengeSchema = z.object({ id, session_id: id, principal: id, execution_id: id,
  scope: z.array(id).min(1).max(32), capabilities: z.array(id).min(1).max(32), scope_digest: id,
  first_confirmed_at: utc, expires_at: utc, grant_expires_at: utc, consumed_at: utc.nullable() }).strict();
const StateSchema = z.object({ schema: z.literal("dreamgraph.session_authority.v1"), instance_id: id, revision: z.number().int().nonnegative(),
  sessions: z.record(SessionSchema), challenges: z.record(ChallengeSchema), grants: z.record(AuthorityGrantSchema) }).strict();
const FILE = "session_authority.json";
const revocationListeners = new Map<string, Set<(grant_id: string) => Promise<void>>>();
export class SessionAuthority {
  constructor(readonly instance_id: string, readonly directory = getDataDir(), private readonly clock = () => new Date()) {}
  remainingGrantMs(expires_at: string): number { return Math.max(0, Date.parse(expires_at) - this.clock().getTime()); }
  private async physicalKey() {
    const path = await realpath(this.directory); return process.platform === "win32" ? path.toLowerCase() : path;
  }
  async onGrantRevoked(listener: (grant_id: string) => Promise<void>) {
    const key = await this.physicalKey(), listeners = revocationListeners.get(key) ?? new Set();
    listeners.add(listener); revocationListeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) revocationListeners.delete(key); };
  }
  private scope<T>(work: () => T): T { return withDataDirectory(this.directory, work); }
  private async load(): Promise<z.infer<typeof StateSchema>> {
    const publication = await loadPublicationState();
    try {
      const body = await readFile(dataPath(FILE), "utf8");
      if (publication.stores[FILE] && publication.stores[FILE].hash !== publicationContentHash(body)) throw new Error("SESSION_AUTHORITY_UNPUBLISHED_CHANGE");
      const state = StateSchema.parse(JSON.parse(stripBom(body)));
      if (state.instance_id !== this.instance_id) throw new Error("SESSION_AUTHORITY_INSTANCE_MISMATCH"); return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !publication.stores[FILE]) return {
        schema: "dreamgraph.session_authority.v1", instance_id: this.instance_id, revision: 0, sessions: {}, challenges: {}, grants: {} };
      throw error;
    }
  }
  private async change<T>(work: (state: z.infer<typeof StateSchema>) => T | Promise<T>): Promise<T> {
    return this.scope(() => withGraphReconciliation(async () => {
      await recoverGraphPublication(); const state = await this.load(), result = await work(state); state.revision++;
      const body = JSON.stringify(StateSchema.parse(state)); if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error("SESSION_AUTHORITY_CAPACITY");
      const publication = await loadPublicationState();
      await commitGraphWrites({ actor: "session_authority", operation_id: `session:${randomUUID()}`,
        ...(publication.epoch !== "uninitialized" ? { operation_epoch: publication.epoch } : {}),
        scope: [FILE], writes: [{ file: FILE, content: body }], cause: "session_authority" }); return result;
    }));
  }
  private owner(state: z.infer<typeof StateSchema>, session_id: string, principal: string) {
    const session = state.sessions[session_id];
    if (!session || session.principal !== principal || Date.parse(session.expires_at) <= this.clock().getTime()
      || this.clock().getTime() < Date.parse(session.created_at)) throw new Error("SESSION_AUTHORITY_REJECTED");
    return session;
  }
  async create(principal: string): Promise<{ bearer: string; context: SessionContext }> {
    const secret = randomBytes(32).toString("base64url"), session_id = randomUUID();
    await this.change(state => {
      // Expired identities can be discarded only when no live grant refers to them.
      for (const [key, session] of Object.entries(state.sessions)) if (Date.parse(session.expires_at) <= this.clock().getTime()
        && !Object.values(state.grants).some(grant => grant.session_id === key && !grant.revoked_at && Date.parse(grant.expires_at) > this.clock().getTime())) delete state.sessions[key];
      if (Object.keys(state.sessions).length >= 512) throw new Error("SESSION_CAPACITY");
      const now = this.clock(); state.sessions[session_id] = { id: session_id, principal: id.parse(principal), token_hash: hash(secret),
        created_at: now.toISOString(), expires_at: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(), environment: {} };
    });
    const bearer = `${session_id}.${secret}`; return { bearer, context: await this.authenticate(bearer, principal) };
  }
  async authenticate(bearer: string, principal: string): Promise<SessionContext> {
    const parts = bearer.split("."); if (parts.length !== 2 || bearer.length > 256) throw new Error("SESSION_BEARER_INVALID");
    return this.scope(() => withGraphRead(async () => {
      const state = await this.load(), session = this.owner(state, parts[0], principal);
      if (hash(parts[1]) !== session.token_hash) throw new Error("SESSION_BEARER_INVALID");
      return { principal, session_id: session.id, directory: this.directory, channel: "browser", continuation_key: session.token_hash,
        environment: { ...session.environment }, saveEnvironment: async updates => {
          if (Object.keys(updates).some(key => !key.startsWith("DREAMGRAPH_LLM_ARCHITECT_") && !key.startsWith("DREAMGRAPH_ARCHITECT_"))
            || Object.keys(updates).some(key => /KEY|TOKEN|BUDGET|CAPABILITY|RETENTION/.test(key) && !key.includes("TOKEN_ECONOMY"))) throw new Error("SESSION_PREFERENCE_SCOPE_REJECTED");
          validateEngineEnvValues(updates, Object.keys(updates));
          await this.change(current => Object.assign(this.owner(current, session.id, principal).environment, updates));
        } };
    }));
  }
  /** First explicit human confirmation binds scope and execution, never a model continuation. */
  async beginFullAccess(context: SessionContext, input: { execution_id: string; scope: string[]; capabilities: string[]; duration_ms: number; human_confirmed: boolean }) {
    if (context.channel !== "browser" || context.execution_policy || input.human_confirmed !== true) throw new Error("FULL_ACCESS_HUMAN_CONFIRMATION_REQUIRED");
    const duration = z.number().int().min(1000).max(3_600_000).parse(input.duration_ms);
    return this.change(state => {
      this.owner(state, context.session_id, context.principal);
      if (Object.keys(state.challenges).length >= 512) throw new Error("GRANT_CHALLENGE_CAPACITY");
      const now = this.clock(), challenge = ChallengeSchema.parse({ id: randomUUID(), session_id: context.session_id, principal: context.principal,
        execution_id: input.execution_id, scope: input.scope, capabilities: input.capabilities,
        scope_digest: hash(JSON.stringify([input.execution_id, input.scope, input.capabilities, duration])), first_confirmed_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 120000).toISOString(), grant_expires_at: new Date(now.getTime() + duration).toISOString(), consumed_at: null });
      state.challenges[challenge.id] = challenge;
      return { challenge_id: challenge.id, scope_digest: challenge.scope_digest, scope: challenge.scope, capabilities: challenge.capabilities,
        execution_id: challenge.execution_id, expires_at: challenge.expires_at, grant_expires_at: challenge.grant_expires_at,
        second_confirmation_required: true, retained_limits: ["truth", "commit", "audit", "cost", "native_capability_qualification"] };
    });
  }
  async confirmFullAccess(context: SessionContext, input: { challenge_id: string; scope_digest: string; human_confirmed: boolean }) {
    if (context.channel !== "browser" || context.execution_policy || input.human_confirmed !== true) throw new Error("FULL_ACCESS_SECOND_HUMAN_CONFIRMATION_REQUIRED");
    return this.change(state => {
      this.owner(state, context.session_id, context.principal); const challenge = state.challenges[input.challenge_id], now = this.clock();
      if (!challenge || challenge.session_id !== context.session_id || challenge.principal !== context.principal
        || challenge.scope_digest !== input.scope_digest || challenge.consumed_at || now.getTime() < Date.parse(challenge.first_confirmed_at)
        || now.getTime() >= Date.parse(challenge.expires_at) || now.getTime() >= Date.parse(challenge.grant_expires_at)) throw new Error("FULL_ACCESS_CHALLENGE_REJECTED");
      const grant = AuthorityGrantSchema.parse({ schema: "dreamgraph.authority_grant.v1", id: randomUUID(), instance_id: this.instance_id,
        session_id: context.session_id, execution_id: challenge.execution_id, actor: context.principal, mode: "full_access",
        scope: challenge.scope, capabilities: challenge.capabilities, issued_at: now.toISOString(), expires_at: challenge.grant_expires_at, revoked_at: null,
        confirmations: [{ id: challenge.id, actor: context.principal, confirmed_at: challenge.first_confirmed_at, scope_digest: challenge.scope_digest },
          { id: randomUUID(), actor: context.principal, confirmed_at: now.toISOString(), scope_digest: challenge.scope_digest }] });
      if(Object.keys(state.grants).length>=512)throw new Error("GRANT_CAPACITY");
      challenge.consumed_at = now.toISOString(); state.grants[grant.id] = grant; return grant;
    });
  }
  /** Ordinary scoped CU permission; exact replay retains the original expiry and reviewed profile/backend. */
  async grantScopedComputer(context:SessionContext,input:unknown){
    const request=z.object({operation_id:id,execution_id:id,target_id:id,profile_hash:z.string().regex(/^sha256:[a-f0-9]{64}$/),
      backend_source_hash:z.string().regex(/^sha256:[a-f0-9]{64}$/),interact:z.boolean(),duration_ms:z.number().int().min(1000).max(300000),
      human_confirmed:z.literal(true)}).strict().parse(input);
    if(context.channel!=="browser"||context.execution_policy)throw new Error("SCOPED_COMPUTER_HUMAN_CONTROL_REQUIRED");
    return this.change(state=>{this.owner(state,context.session_id,context.principal);
      const scope_digest=hash(JSON.stringify(request)),grant_id="scoped-computer:"+hash(JSON.stringify([context.session_id,request.operation_id]));
      const existing=state.grants[grant_id];
      if(existing){if(existing.confirmations[0]?.scope_digest!==scope_digest)throw new Error("SCOPED_COMPUTER_GRANT_IDENTITY_CONFLICT");return existing;}
      if(Object.keys(state.grants).length>=512)throw new Error("GRANT_CAPACITY");const now=this.clock();
      const grant=AuthorityGrantSchema.parse({schema:"dreamgraph.authority_grant.v1",id:grant_id,instance_id:this.instance_id,session_id:context.session_id,
        execution_id:request.execution_id,actor:context.principal,mode:"scoped",scope:[request.target_id],
        capabilities:["computer_observe",...(request.interact?["computer_interact"]:[]),`computer_profile:${request.profile_hash}`,`computer_backend:${request.backend_source_hash}`],
        issued_at:now.toISOString(),expires_at:new Date(now.getTime()+request.duration_ms).toISOString(),revoked_at:null,
        confirmations:[{id:request.operation_id,actor:context.principal,confirmed_at:now.toISOString(),scope_digest}]});
      state.grants[grant_id]=grant;return grant;
    });
  }
  async revoke(context: SessionContext, grant_id: string) {
    const grant = await this.change(state => {
      this.owner(state, context.session_id, context.principal); const grant = state.grants[grant_id];
      if (!grant || grant.session_id !== context.session_id || grant.actor !== context.principal) throw new Error("GRANT_OWNER_REJECTED");
      grant.revoked_at ??= this.clock().toISOString(); return grant;
    });
    // Persist revocation before stopping workers; never wait for a worker while
    // holding the graph writer. Input already fails closed if stop is unknown.
    await Promise.all([...revocationListeners.get(await this.physicalKey()) ?? []].map(listener => listener(grant_id)));
    return grant;
  }
  async ownGrants(context: SessionContext) {
    return this.scope(() => withGraphRead(async () => {
      const state = await this.load(); this.owner(state, context.session_id, context.principal);
      return Object.values(state.grants).filter(grant => grant.session_id === context.session_id && grant.actor === context.principal);
    }));
  }
  async assertGrant(context: SessionContext, grant_id: string, execution_id: string, scope: string, capability: string) {
    return this.scope(() => withGraphRead(async () => {
      const state = await this.load(); this.owner(state, context.session_id, context.principal); const grant = state.grants[grant_id];
      if (!grant || grant.session_id !== context.session_id || grant.actor !== context.principal || grant.execution_id !== execution_id
        || grant.revoked_at || Date.parse(grant.expires_at) <= this.clock().getTime() || this.clock().getTime() < Date.parse(grant.issued_at)
        || !grant.scope.includes(scope) || !grant.capabilities.includes(capability)) throw new Error("GRANT_SCOPE_REJECTED"); return grant;
    }));
  }
}
