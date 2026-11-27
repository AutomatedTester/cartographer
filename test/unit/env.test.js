import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { envSetting } from "../../build/env.js";

describe("envSetting", () => {
  it("reads the CARTOGRAPHER_ name", () => {
    assert.equal(envSetting("CARTOGRAPHER_HEADED", { CARTOGRAPHER_HEADED: "1" }), "1");
  });

  it("falls back to the old WEBMCP_ name", () => {
    assert.equal(envSetting("CARTOGRAPHER_HEADED", { WEBMCP_HEADED: "1" }), "1");
  });

  it("prefers the new name when both are set", () => {
    assert.equal(envSetting("CARTOGRAPHER_HEADED", { CARTOGRAPHER_HEADED: "0", WEBMCP_HEADED: "1" }), "0");
  });

  it("returns undefined when neither is set", () => {
    assert.equal(envSetting("CARTOGRAPHER_HEADED", {}), undefined);
  });

  it("has no fallback for names outside the prefix", () => {
    assert.equal(envSetting("HF_TOKEN", { WEBMCP_HF_TOKEN: "x" }), undefined);
  });
});
