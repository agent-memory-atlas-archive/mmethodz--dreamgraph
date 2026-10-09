import { it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";

// Execute the actual browser function emitted by the Architect template.
async function reader() {
  const source = await readFile(new URL("../src/architect/routes.ts", import.meta.url), "utf8");
  const start = source.indexOf("    async function readArchitectChatPayload(response) {");
  const end = source.indexOf("    async function sendChatMessage(", start);
  const emitted = new Function("return `" + source.slice(start, end) + "`;")();
  const append = vi.fn(), update = vi.fn();
  const read = new Function("appendToolTraceMessage", "updateAutonomyPassView",
    "let liveToolTraceSeen=false;const activeToolTraceRows=new Map();" + emitted + ";return readArchitectChatPayload;")(append, update);
  return { read, append, update };
}
it("renders tool frames before a final response, across fragmented CRLF and UTF-8", async () => {
  const { read, append, update } = await reader();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller=value; } });
  const result = read(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  const event = { phase:"tool", tool:"search_source_code", status:"running", text:"löydä 🧭", runtime:{adapter:"claude-cli"} };
  const bytes = new TextEncoder().encode("event: architect.chat.status\r\ndata: " + JSON.stringify(event) + "\r\n\r\n");
  // Every byte boundary is exercised, including each multibyte character and CRLF.
  for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
  await vi.waitFor(() => expect(append).toHaveBeenCalledWith([event], null, event.runtime));
  expect(update).toHaveBeenCalledWith("running", 0);
  const final = { content:"Finished", tool_trace:[event] };
  controller.enqueue(new TextEncoder().encode("event: architect.chat.result\ndata: " + JSON.stringify(final) + "\n\n"));
  controller.close();
  expect(await result).toEqual(final);
  expect(append).toHaveBeenCalledTimes(1);
});
it("does not turn a truncated stream into an empty success or automatically retry it", async () => {
  const { read } = await reader();
  await expect(read(new Response("event: architect.chat.status\ndata: {\"phase\":\"working\"}\n\n",
    {headers:{"content-type":"text/event-stream"}}))).rejects.toThrow("before a final result");
  expect(await read(Response.json({content:"ordinary JSON"}))).toEqual({content:"ordinary JSON"});
});
