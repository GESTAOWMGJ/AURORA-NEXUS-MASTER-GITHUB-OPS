import { describe, expect, it } from "vitest";
import { readinessGates, traceabilityControls } from "../src/demo-data";

describe("clinical-readiness demonstrative model", () => {
  it("keeps every gate explicit and ordered", () => {
    expect(readinessGates.map((gate) => gate.id)).toEqual(["G0", "G1", "G2", "G3", "G4"]);
  });

  it("does not claim every gate is completed", () => {
    expect(readinessGates.some((gate) => gate.state === "PENDENTE_DE_APROVACAO")).toBe(true);
    expect(readinessGates.filter((gate) => gate.state === "CONCLUIDO_E_VERIFICADO")).toHaveLength(1);
  });

  it("maintains complete traceability fields", () => {
    for (const control of traceabilityControls) {
      expect(Object.values(control).every((value) => String(value).trim().length > 0)).toBe(true);
    }
  });
});
