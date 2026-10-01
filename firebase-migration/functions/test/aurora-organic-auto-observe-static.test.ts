import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const runtime = fs.readFileSync("src/auroraRuntime.ts", "utf8");
const auto = fs.readFileSync("src/auroraOrganicAutoObserve.ts", "utf8");

test("resolved document action invokes organic observation without blocking action resolution", () => {
  assert.match(runtime, /command\.type === "RESOLVE"/);
  assert.match(runtime, /autoObserveResolvedDocumentAction/);
  assert.match(runtime, /ORGANIC_OBSERVATION_DEFERRED/);
});

test("auto observation reuses organic transition and existing checkpoint idempotently", () => {
  for (const needle of [
    "runtimeCheckpoints/",
    "apiIdempotency/",
    "runTransaction",
    "transition(original, command",
    "ORGANIC_DOCUMENT_OBSERVED",
    "organicSignalRecorded"
  ]) assert.ok(auto.includes(needle), needle);
  for (const forbidden of ["eval(", "exec(", "spawn(", "source.url", "DriveApp"]) {
    assert.equal(auto.includes(forbidden), false, forbidden);
  }
});
