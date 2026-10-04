import { describe, expect, it } from "vitest";

import { ARCHITECT_AUTO_RETRY_LIMIT, decideArchitectContinuation, synthesizeArchitectCliPassResult } from "../src/architect/continuation.js";

describe("automatic 'Continue requested completion target' retries are capped", () => {
  const decide = (previous: string | null, streak: number) => {
    const context = { selected_plan_id: null, chat_scope: "project" as const, completed_passes: 1, max_passes: 50, previous_selected_action_id: previous, auto_retry_streak: streak };
    const parseResult = synthesizeArchitectCliPassResult({ assistantText: "Blocked for now; remaining work: still need to build the demo.", context });
    return decideArchitectContinuation({ parseResult, context, autonomyAllowsContinue: true });
  };

  it("allows the first automatic retries", () => {
    expect(decide(null, 0).status).toBe("continue");
    expect(decide("continue-requested-target", ARCHITECT_AUTO_RETRY_LIMIT - 1).status).toBe("continue");
  });

  it("stops for the operator once the limit is reached", () => {
    const decision = decide("continue-requested-target", ARCHITECT_AUTO_RETRY_LIMIT);
    expect(decision.status).toBe("stopped");
    expect(decision.reason).toBe("automatic_retry_limit");
  });

  it("does not count retries that followed a different action", () => {
    expect(decide("some-other-action", 7).status).toBe("continue");
  });
});
