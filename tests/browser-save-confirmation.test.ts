import { describe, expect, it } from "vitest";
import { answerSaveConfirmation, saveConfirmationIdentity } from "../src/computer/browser-bridge/save-confirmation.js";

describe("browser Save confirmation identity", () => {
  it("requires a full filename and exact web origin, not a URL or credentials", () => {
    expect(saveConfirmationIdentity("C:/work/proof.js", "http://127.0.0.1:52203"))
      .toEqual({ filename: "proof.js", extension: ".js", origin: "http://127.0.0.1:52203" });
    for (const origin of ["http://localhost/path", "https://user:secret@example.com", "file:///C:/work", "https://example.com/"])
      expect(() => saveConfirmationIdentity("C:/work/proof.js", origin)).toThrow();
    expect(() => saveConfirmationIdentity("proof.js", "https://example.com")).toThrow("PATH_INVALID");
  });
  it("leaves unqualified platforms explicit instead of pretending the warning was accepted", async () => {
    expect(await answerSaveConfirmation({ path: "C:/work/proof.js", origin: "https://example.com" }, { platform: "linux" }))
      .toMatchObject({ status: "unsupported" });
  });
});
