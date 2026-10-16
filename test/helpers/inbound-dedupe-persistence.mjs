import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const sourceRoot = new URL("../../src/", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith(".") && specifier.endsWith(".js")) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { getUpdates } = await import("../../src/api/api.ts");
const {
  buildWeixinInboundDedupeKey,
  commitWeixinInboundMessage,
  releaseWeixinInboundMessage,
  tryClaimWeixinInboundMessage,
} = await import("../../src/messaging/inbound-dedupe.ts");

const options = { namespace: "account-test" };
const stage = process.argv[2];
if (stage === "legacy") {
  const key = buildWeixinInboundDedupeKey("account-test", { from_user_id: "user-test", message_id: 42 });
  assert.equal(key, "weixin:v1:account-test:user-test:mid:42");
  assert.deepEqual(await tryClaimWeixinInboundMessage(key, options), { kind: "claimed" });
  await commitWeixinInboundMessage(key, options);
} else {
  assert.ok(stage === "current" || stage === "replay");
  globalThis.fetch = async () =>
    new Response(`{"msgs":[
      {"from_user_id":"user-test","message_id":42},
      {"from_user_id":"user-test","message_id":9007199254740992},
      {"from_user_id":"user-test","message_id":9007199254740993}
    ]}`);
  const { msgs } = await getUpdates({ baseUrl: "https://api.example.test" });
  const keys = msgs.map((msg) => buildWeixinInboundDedupeKey("account-test", msg));
  assert.deepEqual(keys, [
    "weixin:v1:account-test:user-test:mid:42",
    "weixin:v1:account-test:user-test:mid:9007199254740992",
    "weixin:v1:account-test:user-test:mid:9007199254740993",
  ]);
  assert.deepEqual(await tryClaimWeixinInboundMessage(keys[0], options), { kind: "duplicate" });
  for (const key of keys.slice(1)) {
    assert.deepEqual(await tryClaimWeixinInboundMessage(key, options), {
      kind: stage === "current" ? "claimed" : "duplicate",
    });
    if (stage === "current") await commitWeixinInboundMessage(key, options);
    const otherOptions = { namespace: "account-other" };
    assert.deepEqual(await tryClaimWeixinInboundMessage(key, otherOptions), { kind: "claimed" });
    releaseWeixinInboundMessage(key, otherOptions);
  }
}
