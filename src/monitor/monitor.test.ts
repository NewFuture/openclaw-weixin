import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChannelRuntimeHarness } from "../../test/helpers/channel-runtime.js";
import { createDeferred } from "../../test/helpers/deferred.js";
import { getText, makeTextMessage } from "../../test/helpers/messages.js";
import type { GetUpdatesResp, WeixinMessage } from "../api/types.js";
import type { ProcessMessageDeps } from "../messaging/process-message.js";

const getUpdatesMock =
  vi.fn<
    (opts: { abortSignal?: AbortSignal; get_updates_buf?: string; timeoutMs?: number }) => Promise<GetUpdatesResp>
  >();
const getForUserMock = vi.fn<(userId: string, contextToken?: string) => Promise<{ typingTicket: string }>>();
const getRemainingPauseMsMock = vi.fn<(accountId: string) => number>();
const pauseSessionMock = vi.fn<(accountId: string) => void>();
const processOneMessageMock = vi.fn<(message: WeixinMessage, deps: ProcessMessageDeps) => Promise<void>>();
const saveGetUpdatesBufMock = vi.fn<(filePath: string, value: string) => void>();
const setContextTokenMock = vi.fn<(accountId: string, userId: string, token: string) => void>();
const accountLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../api/api.js", () => ({
  getUpdates: (opts: { abortSignal?: AbortSignal; get_updates_buf?: string; timeoutMs?: number }) =>
    getUpdatesMock(opts),
  classifyFetchError: (err: unknown) => ({
    type: "mock",
    description: String(err),
    code: undefined,
  }),
}));

vi.mock("../api/session-guard.js", () => ({
  getRemainingPauseMs: (accountId: string) => getRemainingPauseMsMock(accountId),
  pauseSession: (accountId: string) => pauseSessionMock(accountId),
  STALE_TOKEN_ERRCODE: -14,
}));

vi.mock("../api/config-cache.js", () => ({
  WeixinConfigManager: class {
    async getForUser(userId: string, contextToken?: string): Promise<{ typingTicket: string }> {
      return getForUserMock(userId, contextToken);
    }
  },
}));

vi.mock("../messaging/process-message.js", () => ({
  processOneMessage: (message: WeixinMessage, deps: ProcessMessageDeps) => processOneMessageMock(message, deps),
}));

vi.mock("../messaging/inbound.js", () => ({
  setContextToken: (accountId: string, userId: string, token: string) => setContextTokenMock(accountId, userId, token),
}));

vi.mock("../storage/sync-buf.js", () => ({
  getSyncBufFilePath: () => "sync-buf",
  loadGetUpdatesBuf: () => undefined,
  saveGetUpdatesBuf: (filePath: string, value: string) => saveGetUpdatesBufMock(filePath, value),
}));

vi.mock("../util/logger.js", () => ({
  logger: {
    withAccount: () => accountLogger,
  },
}));

import { resetWeixinInboundDedupeForTests } from "../messaging/inbound-dedupe.js";
import { monitorWeixinProvider } from "./monitor.js";

describe("monitorWeixinProvider", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetWeixinInboundDedupeForTests({ persistent: false });
    getForUserMock.mockResolvedValue({ typingTicket: "ticket" });
    getRemainingPauseMsMock.mockReturnValue(60 * 60 * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetWeixinInboundDedupeForTests({ persistent: false });
  });

  it("orders ordinary admission while approvals bypass an active ordinary turn", async () => {
    const abortController = new AbortController();
    const firstPreprocessing = createDeferred();
    const firstRun = createDeferred();
    const approvalStarted = createDeferred();
    const secondStarted = createDeferred();
    const started: string[] = [];
    const responses: GetUpdatesResp[] = [
      {
        ret: 0,
        msgs: [makeMonitorMessage("first", { message_id: 101, context_token: "token-1" })],
        get_updates_buf: "cursor-1",
      },
      {
        ret: 0,
        msgs: [
          makeMonitorMessage("second", { message_id: 102, context_token: "token-2" }),
          makeMonitorMessage("third", { message_id: 104, context_token: "token-4" }),
          makeMonitorMessage("/approve plugin:test approve", {
            message_id: 103,
            context_token: "token-3",
          }),
        ],
        get_updates_buf: "cursor-2",
      },
    ];

    getUpdatesMock.mockImplementation(async ({ abortSignal }) => {
      const next = responses.shift();
      if (next) return next;
      return await new Promise<GetUpdatesResp>((_, reject) => {
        if (abortSignal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    processOneMessageMock.mockImplementation(async (message, deps) => {
      const text = getText(message);
      started.push(text);
      if (text === "first") {
        await firstPreprocessing.promise;
        deps.onReplyAdmitted?.();
        await firstRun.promise;
        return;
      }
      if (text.startsWith("/approve plugin:")) {
        approvalStarted.resolve();
        return;
      }
      if (text === "second") {
        secondStarted.resolve();
        abortController.abort();
      }
    });

    const harness = createChannelRuntimeHarness();
    const runtimeLog = vi.fn();
    const monitor = monitorWeixinProvider({
      baseUrl: "https://example.test?token=secret-monitor",
      cdnBaseUrl: "https://cdn.example.test",
      accountId: "acc-monitor",
      config: {},
      channelRuntime: harness.channelRuntime,
      abortSignal: abortController.signal,
      runtime: { log: runtimeLog, error: vi.fn() },
    });

    try {
      await approvalStarted.promise;
      expect(started).toEqual(["first", "/approve plugin:test approve"]);
      firstPreprocessing.resolve();
      await secondStarted.promise;
      await monitor;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(started).toEqual(["first", "/approve plugin:test approve", "second"]);
      expect(saveGetUpdatesBufMock).toHaveBeenLastCalledWith("sync-buf", "cursor-2");
      expect(setContextTokenMock.mock.calls).toEqual([
        ["acc-monitor", "user-a", "token-1"],
        ["acc-monitor", "user-a", "token-2"],
        ["acc-monitor", "user-a", "token-4"],
        ["acc-monitor", "user-a", "token-3"],
      ]);
      const logs = [
        ...runtimeLog.mock.calls,
        ...accountLogger.info.mock.calls,
        ...accountLogger.debug.mock.calls,
        ...accountLogger.warn.mock.calls,
        ...accountLogger.error.mock.calls,
      ]
        .flat()
        .join(" ");
      for (const sensitive of ["secret-monitor", "acc-monitor", "user-a", "sync-buf"]) {
        expect(logs).not.toContain(sensitive);
      }
    } finally {
      firstPreprocessing.resolve();
      firstRun.resolve();
      await monitor;
    }
  });

  it("returns when an in-flight poll is aborted", async () => {
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    getUpdatesMock.mockImplementation(
      async ({ abortSignal }) =>
        await new Promise<GetUpdatesResp>((_, reject) => {
          if (abortSignal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );

    const monitor = monitorWeixinProvider({
      baseUrl: "https://example.test",
      cdnBaseUrl: "https://cdn.example.test",
      accountId: "acc-monitor",
      config: {},
      channelRuntime: harness.channelRuntime,
      abortSignal: abortController.signal,
      runtime: { log: vi.fn(), error: vi.fn() },
    });

    await vi.waitFor(() => expect(getUpdatesMock).toHaveBeenCalledOnce());
    abortController.abort();

    await expect(monitor).resolves.toBeUndefined();
    expect(getUpdatesMock.mock.calls[0]?.[0].abortSignal).toBe(abortController.signal);
  });

  it("aborts immediately during the two-second retry delay", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    getUpdatesMock.mockResolvedValue({ ret: 1, errmsg: "synthetic failure" });

    const monitor = startMonitor(abortController, harness.channelRuntime);
    await vi.advanceTimersByTimeAsync(0);
    expect(getUpdatesMock).toHaveBeenCalledOnce();

    abortController.abort();

    await expect(monitor).resolves.toBeUndefined();
    expect(getUpdatesMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts immediately during the thirty-second failure backoff", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    const errLog = vi.fn();
    getUpdatesMock.mockResolvedValue({ ret: 1, errmsg: "synthetic failure" });

    const monitor = startMonitor(abortController, harness.channelRuntime, errLog);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(getUpdatesMock).toHaveBeenCalledTimes(3);
    expect(errLog).toHaveBeenCalledWith(expect.stringContaining("backing off 30s"));

    abortController.abort();

    await expect(monitor).resolves.toBeUndefined();
    expect(getUpdatesMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts immediately during the stale-token pause", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    getUpdatesMock.mockResolvedValue({ errcode: -14, errmsg: "stale token" });

    const monitor = startMonitor(abortController, harness.channelRuntime);
    await vi.advanceTimersByTimeAsync(0);
    expect(pauseSessionMock).toHaveBeenCalledWith("acc-monitor");
    expect(getRemainingPauseMsMock).toHaveBeenCalledWith("acc-monitor");

    abortController.abort();

    await expect(monitor).resolves.toBeUndefined();
    expect(getUpdatesMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets the consecutive failure count after a successful poll", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    const errLog = vi.fn();
    const responses: GetUpdatesResp[] = [
      { ret: 1, errmsg: "failure one" },
      { ret: 1, errmsg: "failure two" },
      { ret: 0 },
      { ret: 1, errmsg: "failure after success" },
    ];
    getUpdatesMock.mockImplementation(async () => responses.shift() ?? { ret: 1 });

    const monitor = startMonitor(abortController, harness.channelRuntime, errLog);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(getUpdatesMock).toHaveBeenCalledTimes(4);
    const failureLogs = errLog.mock.calls.map(([message]) => message).filter((message) => message.includes("ret="));
    expect(failureLogs).toEqual([
      expect.stringContaining("(1/3)"),
      expect.stringContaining("(2/3)"),
      expect.stringContaining("(1/3)"),
    ]);

    abortController.abort();
    await expect(monitor).resolves.toBeUndefined();
  });

  it("uses the server-provided timeout for the next long poll", async () => {
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    getUpdatesMock.mockResolvedValueOnce({ ret: 0, longpolling_timeout_ms: 12_345 }).mockImplementationOnce(
      async ({ abortSignal }) =>
        await new Promise<GetUpdatesResp>((_, reject) => {
          abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );

    const monitor = startMonitor(abortController, harness.channelRuntime);
    await vi.waitFor(() => expect(getUpdatesMock).toHaveBeenCalledTimes(2));

    expect(getUpdatesMock.mock.calls[1]?.[0].timeoutMs).toBe(12_345);
    abortController.abort();
    await expect(monitor).resolves.toBeUndefined();
  });

  it("drops getUpdates replays on ordinary and approval lanes without reprocessing", async () => {
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    const started: string[] = [];
    getUpdatesMock
      .mockResolvedValueOnce({
        ret: 0,
        msgs: [
          makeMonitorMessage("hello", { message_id: 501 }),
          makeMonitorMessage("hello", { message_id: 501 }),
          makeMonitorMessage("/approve plugin:test approve", { message_id: 502 }),
          makeMonitorMessage("/approve plugin:test approve", { message_id: 502 }),
        ],
      })
      .mockImplementationOnce(
        async ({ abortSignal }) =>
          await new Promise<GetUpdatesResp>((_, reject) => {
            abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      );
    processOneMessageMock.mockImplementation(async (message) => {
      started.push(getText(message));
      if (started.length >= 2) abortController.abort();
    });

    const monitor = startMonitor(abortController, harness.channelRuntime);
    await expect(monitor).resolves.toBeUndefined();
    await vi.waitFor(() => expect(started).toEqual(["hello", "/approve plugin:test approve"]));
    expect(processOneMessageMock).toHaveBeenCalledTimes(2);
  });

  it("does not block the ordinary lane while an in-flight replay waits on the owner", async () => {
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    const firstRun = createDeferred();
    const secondStarted = createDeferred();
    const started: string[] = [];
    getUpdatesMock
      .mockResolvedValueOnce({
        ret: 0,
        msgs: [
          makeMonitorMessage("first", { message_id: 701 }),
          makeMonitorMessage("first-replay", { message_id: 701 }),
          makeMonitorMessage("second", { message_id: 702 }),
        ],
      })
      .mockImplementationOnce(
        async ({ abortSignal }) =>
          await new Promise<GetUpdatesResp>((_, reject) => {
            abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      );
    processOneMessageMock.mockImplementation(async (message, deps) => {
      const text = getText(message);
      started.push(text);
      if (text === "first") {
        deps.onReplyAdmitted?.();
        await firstRun.promise;
        return;
      }
      if (text === "second") {
        secondStarted.resolve();
        abortController.abort();
      }
    });

    const monitor = startMonitor(abortController, harness.channelRuntime);
    await secondStarted.promise;
    expect(started).toEqual(["first", "second"]);
    expect(started).not.toContain("first-replay");
    firstRun.resolve();
    await expect(monitor).resolves.toBeUndefined();
  });

  it("releases a claim when preprocessing fails before processOneMessage", async () => {
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    const errLog = vi.fn();
    const started: string[] = [];
    let configCalls = 0;
    getForUserMock.mockImplementation(async () => {
      configCalls += 1;
      if (configCalls === 1) {
        throw new Error("synthetic config lookup failure");
      }
      return { typingTicket: "ticket" };
    });
    getUpdatesMock
      .mockResolvedValueOnce({
        ret: 0,
        msgs: [makeMonitorMessage("first", { message_id: 801 })],
      })
      .mockResolvedValueOnce({
        ret: 0,
        msgs: [makeMonitorMessage("first-retry", { message_id: 801 })],
      })
      .mockImplementationOnce(
        async ({ abortSignal }) =>
          await new Promise<GetUpdatesResp>((_, reject) => {
            abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      );
    processOneMessageMock.mockImplementation(async (message) => {
      started.push(getText(message));
      abortController.abort();
    });

    const monitor = startMonitor(abortController, harness.channelRuntime, errLog);
    await expect(monitor).resolves.toBeUndefined();
    await vi.waitFor(() => expect(started).toEqual(["first-retry"]));
    expect(errLog).toHaveBeenCalledWith("weixin inbound message failed: Error");
    expect(errLog.mock.calls.flat().join(" ")).not.toContain("synthetic config lookup failure");
    expect(processOneMessageMock).toHaveBeenCalledTimes(1);
  });

  it("releases the ordinary lane when preprocessing fails", async () => {
    const abortController = new AbortController();
    const harness = createChannelRuntimeHarness();
    const errLog = vi.fn();
    const started: string[] = [];
    getUpdatesMock
      .mockResolvedValueOnce({
        ret: 0,
        msgs: [makeMonitorMessage("first"), makeMonitorMessage("second")],
      })
      .mockImplementationOnce(
        async ({ abortSignal }) =>
          await new Promise<GetUpdatesResp>((_, reject) => {
            abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      );
    processOneMessageMock.mockImplementation(async (message) => {
      const text = getText(message);
      started.push(text);
      if (text === "first") throw new Error("synthetic preprocessing failure");
      abortController.abort();
    });

    const monitor = startMonitor(abortController, harness.channelRuntime, errLog);
    await expect(monitor).resolves.toBeUndefined();
    await vi.waitFor(() => expect(started).toEqual(["first", "second"]));

    expect(errLog).toHaveBeenCalledWith("weixin inbound message failed: Error");
    expect(errLog.mock.calls.flat().join(" ")).not.toContain("synthetic preprocessing failure");
  });
});

function startMonitor(
  abortController: AbortController,
  channelRuntime: ReturnType<typeof createChannelRuntimeHarness>["channelRuntime"],
  error = vi.fn(),
): Promise<void> {
  return monitorWeixinProvider({
    baseUrl: "https://example.test",
    cdnBaseUrl: "https://cdn.example.test",
    accountId: "acc-monitor",
    config: {},
    channelRuntime,
    abortSignal: abortController.signal,
    runtime: { log: vi.fn(), error },
  });
}

function makeMonitorMessage(text: string, overrides: Partial<WeixinMessage> = {}): WeixinMessage {
  return makeTextMessage(text, {
    from_user_id: "user-a",
    ...overrides,
  });
}
