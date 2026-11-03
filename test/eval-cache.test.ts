import { test } from "node:test";
import assert from "node:assert/strict";
import { markUntrackedIllegal } from "@/lib/evalCache";

const run = (over: Partial<Parameters<typeof markUntrackedIllegal>[0][number]>) => ({
  strategy: "naive",
  illegalRecoveredPaise: 0,
  illegalTracked: false,
  illegalRetries: 0,
  dndViolations: 0,
  ignoredOptOuts: 0,
  outageContacts: 0,
  ...over,
});

test("a measured zero on a tracked run is kept", () => {
  const [r] = markUntrackedIllegal([run({ illegalTracked: true, dndViolations: 4 })]);
  assert.equal(r.illegalRecoveredPaise, 0);
});

test("an untracked run with violations is unknown, not zero", () => {
  const [r] = markUntrackedIllegal([run({ illegalRetries: 3 })]);
  assert.equal(r.illegalRecoveredPaise, null);
});

test("an untracked run without violations stays zero", () => {
  const [r] = markUntrackedIllegal([run({})]);
  assert.equal(r.illegalRecoveredPaise, 0);
});

test("triage rows are never touched", () => {
  const [r] = markUntrackedIllegal([run({ strategy: "triage", dndViolations: 2 })]);
  assert.equal(r.illegalRecoveredPaise, 0);
});
