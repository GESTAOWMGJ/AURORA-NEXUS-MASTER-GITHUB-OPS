export type NativeRoutineState =
  | "NATIVE_ACTIVE"
  | "NATIVE_EVENT"
  | "NATIVE_GOVERNED"
  | "LEGACY_MIRRORED";

export type NativeRoutine = {
  id: string;
  module: string;
  name: string;
  cadence: string;
  trigger: string;
  state: NativeRoutineState;
  tenantScope: "PER_ORG" | "PLATFORM";
  humanGate: boolean;
  sourceMutation: boolean;
};

export const AURORA_NATIVE_ROUTINES: readonly NativeRoutine[] = Object.freeze([
  { id: "AURORA-RUNTIME-WATCHDOG", module: "M08", name: "Watchdog de runtime", cadence: "EVERY_15_MINUTES", trigger: "SCHEDULE", state: "NATIVE_ACTIVE", tenantScope: "PLATFORM", humanGate: false, sourceMutation: false },
  { id: "AURORA-PROJECTION-ENGINE", module: "M07", name: "Projeção financeira/operacional", cadence: "EVERY_15_MINUTES", trigger: "SCHEDULE", state: "NATIVE_ACTIVE", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "AURORA-DOCUMENT-WATCHDOG", module: "M01", name: "Vigilância documental", cadence: "EVERY_15_MINUTES", trigger: "SCHEDULE", state: "NATIVE_ACTIVE", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "AURORA-FIN-SOC-001", module: "M07", name: "Fechamento mensal e relatório aos sócios", cadence: "LAST_BUSINESS_DAY_POLICY", trigger: "MONTHLY_CLOSING_CLOSED", state: "NATIVE_EVENT", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-REV-SAN-001", module: "M03.1", name: "Saneamento global de pontas soltas da receita", cadence: "EVENT_DRIVEN", trigger: "REVENUE_EVIDENCE_CHANGED", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-TECH-AUDIT-WEEKLY", module: "M10", name: "Auditoria técnica semanal", cadence: "WEEKLY_ORG_CONFIG", trigger: "SCHEDULE_OR_MANUAL", state: "NATIVE_GOVERNED", tenantScope: "PLATFORM", humanGate: true, sourceMutation: false },
  { id: "WMGJ-LEGACY-CYCLE-AUTONOMOUS", module: "M08", name: "Perfil legado autônomo Gmail/fiscal/financeiro (alternativo)", cadence: "DAILY_07_15_12_15_18_30_LOCAL", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-CYCLE-SAFE", module: "M08", name: "Perfil legado seguro Gmail/fiscal/financeiro (alternativo)", cadence: "DAILY_08_00_LOCAL", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-CYCLE-PRODUCTION", module: "M08", name: "Perfil legado produção Gmail/fiscal/financeiro (alternativo)", cadence: "DAILY_07_30_18_30_LOCAL", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-WATCHDOG-SAFE", module: "M08", name: "Perfil watchdog seguro (alternativo)", cadence: "DAILY_08_10_PLUS_HOURLY", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-WATCHDOG-PRODUCTION", module: "M08", name: "Perfil watchdog produção (alternativo)", cadence: "DAILY_07_35_18_35_PLUS_HOURLY", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-AUTOMATION-15M", module: "M08", name: "Ciclo principal Apps Script WMGJ", cadence: "EVERY_15_MINUTES", trigger: "APPS_SCRIPT", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-GMAIL-DRIVE-HOURLY", module: "M01", name: "Importação Gmail e processamento Drive", cadence: "HOURLY", trigger: "APPS_SCRIPT", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-NF-DAILY", module: "M03", name: "Ingestão e auditoria diária de NFS-e", cadence: "DAILY_07_LOCAL", trigger: "APPS_SCRIPT", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false }
]);

export function nativeRoutineSummary(): Record<string, unknown> {
  const counts = AURORA_NATIVE_ROUTINES.reduce<Record<NativeRoutineState, number>>((acc, routine) => {
    acc[routine.state] += 1;
    return acc;
  }, { NATIVE_ACTIVE: 0, NATIVE_EVENT: 0, NATIVE_GOVERNED: 0, LEGACY_MIRRORED: 0 });
  return {
    registryVersion: 1,
    source: "AURORA-MO-001",
    referenceTenant: "WMGJ",
    routines: AURORA_NATIVE_ROUTINES,
    counts,
    organicPromotion: {
      tenantRawDataTransfer: false,
      validatedOutcomeRequired: true,
      humanReviewRequired: true,
      tenantAgnosticAbstractionRequired: true
    }
  };
}
