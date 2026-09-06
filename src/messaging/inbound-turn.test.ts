import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChannelRuntimeHarness } from "../../test/helpers/channel-runtime.js";
import { SYNTHETIC_ACCOUNT_ID, SYNTHETIC_USER_ID } from "../../test/helpers/messages.js";
import { dispatchWeixinInboundTurn, type WeixinInboundTurn } from "./inbound-turn.js";

const hooks = vi.hoisted(() => ({
  sending: vi.fn(),
  sent: vi.fn(),
  info: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/plugin-runtime", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: () => true,
    runMessageSending: hooks.sending,
    runMessageSent: hooks.sent,
  }),
}));
vi.mock("../util/logger.js", () => ({
  logger: { info: hooks.info },
}));

function makeTurn(mode: "legacy" | "routed" = "legacy") {
  const harness = createChannelRuntimeHarness(mode);
  const { route } = harness;
  const ctxPayload = harness.channelRuntime.inbound.buildContext({
    channel: "openclaw-weixin",
    accountId: SYNTHETIC_ACCOUNT_ID,
    from: SYNTHETIC_USER_ID,
    sender: { id: SYNTHETIC_USER_ID },
    conversation: { kind: "direct", id: SYNTHETIC_USER_ID },
    route: { agentId: route.agentId, routeSessionKey: route.sessionKey },
    reply: { to: SYNTHETIC_USER_ID },
    message: { rawBody: "synthetic inbound" },
    access: { commands: { authorized: true } },
  });
  const deliver = vi.fn<WeixinInboundTurn["delivery"]["deliver"]>(async () => ({
    messageIds: ["message-test"],
    visibleReplySent: true,
  }));
  const params: WeixinInboundTurn = {
    channelRuntime: harness.channelRuntime,
    cfg: {},
    channel: "openclaw-weixin",
    accountId: SYNTHETIC_ACCOUNT_ID,
    route,
    ctxPayload,
    delivery: { deliver },
    record: { createIfMissing: true },
    replyOptions: { runId: "run-test" },
    onReplyAdmitted: vi.fn(),
    onReplyDeferred: vi.fn(),
    onDeferredComplete: vi.fn(),
  };
  return { harness, params, deliver };
}

describe("dispatchWeixinInboundTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.sending.mockImplementation(async ({ content }: { content: string }) => ({ content }));
    hooks.sent.mockResolvedValue(undefined);
  });

  it("delegates modern routing, recording and hook ownership without using legacy dependencies", async () => {
    const { harness, params, deliver } = makeTurn("routed");

    expect(await dispatchWeixinInboundTurn(params)).toBe(harness.turnResult);

    expect(harness.mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        route: params.route,
        ctxPayload: params.ctxPayload,
        record: params.record,
        delivery: expect.objectContaining({ deliver, observeMessageSent: true }),
      }),
    );
    expect(harness.mocks.dispatchReply).not.toHaveBeenCalled();
    expect(harness.mocks.resolveStorePath).not.toHaveBeenCalled();
    expect(harness.mocks.recordInboundSession).not.toHaveBeenCalled();
    expect(hooks.sending).not.toHaveBeenCalled();
    expect(hooks.sent).not.toHaveBeenCalled();
  });

  it("supplies the existing session and buffered-dispatch functions to the public legacy helper", async () => {
    const { harness, params } = makeTurn();

    expect(await dispatchWeixinInboundTurn(params)).toBe(harness.turnResult);

    expect(harness.mocks.resolveStorePath).toHaveBeenCalledWith(undefined, { agentId: params.route.agentId });
    expect(harness.mocks.dispatchReply).toHaveBeenCalledWith(
      expect.objectContaining({
        storePath: "sessions-test.json",
        routeSessionKey: params.route.sessionKey,
        agentId: params.route.agentId,
        record: params.record,
        recordInboundSession: harness.mocks.recordInboundSession,
        dispatchReplyWithBufferedBlockDispatcher: harness.mocks.dispatchReplyWithBufferedBlockDispatcher,
      }),
    );
    expect(harness.mocks.recordInboundSession).not.toHaveBeenCalled();
    expect(harness.mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(harness.mocks.dispatch).not.toHaveBeenCalled();
    const beforeDeliver = harness.mocks.dispatchReply.mock.calls[0]?.[0].dispatcherOptions?.beforeDeliver;
    expect(beforeDeliver).toEqual(expect.any(Function));
    const payload = { text: "original" };
    expect(await beforeDeliver?.(payload, { kind: "final" })).toBe(payload);
    expect(hooks.sending).not.toHaveBeenCalled();
  });

  it("preserves an explicit caller beforeDeliver instead of installing another legacy modifier", async () => {
    const { harness, params } = makeTurn();
    const beforeDeliver = vi.fn<NonNullable<NonNullable<WeixinInboundTurn["dispatcherOptions"]>["beforeDeliver"]>>(
      (payload) => payload,
    );
    params.dispatcherOptions = { beforeDeliver };

    await dispatchWeixinInboundTurn(params);

    expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].dispatcherOptions?.beforeDeliver).toBe(beforeDeliver);
  });

  it("never retries a rejected modern dispatch after an observable delivery", async () => {
    const { harness, params, deliver } = makeTurn("routed");
    const failure = new Error("synthetic dispatch failure");
    harness.mocks.dispatch.mockImplementation(async ({ delivery }) => {
      await delivery.deliver({ text: "block" }, { kind: "block" });
      throw failure;
    });

    await expect(dispatchWeixinInboundTurn(params)).rejects.toBe(failure);

    expect(deliver).toHaveBeenCalledOnce();
    expect(harness.mocks.dispatch).toHaveBeenCalledOnce();
    expect(harness.mocks.dispatchReply).not.toHaveBeenCalled();
    expect(hooks.sent).not.toHaveBeenCalled();
  });

  it.each([
    ["inbound", "dispatch", undefined, "inbound.dispatch is not callable"],
    ["inbound", "dispatch", null, "inbound.dispatch is not callable"],
    ["inbound", "dispatch", true, "inbound.dispatch is not callable"],
    ["runtime", "inbound", undefined, "host inbound runtime is missing"],
    ["inbound", "dispatchReply", undefined, "legacy inbound contract is incomplete"],
    ["session", "resolveStorePath", undefined, "legacy inbound contract is incomplete"],
    ["session", "recordInboundSession", undefined, "legacy inbound contract is incomplete"],
    ["reply", "dispatchReplyWithBufferedBlockDispatcher", undefined, "legacy inbound contract is incomplete"],
  ] as const)("rejects invalid %s.%s=%s without dispatching", async (section, name, value, message) => {
    const { harness, params } = makeTurn();
    const target = section === "runtime" ? harness.channelRuntime : harness.channelRuntime[section];
    Object.defineProperty(target, name, { value });

    await expect(dispatchWeixinInboundTurn(params)).rejects.toThrow(message);
    expect(harness.mocks.dispatch).not.toHaveBeenCalled();
    expect(harness.mocks.dispatchReply).not.toHaveBeenCalled();
    expect(harness.mocks.resolveStorePath).not.toHaveBeenCalled();
  });

  it("rejects an absent legacy reply target without recording a session", async () => {
    const { harness, params } = makeTurn();
    params.ctxPayload = { ...params.ctxPayload, To: undefined };

    await expect(dispatchWeixinInboundTurn(params)).rejects.toThrow("inbound reply target is missing");
    expect(harness.mocks.resolveStorePath).not.toHaveBeenCalled();
  });

  it("keeps run-start forwarding synchronous and reports modern admission only once", async () => {
    const { harness, params } = makeTurn("routed");
    const onAgentRunStart = vi.fn(() => "reply-dispatch");
    params.replyOptions = { onAgentRunStart };

    await dispatchWeixinInboundTurn(params);
    const options = harness.mocks.dispatch.mock.calls[0]?.[0].replyOptions;
    await options?.turnAdoptionLifecycle?.onAdopted();
    expect(options?.onAgentRunStart?.("run-test")).toBe("reply-dispatch");
    options?.turnAdoptionLifecycle?.onDeferred?.();
    options?.turnAdoptionLifecycle?.onSettled?.();

    expect(onAgentRunStart).toHaveBeenCalledWith("run-test");
    expect(params.onReplyAdmitted).toHaveBeenCalledOnce();
    expect(params.onReplyDeferred).toHaveBeenCalledOnce();
    expect(params.onDeferredComplete).toHaveBeenCalledOnce();
  });

  it("modifies a legacy reply once and reports the actual delivered ID and routed session", async () => {
    const { harness, params, deliver } = makeTurn();
    hooks.sending.mockResolvedValue({ content: "modified once" });
    await dispatchWeixinInboundTurn(params);

    const delivery = harness.mocks.dispatchReply.mock.calls[0]?.[0].delivery;
    const result = await delivery?.deliver({ text: "original" }, { kind: "final" });

    expect(result).toMatchObject({ messageIds: ["message-test"] });
    expect(deliver).toHaveBeenCalledWith({ text: "modified once" }, { kind: "final" });
    expect(hooks.sending).toHaveBeenCalledOnce();
    expect(hooks.sent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        content: "modified once",
        messageId: "message-test",
        success: true,
      }),
      expect.objectContaining({ sessionKey: params.route.sessionKey, accountId: SYNTHETIC_ACCOUNT_ID }),
    );
  });

  it("cancels captionless legacy media before transport", async () => {
    const { harness, params, deliver } = makeTurn();
    hooks.sending.mockResolvedValue({ cancel: true, content: "suppressed" });
    await dispatchWeixinInboundTurn(params);

    const result = await harness.mocks.dispatchReply.mock.calls[0]?.[0].delivery.deliver(
      { mediaUrl: "https://media.example.test/image.png" },
      { kind: "final" },
    );

    expect(result).toEqual({ visibleReplySent: false });
    expect(hooks.sending).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "",
        metadata: expect.objectContaining({ mediaUrls: ["https://media.example.test/image.png"] }),
      }),
      expect.anything(),
    );
    expect(deliver).not.toHaveBeenCalled();
    expect(hooks.sent).not.toHaveBeenCalled();
  });

  it("prepares legacy payloads inside provider delivery without replacing the host's payload", async () => {
    const { harness, params, deliver } = makeTurn();
    const preparePayload = vi.fn<NonNullable<WeixinInboundTurn["delivery"]["preparePayload"]>>((payload) => ({
      ...payload,
      text: "prepared once",
    }));
    params.delivery.preparePayload = preparePayload;
    await dispatchWeixinInboundTurn(params);
    const delivery = harness.mocks.dispatchReply.mock.calls[0]?.[0].delivery;
    expect(delivery?.preparePayload).toBeUndefined();
    const original = { text: "original" };

    await delivery?.deliver(original, { kind: "final" });

    expect(original).toEqual({ text: "original" });
    expect(preparePayload).toHaveBeenCalledOnce();
    expect(hooks.sending).toHaveBeenCalledWith(
      expect.objectContaining({ content: "prepared once" }),
      expect.objectContaining({ accountId: SYNTHETIC_ACCOUNT_ID }),
    );
    expect(deliver).toHaveBeenCalledWith({ text: "prepared once" }, { kind: "final" });
  });

  it("suppresses a legacy payload intentionally removed by preparation before running hooks", async () => {
    const { harness, params, deliver } = makeTurn();
    params.delivery.preparePayload = () => null;
    await dispatchWeixinInboundTurn(params);

    const result = await harness.mocks.dispatchReply.mock.calls[0]?.[0].delivery.deliver(
      { text: "removed" },
      { kind: "final" },
    );
    expect(result).toEqual({ visibleReplySent: false });
    expect(hooks.sending).not.toHaveBeenCalled();
    expect(hooks.sent).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
