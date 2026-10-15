import { describe, expect, it, vi } from "vitest";

import {
  commandOwnerAllowFromForHost,
  droppedFromLegacyOutcome,
  isMissingSdkSubpath,
  resolveWeixinSenderAccess,
  senderAccessFromIngress,
} from "./sender-access.js";

describe("sender access host boundary", () => {
  it("drops only the legacy disabled and unauthorized outcomes", () => {
    expect(droppedFromLegacyOutcome("disabled")).toBe(true);
    expect(droppedFromLegacyOutcome("unauthorized")).toBe(true);
    expect(droppedFromLegacyOutcome("allowed")).toBe(false);
  });

  it("drops non-allow ingress decisions without treating an allowed sender as unauthorized", () => {
    const allowed = senderAccessFromIngress({
      ingress: { decision: "allow" },
      commandAccess: { authorized: false },
    } as never);
    expect(allowed).toEqual({ dropped: false, commandAuthorized: false });
    expect(
      senderAccessFromIngress({
        ingress: { decision: "allow" },
        commandAccess: { authorized: true },
      } as never),
    ).toEqual({ dropped: false, commandAuthorized: true });
    expect(
      senderAccessFromIngress({
        ingress: { decision: "block" },
        commandAccess: { authorized: true },
      } as never).dropped,
    ).toBe(true);
    expect(
      senderAccessFromIngress({
        ingress: { decision: "pairing" },
        commandAccess: { authorized: false },
      } as never).dropped,
    ).toBe(true);
  });

  it("recognizes a removed SDK subpath without treating other import failures as compatible", () => {
    expect(isMissingSdkSubpath(Object.assign(new Error("missing"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }))).toBe(
      true,
    );
    expect(isMissingSdkSubpath(Object.assign(new Error("missing"), { code: "ERR_MODULE_NOT_FOUND" }))).toBe(true);
    expect(isMissingSdkSubpath(Object.assign(new Error("broken"), { code: "ERR_INVALID_ARG_TYPE" }))).toBe(false);
    expect(isMissingSdkSubpath(new Error("broken"))).toBe(false);
    expect(isMissingSdkSubpath("missing")).toBe(false);
  });

  it("keeps the legacy command-auth result and does not call ingress", async () => {
    const resolveIngress = vi.fn();
    const resolveSenderCommandAuthorizationWithRuntime = vi.fn(async () => ({
      senderAllowedForCommands: true,
      commandAuthorized: true,
    }));
    const resolveDirectDmAuthorizationOutcome = vi.fn(() => "allowed" as const);

    await expect(
      resolveWeixinSenderAccess(
        {
          accountId: "account-test",
          senderId: "user-test",
          rawBody: "hello",
          config: {},
          commands: {
            shouldComputeCommandAuthorized: () => true,
          },
        },
        {
          loadLegacy: async () => ({
            resolveDirectDmAuthorizationOutcome,
            resolveSenderCommandAuthorizationWithRuntime,
          }),
          resolveIngress,
        },
      ),
    ).resolves.toEqual({ dropped: false, commandAuthorized: true });
    expect(resolveIngress).not.toHaveBeenCalled();
  });

  it("drops a legacy unauthorized sender instead of treating every legacy result as allowed", async () => {
    const access = await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-test",
        rawBody: "hello",
        config: {},
        commands: { shouldComputeCommandAuthorized: () => false },
      },
      {
        loadLegacy: async () => ({
          resolveDirectDmAuthorizationOutcome: () => "unauthorized",
          resolveSenderCommandAuthorizationWithRuntime: async () => ({ senderAllowedForCommands: false }),
        }),
        resolveIngress: vi.fn(),
      },
    );

    expect(access).toEqual({ dropped: true, commandAuthorized: false });
  });

  it("uses ingress when the legacy subpath is gone and still admits an allowed sender", async () => {
    const resolveIngress = vi.fn(async () => ({
      ingress: { decision: "allow" },
      commandAccess: { authorized: true },
    }));

    await expect(
      resolveWeixinSenderAccess(
        {
          accountId: "account-test",
          senderId: "user-allowed",
          rawBody: "/help",
          config: {},
          readAllowFromStore: async () => ["user-allowed"],
        },
        { loadLegacy: async () => null, resolveIngress: resolveIngress as never },
      ),
    ).resolves.toEqual({ dropped: false, commandAuthorized: true });
    expect(resolveIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "openclaw-weixin",
        accountId: "account-test",
        subject: { stableId: "user-allowed" },
        allowFrom: [],
        command: { allowTextCommands: true, hasControlCommand: true },
      }),
    );
  });

  it("uses host command detection for inline commands and abort triggers, not only a leading slash", async () => {
    const resolveIngress = vi.fn(async () => ({
      ingress: { decision: "allow" },
      commandAccess: { authorized: true },
    }));
    const detection = {
      shouldComputeCommandAuthorized: (text: string) => text !== "hello",
      isControlCommandMessage: (text: string) => text === "stop",
    };

    await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-allowed",
        rawBody: "hello /status",
        config: {},
        readAllowFromStore: async () => ["user-allowed"],
      },
      {
        loadLegacy: async () => null,
        loadCommandDetection: async () => detection,
        resolveIngress: resolveIngress as never,
      },
    );
    await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-allowed",
        rawBody: "stop",
        config: {},
        readAllowFromStore: async () => ["user-allowed"],
      },
      {
        loadLegacy: async () => null,
        loadCommandDetection: async () => detection,
        resolveIngress: resolveIngress as never,
      },
    );
    await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-allowed",
        rawBody: "hello",
        config: {},
        readAllowFromStore: async () => ["user-allowed"],
      },
      {
        loadLegacy: async () => null,
        loadCommandDetection: async () => detection,
        resolveIngress: resolveIngress as never,
      },
    );

    expect(resolveIngress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: { allowTextCommands: true, hasControlCommand: false },
      }),
    );
    expect(resolveIngress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: { allowTextCommands: true, hasControlCommand: true },
      }),
    );
    expect(resolveIngress.mock.calls[2]?.[0]).not.toHaveProperty("command");
  });

  it("admits an empty pairing store and still rejects an unlisted sender when the store is populated", async () => {
    const resolveIngress = vi.fn(async () => ({
      ingress: { decision: "allow" },
      commandAccess: { authorized: false },
    }));
    const detection = {
      shouldComputeCommandAuthorized: () => false,
      isControlCommandMessage: () => false,
    };

    await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-token-only",
        rawBody: "hello",
        config: {},
        readAllowFromStore: async () => [],
      },
      {
        loadLegacy: async () => null,
        loadCommandDetection: async () => detection,
        resolveIngress: resolveIngress as never,
      },
    );
    await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-blocked",
        rawBody: "hello",
        config: {},
        readAllowFromStore: async () => ["user-allowed"],
      },
      {
        loadLegacy: async () => null,
        loadCommandDetection: async () => detection,
        resolveIngress: resolveIngress as never,
      },
    );

    expect(resolveIngress).toHaveBeenNthCalledWith(1, expect.objectContaining({ allowFrom: ["user-token-only"] }));
    expect(resolveIngress).toHaveBeenNthCalledWith(2, expect.objectContaining({ allowFrom: [] }));
  });

  it("passes a restrictive command owner list only for messages the host treats as commands", async () => {
    const resolveIngress = vi.fn(async () => ({
      ingress: { decision: "block" },
      commandAccess: { authorized: false },
    }));
    const detection = {
      shouldComputeCommandAuthorized: (text: string) => text.startsWith("/"),
      isControlCommandMessage: (text: string) => text.startsWith("/"),
    };
    const config = { commands: { ownerAllowFrom: ["user-owner"] } };

    await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-allowed",
        rawBody: "/help",
        config,
        readAllowFromStore: async () => ["user-allowed"],
      },
      {
        loadLegacy: async () => null,
        loadCommandDetection: async () => detection,
        resolveIngress: resolveIngress as never,
      },
    );

    expect(resolveIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          allowTextCommands: true,
          hasControlCommand: true,
          commandOwnerAllowFrom: ["user-owner"],
        },
      }),
    );
    expect(
      commandOwnerAllowFromForHost({
        commands: { allowFrom: { "*": ["user-a"], "openclaw-weixin": ["user-b"] }, ownerAllowFrom: ["user-a"] },
      }),
    ).toEqual([]);
    expect(commandOwnerAllowFromForHost({})).toBeUndefined();
  });

  it("drops an ingress block without calling a missing legacy helper", async () => {
    const access = await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-blocked",
        rawBody: "hello",
        config: {},
        readAllowFromStore: async () => ["user-allowed"],
      },
      {
        loadLegacy: async () => null,
        resolveIngress: (async () => ({
          ingress: { decision: "block" },
          commandAccess: { authorized: false },
        })) as never,
      },
    );

    expect(access.dropped).toBe(true);
  });

  it("rethrows a legacy loader failure that is not a removed subpath", async () => {
    const resolveIngress = vi.fn();
    await expect(
      resolveWeixinSenderAccess(
        {
          accountId: "account-test",
          senderId: "user-test",
          rawBody: "hello",
          config: {},
        },
        {
          loadLegacy: async () => {
            throw Object.assign(new Error("sdk import failed"), { code: "ERR_INVALID_ARG_TYPE" });
          },
          resolveIngress,
        },
      ),
    ).rejects.toThrow("sdk import failed");
    expect(resolveIngress).not.toHaveBeenCalled();
  });

  it("keeps command authorization distinct from direct-message admission on the installed host", async () => {
    const base = {
      accountId: "account-test",
      config: {},
      readAllowFromStore: async () => ["user-allowed"],
    };
    const listed = (rawBody: string) =>
      resolveWeixinSenderAccess({ ...base, senderId: "user-allowed", rawBody }, { loadLegacy: async () => null });
    const unlisted = await resolveWeixinSenderAccess(
      { ...base, senderId: "user-blocked", rawBody: "/help" },
      { loadLegacy: async () => null },
    );
    const emptyStore = await resolveWeixinSenderAccess(
      {
        accountId: "account-test",
        senderId: "user-token-only",
        rawBody: "hello",
        config: {},
        readAllowFromStore: async () => [],
      },
      { loadLegacy: async () => null },
    );
    const restricted = await resolveWeixinSenderAccess(
      {
        ...base,
        senderId: "user-allowed",
        rawBody: "/help",
        config: { commands: { ownerAllowFrom: ["user-owner"] } },
      },
      { loadLegacy: async () => null },
    );

    await expect(listed("hello")).resolves.toEqual({ dropped: false, commandAuthorized: false });
    await expect(listed("/help")).resolves.toEqual({ dropped: false, commandAuthorized: true });
    await expect(listed("hello /status")).resolves.toEqual({ dropped: false, commandAuthorized: true });
    await expect(listed("stop")).resolves.toEqual({ dropped: false, commandAuthorized: true });
    expect(unlisted).toEqual({ dropped: true, commandAuthorized: false });
    expect(emptyStore).toEqual({ dropped: false, commandAuthorized: false });
    expect(restricted).toEqual({ dropped: true, commandAuthorized: false });
  });

  it("fails closed when a legacy host does not provide the command runtime", async () => {
    await expect(
      resolveWeixinSenderAccess(
        {
          accountId: "account-test",
          senderId: "user-test",
          rawBody: "hello",
          config: {},
        },
        {
          loadLegacy: async () => ({
            resolveDirectDmAuthorizationOutcome: () => "allowed",
            resolveSenderCommandAuthorizationWithRuntime: async () => ({ senderAllowedForCommands: true }),
          }),
        },
      ),
    ).rejects.toThrow("host command runtime is missing");
  });
});
