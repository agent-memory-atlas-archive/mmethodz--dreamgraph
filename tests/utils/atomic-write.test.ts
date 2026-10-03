import { describe, expect, it, vi, beforeEach } from "vitest";

const fd = {
  writeFile: vi.fn(),
  datasync: vi.fn(),
  close: vi.fn(),
};

const openMock = vi.fn();
const renameMock = vi.fn();
const unlinkMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  realpath: async (path: string) => path,
  open: openMock,
  rename: renameMock,
  unlink: unlinkMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  openMock.mockResolvedValue(fd);
  fd.writeFile.mockResolvedValue(undefined);
  fd.datasync.mockResolvedValue(undefined);
  fd.close.mockResolvedValue(undefined);
  unlinkMock.mockResolvedValue(undefined);
});

describe("atomicWriteFile", () => {
  it("retries transient Windows rename failures before cleaning up", async () => {
    const { atomicWriteFile } = await import("../../src/utils/atomic-write.js");
    const err = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    renameMock.mockRejectedValueOnce(err).mockResolvedValueOnce(undefined);

    const write = atomicWriteFile("C:/state/dream_graph.json", "{}", "utf-8");
    await vi.advanceTimersByTimeAsync(25);
    await write;

    const temporary = openMock.mock.calls[0][0];
    expect(temporary).toMatch(/^C:\/state\/dream_graph\.json\.[\da-f-]+\.tmp$/);
    expect(openMock).toHaveBeenCalledWith(temporary, "wx");
    expect(fd.writeFile).toHaveBeenCalledWith("{}", "utf-8");
    expect(fd.datasync).toHaveBeenCalledOnce();
    expect(fd.close).toHaveBeenCalledOnce();
    expect(renameMock).toHaveBeenCalledTimes(2);
    expect(renameMock).toHaveBeenNthCalledWith(
      1,
      temporary,
      "C:/state/dream_graph.json",
    );
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});
