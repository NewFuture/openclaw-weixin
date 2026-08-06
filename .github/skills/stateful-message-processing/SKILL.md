---
name: stateful-message-processing
description: Review, implement, or test openclaw-weixin changes involving persistent or account-scoped state, context or dedupe keys, claims, locks, monitor admission lanes, retries, abort handling, migrations, or resource cleanup.
---

# Stateful message processing

Use this playbook with the repository contracts in `AGENTS.md`. Preserve
account isolation, legacy state, polling progress, the approval lane, abort
behavior, and privacy while changing stateful code.

## Define states and ownership first

Before editing, write down the observable regression and complete this model for
each acquired claim, lock, file, or database handle:

| State or resource | Owner | Success transition | Failure/abort transition | Waiter behavior | Lane effect |
| --- | --- | --- | --- | --- | --- |
| Example: claimed inbound key | Processing delivery | Commit after successful handling | Release on every error or abort | Retry only after release | Unrelated messages still advance |

Keep states with different retry behavior distinct. In particular, do not reduce
`claimed`, `inflight`, `committed`, `released`, and `aborted` to a duplicate
boolean.

Ownership starts when the resource is acquired. Put the first subsequent
operation that can throw inside the complete commit/release or close/finally
boundary, including logging, status updates, config lookup, payload inspection,
and preprocessing.

## Design collision-safe identity

- Prefer stable transport message IDs, then canonical item-level IDs.
- Use a canonical digest only when all inputs are message-specific and stable.
- Include account scope in persistent namespaces; never introduce a global
  fallback.
- Prove two distinct valid messages or accounts remain distinct.
- If no collision-safe message identity exists, skip dedupe instead of using a
  sender-only or empty-body key.
- Treat full keys and fingerprints as sensitive when they embed account, sender,
  message, token, body, or CDN data. Log only a non-sensitive identity kind and
  outcome.

## Preserve progress and retry

Test outcomes rather than prescribing one implementation:

- An accepted ordinary turn must not stop polling or block a later unrelated
  message.
- Plugin approval work must retain its independent lane.
- An inflight replay must not hold an admission lane while its owner runs.
- Owner commit drops the replay exactly once.
- Owner release or failure leaves one delivery able to retry.
- Abort stops the in-flight long poll and does not strand owned state.

If a fix for one outcome changes scheduling, rerun the complete state matrix.
Do not patch review findings one transition at a time.

## Use deterministic harnesses

- Reuse `createDeferred` from `test/helpers/deferred.ts` to control ownership and
  ordering explicitly.
- Reuse `makeTextMessage` and `createChannelRuntimeHarness` where applicable.
- Prefer fake timers over sleeps.
- Keep tests safe under Vitest's default parallelism.
- Do not call the live backend, perform QR login, or use developer state.

Cover every applicable scenario:

| Scenario | Required observation |
| --- | --- |
| Owner commits | A replay is dropped only after commit |
| Owner releases | A waiting or later delivery can retry exactly once |
| Owner still runs, unrelated message arrives | The unrelated message advances before the owner finishes |
| Preprocessing throws after acquisition | Owned state is released |
| Abort occurs | Polling exits and no claim or lock remains stranded |
| Two messages lack outer transport IDs | Item identity keeps them distinct, or dedupe is skipped |
| Two accounts use the same message identity | Persistent state remains account-scoped |

## Test persistence and cleanup

- Isolate both `OPENCLAW_STATE_DIR` and the higher-precedence
  `OPENCLAW_OAUTH_DIR`; clear the latter or point it to its own temporary
  directory.
- Cover write/read, account isolation, case normalization, supported legacy
  formats, and module or process restart.
- Close database, file, and lock handles before deleting temporary directories.
- Restore environment variables, timers, modules, and mocks.
- Do not swallow cleanup failures or turn them into success-shaped fallbacks.

## Completion evidence

- The focused test fails for the original state or ordering reason without the
  fix.
- Every affected state transition and error exit has an observable assertion.
- Logs omit raw identifiers and full keys.
- `npm run check` passes after the focused suites.
