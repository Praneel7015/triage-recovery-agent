## Summary

<!-- What changed and why. Link the roadmap item (docs/ROADMAP.md) if there is one. -->

## Checklist

- [ ] `npm run lint`, `npx tsc --noEmit` and `npm test` pass
- [ ] `npm run compliance` still holds 15/15. No property was loosened to make it pass.
- [ ] Actions are still selected only in `src/engine/policy.ts` and vetoed only in `src/engine/stops.ts`
- [ ] The LLM still never selects an action or moves money
- [ ] If eval numbers changed: re-ran `npm run eval`, committed `data/last-eval.json`, and noted the new figures below
- [ ] Money path changes only trust Razorpay-signed data. Razorpay **test mode** only, and no keys in code, logs or fixtures.

## Eval / compliance impact

<!-- "None", or before → after for lift, touches, violations. -->
