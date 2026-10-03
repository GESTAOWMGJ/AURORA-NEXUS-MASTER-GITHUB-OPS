import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepoFile = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("AURORA-MO-001 preserves the WMGJ master operating cycle", () => {
  const doc = readRepoFile("docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md");
  assert.match(doc, /AURORA-MO-001/);
  assert.match(doc, /OBSERVAR[\s\S]*INGESTAR[\s\S]*COMPROVAR[\s\S]*CONFRONTAR[\s\S]*DETECTAR[\s\S]*PRIORIZAR[\s\S]*AGIR[\s\S]*VALIDAR[\s\S]*MEDIR[\s\S]*APRENDER[\s\S]*REUTILIZAR/);
  assert.match(doc, /Produção[\s\S]*faturamento[\s\S]*recebimento[\s\S]*repasses[\s\S]*tributos[\s\S]*custos[\s\S]*margem/);
  assert.match(doc, /Pendência nunca fica passiva/);
  assert.match(doc, /RESTORE VERIFIED[\s\S]*INGEST AUTHENTICATED[\s\S]*REAL SAMPLE[\s\S]*RECONCILED[\s\S]*NATIVE INSIGHT VERIFIED/);
});

test("continuous-dev and repository agents are bound to AURORA-MO-001", () => {
  const skill = readRepoFile("skills/aurora-nexus-continuous-dev/SKILL.md");
  const agents = readRepoFile("AGENTS.md");
  for (const text of [skill, agents]) {
    assert.match(text, /AURORA_MO_001_WMGJ_MODUS_OPERANDI\.md/);
    assert.match(text, /AURORA-MO-001/);
  }
});

test("AURORA-MO-001 preserves WMGJ automation inventory and product separation", () => {
  const doc = readRepoFile("docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md");
  assert.match(doc, /00_CORE_WMGJ\.gs/);
  assert.match(doc, /07_ORQUESTRADOR_FINANCEIRO_WMGJ\.gs/);
  assert.match(doc, /11_ORQUESTRADOR_GMAIL_FISCAL_FINANCEIRO_WMGJ\.gs/);
  assert.match(doc, /14_ORGANIZADOR_DRIVE_OPERACIONAL_WMGJ\.gs/);
  assert.match(doc, /deploy-appscript\.yml/);
  assert.match(doc, /deploy-aurora-firebase\.yml/);
  assert.match(doc, /aurora-rc11-recovery-real-ingest\.yml/);
  assert.match(doc, /tenant-piloto/);
  assert.match(doc, /não é dependência estrutural/);
});


test("AURORA-MO-001 preserves the weekly technical audit gate", () => {
  const doc = readRepoFile("docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md");
  const skill = readRepoFile("skills/aurora-nexus-continuous-dev/SKILL.md");
  for (const text of [doc, skill]) {
    assert.match(text, /auditoria técnica semanal/i);
    assert.match(text, /7 dias/);
    assert.match(text, /segurança\/integridade/);
    assert.match(text, /falha de algoritmo/);
    assert.match(text, /custo\/eficiência/);
    assert.match(text, /no máximo 3 prioridades/i);
    assert.match(text, /main/);
    assert.match(text, /SHA final/i);
    assert.match(text, /sem merge ou deploy automático/i);
  }
});


test("AURORA-MO-001 native routine registry is mandatory and tenant-safe", () => {
  const doc = readRepoFile("docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md");
  const skill = readRepoFile("skills/aurora-nexus-continuous-dev/SKILL.md");
  const registry = readRepoFile("firebase-migration/functions/src/auroraNativeRoutines.ts");
  for (const text of [doc, skill]) {
    assert.match(text, /auroraNativeRoutines\.ts/);
    assert.match(text, /LEGACY_MIRRORED/);
    assert.match(text, /tenant/i);
  }
  assert.match(registry, /AURORA-FIN-SOC-001/);
  assert.match(registry, /AURORA-REV-SAN-001/);
  assert.match(registry, /AURORA-TECH-AUDIT-WEEKLY/);
  assert.match(registry, /tenantRawDataTransfer:\s*false/);
});

test("AURORA-MO-001 defines the simplified monthly closing and manager decision guardrails", () => {
  const doc = readRepoFile("docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md");
  assert.match(doc, /contas vencidas/i);
  assert.match(doc, /contas a vencer/i);
  assert.match(doc, /receita esperada/i);
  assert.match(doc, /saldo em conta/i);
  assert.match(doc, /APPROVED_FOR_DISTRIBUTION/);
  assert.match(doc, /MFA/);
  assert.match(doc, /não executa PIX/i);
});
