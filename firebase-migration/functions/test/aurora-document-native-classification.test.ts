import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, "../../../src/04_EXTRACAO_DOCUMENTAL_WMGJ.gs"), "utf8");

function context(externalEnabled: boolean): any {
  let externalCalls = 0;
  const sandbox: Record<string, unknown> = {
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name: string) {
            if (name === "AURORA_EXTERNAL_AI_FALLBACK_ENABLED") return externalEnabled ? "true" : "false";
            return null;
          }
        };
      }
    },
    classificarDocumentoGeminiWMGJ_V1() {
      externalCalls++;
      return { categoria: "outro", confianca: 0.9, origem_classificacao: "gemini" };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "04_EXTRACAO_DOCUMENTAL_WMGJ.gs" });
  (sandbox as any).__externalCalls = () => externalCalls;
  return sandbox;
}

test("known financial document is classified natively before external AI", () => {
  const ctx = context(true);
  const result = ctx.classificarDocumentoGeminiOuFallbackWMGJ_V1_({
    texto: "Relatório de faturamento competência 2026-09. Valor R$ 1.234,56."
  }, { getName() { return "faturamento.pdf"; } });
  assert.equal(result.categoria, "financeiro");
  assert.equal(result.origem_classificacao, "aurora_native_rules_v2");
  assert.equal(ctx.__externalCalls(), 0);
});

test("external AI remains disabled by default for unresolved document", () => {
  const ctx = context(false);
  const result = ctx.classificarDocumentoGeminiOuFallbackWMGJ_V1_({
    texto: "conteúdo sintético sem padrão reconhecido"
  }, { getName() { return "arquivo.bin"; } });
  assert.equal(result.categoria, "outro");
  assert.equal(result.origem_classificacao, "aurora_native_rules_v2");
  assert.equal(ctx.__externalCalls(), 0);
});

test("external AI is only a deliberate fallback for unresolved document", () => {
  const ctx = context(true);
  const result = ctx.classificarDocumentoGeminiOuFallbackWMGJ_V1_({
    texto: "conteúdo sintético sem padrão reconhecido"
  }, { getName() { return "arquivo.bin"; } });
  assert.equal(result.origem_classificacao, "gemini");
  assert.equal(ctx.__externalCalls(), 1);
});
