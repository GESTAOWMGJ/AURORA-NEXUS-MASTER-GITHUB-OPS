import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const connectorSource = readFileSync(
  new URL("../../../src/37_AURORA_CONECTORES_PLUG_AND_PLAY.gs", import.meta.url),
  "utf8",
);
const automationSource = readFileSync(
  new URL("../../../src/06_AUTOMACAO_APPSCRIPT_WMGJ.gs", import.meta.url),
  "utf8",
);

const mainHandler = "executarAutomacaoOperacionalWMGJ";

type Trigger = {
  getHandlerFunction: () => string;
  getUniqueId: () => string;
};

function mockTrigger(id: string, handler = mainHandler): Trigger {
  return {
    getHandlerFunction: () => handler,
    getUniqueId: () => id,
  };
}

function fixture(options: {
  existingPrincipal?: boolean;
  falsyInstallerConfirmation?: boolean;
  installerStatusError?: Error;
  liveCommitError?: Error;
}) {
  const unrelated = mockTrigger("unrelated-before", "unrelatedJob");
  const triggers: Trigger[] = [unrelated];
  if (options.existingPrincipal) triggers.push(mockTrigger("principal-before"));
  const deleted: string[] = [];
  const properties: Record<string, string> = {};
  let createdCount = 0;
  let propertyWrites = 0;
  let releases = 0;

  const scriptProperties = {
    getProperty: (key: string) => properties[key] ?? null,
    setProperties: (values: Record<string, string>) => {
      propertyWrites += 1;
      Object.assign(properties, values);
      if (propertyWrites === 2 && options.liveCommitError) throw options.liveCommitError;
    },
  };

  const context: Record<string, unknown> = {
    console,
    DriveApp: {
      getFolderById: () => ({ getName: () => "WMGJ" }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => { releases += 1; },
      }),
    },
    Logger: { log: () => undefined },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    ScriptApp: {
      deleteTrigger: (trigger: Trigger) => {
        deleted.push(trigger.getUniqueId());
        const index = triggers.indexOf(trigger);
        if (index >= 0) triggers.splice(index, 1);
      },
      getProjectTriggers: () => [...triggers],
      newTrigger: (handler: string) => ({
        timeBased: () => ({
          everyMinutes: (minutes: number) => ({
            create: () => {
              assert.equal(minutes, 15);
              const trigger = mockTrigger(`created-${++createdCount}`, handler);
              triggers.push(trigger);
              return trigger;
            },
          }),
        }),
      }),
    },
    SpreadsheetApp: { openById: () => ({ getId: () => "sheet" }) },
    WMGJ_FUNCAO_AUTOMACAO_PRINCIPAL: mainHandler,
  };

  vm.createContext(context);
  vm.runInContext(automationSource, context, { filename: "06_AUTOMACAO_APPSCRIPT_WMGJ.gs" });
  context.auditarOrganizarAppsScriptWMGJ = () => ({ ok: true });
  context.registrarStatusAutomacaoWMGJ_ = () => {
    if (options.installerStatusError) throw options.installerStatusError;
  };
  context.registrarLogAutomacaoWMGJ_ = () => undefined;
  if (options.falsyInstallerConfirmation) {
    context.instalarGatilhoAutomacaoWMGJ = () => {
      triggers.push(mockTrigger(`created-${++createdCount}`));
      return null;
    };
  }
  vm.runInContext(connectorSource, context, { filename: "37_AURORA_CONECTORES_PLUG_AND_PLAY.gs" });

  return {
    activate: () => vm.runInContext(`auroraConfigurarConectoresPlugAndPlay({
      orgId: "wmgj",
      driveFolderId: "drive-folder-123",
      firestoreIngestUrl: "https://ingest.example.test",
      firestoreHmacKeyId: "key-v1",
      firestoreHmacSecret: "${"a".repeat(64)}",
      activate: true
    })`, context),
    deleted,
    properties,
    releases: () => releases,
    triggerIds: () => triggers.map((trigger) => trigger.getUniqueId()),
    propertyWrites: () => propertyWrites,
  };
}

test("activation removes a trigger created before the installer throws", () => {
  const f = fixture({ installerStatusError: new Error("INSTALLER_FAILED_AFTER_CREATE") });

  assert.throws(f.activate, /INSTALLER_FAILED_AFTER_CREATE/);
  assert.deepEqual(f.deleted, ["created-1"]);
  assert.deepEqual(f.triggerIds(), ["unrelated-before"]);
  assert.equal(f.properties.WMGJ_FIRESTORE_DRY_RUN, "true");
  assert.equal(f.properties.AURORA_FIRESTORE_MIRROR_REQUIRED, "false");
  assert.equal(f.propertyWrites(), 2);
  assert.equal(f.releases(), 1);
});

test("activation restores safe properties and removes its trigger when the live commit fails", () => {
  const f = fixture({ liveCommitError: new Error("LIVE_COMMIT_FAILED") });

  assert.throws(f.activate, /LIVE_COMMIT_FAILED/);
  assert.deepEqual(f.deleted, ["created-1"]);
  assert.deepEqual(f.triggerIds(), ["unrelated-before"]);
  assert.equal(f.properties.WMGJ_FIRESTORE_DRY_RUN, "true");
  assert.equal(f.properties.AURORA_FIRESTORE_MIRROR_REQUIRED, "false");
  assert.equal(f.propertyWrites(), 3);
  assert.equal(f.releases(), 1);
});

test("activation reuses and preserves an existing principal when the live commit fails", () => {
  const f = fixture({ existingPrincipal: true, liveCommitError: new Error("LIVE_COMMIT_FAILED") });

  assert.throws(f.activate, /LIVE_COMMIT_FAILED/);
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.triggerIds(), ["unrelated-before", "principal-before"]);
  assert.equal(f.properties.WMGJ_FIRESTORE_DRY_RUN, "true");
  assert.equal(f.properties.AURORA_FIRESTORE_MIRROR_REQUIRED, "false");
  assert.equal(f.propertyWrites(), 3);
  assert.equal(f.releases(), 1);
});

test("activation removes an unconfirmed trigger and remains fail-closed", () => {
  const f = fixture({ falsyInstallerConfirmation: true });

  assert.throws(f.activate, /AURORA_AUTOMATION_TRIGGER_NOT_CONFIRMED/);
  assert.deepEqual(f.deleted, ["created-1"]);
  assert.deepEqual(f.triggerIds(), ["unrelated-before"]);
  assert.equal(f.properties.WMGJ_FIRESTORE_DRY_RUN, "true");
  assert.equal(f.properties.AURORA_FIRESTORE_MIRROR_REQUIRED, "false");
  assert.equal(f.propertyWrites(), 2);
  assert.equal(f.releases(), 1);
});
