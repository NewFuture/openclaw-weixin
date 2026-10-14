import { describe, expect, it, vi } from "vitest";

import {
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
        command: { allowTextCommands: true, hasControlCommand: true },
      }),
    );
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
