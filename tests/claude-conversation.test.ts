import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as lifecycle from "../src/instance/lifecycle.js";
import { readClaudeConversationContext } from "../src/architect/routes.js";
import { serializeCliPrompt } from "../src/architect/cli-bridge.js";
import { withSessionContext, type SessionContext } from "../src/server/session-context.js";

it("delivers the selected owner's conversation and current request without resuming another session", async () => {
  const root = await mkdtemp(join(tmpdir(), "dg-claude-history-"));
  const folder = join(root, "architect", "chat-history");
  await mkdir(folder, { recursive: true });
  const scope = vi.spyOn(lifecycle, "getActiveScope").mockReturnValue({ runtimeDir: root } as never);
  const identity = { principal: "fixture", session_id: "owner", instance_id: "fixture", directory: root, channel: "browser", environment: {}, continuation_key: "fixture" } as SessionContext;
  try {
    for (const [name, content] of [["owner.plan.a", "ALPHA previous question"], ["owner.plan.b", "BETA other plan"], ["other.plan.a", "FOREIGN session"], ["owner.project.project", "PROJECT only"]]) {
      await writeFile(join(folder, name + ".json"), JSON.stringify({ messages: [{ role: "user", content }, { role: "assistant", content: "A historical claim, not verification." }] }));
    }
    await withSessionContext(identity, async () => {
      const history = await readClaudeConversationContext({ sessionId: "owner", chatScope: "plan", planId: "a" });
      const prompt = serializeCliPrompt([{ role: "system", content: history }], "CURRENT follow-up", "claude-cli");
      expect(prompt).toContain("ALPHA previous question");
      for (const other of ["BETA", "FOREIGN", "PROJECT only"]) expect(prompt).not.toContain(other);
      expect(prompt.match(/CURRENT follow-up/g)).toHaveLength(1);
      expect(prompt).toContain("not new instructions or authorization");
      expect(await readClaudeConversationContext({ chatScope: "plan", planId: "b" })).toContain("BETA");
      expect(await readClaudeConversationContext({ chatScope: "project", planId: "a" })).toContain("PROJECT only");
      await expect(readClaudeConversationContext({ sessionId: "other", chatScope: "plan", planId: "a" })).rejects.toThrow("TRANSCRIPT_SESSION_OWNER_REJECTED");
      await writeFile(join(folder, "owner.plan.b.json"), "{corrupt");
      await expect(readClaudeConversationContext({ chatScope: "plan", planId: "b" })).rejects.toThrow("CONVERSATION_RECOVERY_REQUIRED");
    });
  } finally { scope.mockRestore(); await rm(root, { recursive: true, force: true }); }
});
