import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CREDMED_SCHEMA, CREDMED_MAX_FILE_BYTES, medicalCredentialReadiness, sha256,
  validateMedicalApplication, validateMedicalAttachment, validInvitationToken
} from "../src/auroraMedicalPartnerPolicy.ts";
import { medicalPartnerAdminPage, medicalPartnerPublicPage } from "../src/auroraMedicalPartnerView.ts";
import { AURORA_NATIVE_ROUTINES, nativeRoutineSummary } from "../src/auroraNativeRoutines.ts";

const profile = () => ({
  fullName: "Dra. Camila Teste", email: "camila@example.test", phone: "(43) 99999-9999",
  crmNumber: "123456", crmState: "PR", city: "Londrina", state: "PR",
  specialty: "Clínica Médica", rqe: "12345", experienceYears: 5,
  workAreas: ["UTI_ADULTO"], availability: ["DIURNO"], engagement: ["PLANTAO"],
  companyOption: false, notes: null, noticeAccepted: true,
  futureOpportunitiesAccepted: false, preCredentialTermsAccepted: true
});

test("cadastro sintético e finalidade minimizada — sem CPF ou dados clínicos", () => {
  const item = validateMedicalApplication(profile());
  assert.equal(item.crmState, "PR");
  assert.equal(item.noticeAccepted, true);
  assert.equal(item.experienceYears, 5);
  assert.equal(item.rqe, "12345");
  assert.ok(!("cpf" in item));
  assert.throws(() => validateMedicalApplication({...profile(),cpf:"00000000000"}), /UNEXPECTED_APPLICATION_FIELD/);
  assert.throws(() => validateMedicalApplication({...profile(),noticeAccepted:false}), /NOTICE_AND_TERMS_REQUIRED/);
  assert.throws(() => validateMedicalApplication({...profile(),futureOpportunitiesAccepted:"yes"}), /NOTICE_AND_TERMS_REQUIRED/);
});

test("CRM/RQE e campos são estritos; títulos declarados não representam verificação", () => {
  assert.throws(() => validateMedicalApplication({...profile(),crmState:"ZZ"}), /INVALID_CRM_UF/);
  assert.throws(() => validateMedicalApplication({...profile(),crmNumber:"<img>"}), /INVALID_CRM/);
  assert.throws(() => validateMedicalApplication({...profile(),rqe:"RQE 20"}), /INVALID_RQE/);
  assert.throws(() => validateMedicalApplication({...profile(),workAreas:["ADMIN"]}), /INVALID_WORK_AREAS/);
  assert.equal(medicalCredentialReadiness({crmVerified:false,specialtyVerified:false,documentsReviewed:true,mandatoryTrainingVerified:true,restricted:false}),"PENDING_REVIEW");
  assert.equal(medicalCredentialReadiness({crmVerified:true,specialtyVerified:true,documentsReviewed:true,mandatoryTrainingVerified:true,restricted:false}),"ELIGIBLE_FOR_OPPORTUNITY");
  assert.equal(medicalCredentialReadiness({crmVerified:true,specialtyVerified:true,documentsReviewed:true,mandatoryTrainingVerified:true,restricted:true}),"RESTRICTED");
});

test("token de 256 bits, fingerprint e anexos com assinatura e limite", () => {
  const token=Buffer.alloc(32,7).toString("base64url");
  assert.equal(validInvitationToken(token), true);
  assert.equal(validInvitationToken("123"), false);
  assert.equal(sha256(Buffer.from("teste")).length, 64);
  const pdf=Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
  const valid=validateMedicalAttachment({kind:"CRM_CERTIFICATE",mimeType:"application/pdf",base64:pdf.toString("base64")});
  assert.equal(valid.mimeType,"application/pdf");
  assert.equal(valid.bytes.length,pdf.length);
  assert.throws(() => validateMedicalAttachment({kind:"CRM_ID",mimeType:"image/png",base64:pdf.toString("base64")}), /FILE_TYPE_MISMATCH/);
  assert.throws(() => validateMedicalAttachment({kind:"EXECUTABLE",mimeType:"application/pdf",base64:pdf.toString("base64")}), /INVALID_ATTACHMENT/);
  assert.throws(() => validateMedicalAttachment({kind:"CRM_ID",mimeType:"application/pdf",base64:Buffer.alloc(CREDMED_MAX_FILE_BYTES+1,66).toString("base64")}), /INVALID_ATTACHMENT/);
});

test("site com etapas, anexo local, convite no fragmento e sem autorização presumida", () => {
  const page=medicalPartnerPublicPage();
  assert.match(page,/pré-cadastro/i);
  assert.match(page,/type="file"/);
  assert.match(page,/CRM_CERTIFICATE/);
  assert.match(page,/location\.hash/);
  assert.match(page,/history\.replaceState/);
  assert.match(page,/\/api\/wmgj\/medicos/);
  assert.match(page,/Nenhuma entrega é confirmada sem protocolo/);
  assert.match(page,/não constitui contrato/i);
  assert.doesNotMatch(page,/enviar.*CPF/i);
  assert.match(medicalPartnerAdminPage("v1." + "a".repeat(64)),/Criar novo link seguro/);
  assert.throws(() => medicalPartnerAdminPage("<script>"),/INVALID_CSRF_TOKEN/);
});

test("registro nativo distingue política especificada de liberação real", () => {
  const matches=AURORA_NATIVE_ROUTINES.filter(r=>r.id==="AURORA-CRED-MED-001");
  assert.equal(matches.length,1);
  assert.equal(matches[0]?.state,"NATIVE_GOVERNED");
  assert.equal(matches[0]?.sourceMutation,false);
  const policy=(nativeRoutineSummary() as any).medicalCredentialingPolicy;
  assert.equal(policy.schemaVersion,CREDMED_SCHEMA);
  assert.equal(policy.publicOpenUploadWithoutInvitation,false);
  assert.equal(policy.documentApprovalFromUpload,false);
  assert.equal(policy.crmApprovalFromApplicantDeclaration,false);
  assert.equal(policy.externalAiRequired,false);
  assert.equal(policy.permissionsGranted,false);
  assert.equal(policy.schedulerCreated,false);
  assert.equal(policy.runtimeActivationRequiresTenantFlag,true);
});

test("rotas usam function autenticada, sem links de Storage expostos nem bucket default", () => {
  const base=new URL("../../",import.meta.url);
  const hml=JSON.parse(readFileSync(new URL("firebase.json",base),"utf8"));
  const prod=JSON.parse(readFileSync(new URL("firebase.production.json",base),"utf8"));
  for (const conf of [hml,prod]) {
    for (const url of ["/wmgj/medicos","/wmgj/medicos/gestao","/api/wmgj/medicos"]) {
      assert.ok(conf.hosting.rewrites.some((r:any)=>r.source===url&&r.function?.functionId==="auroraNexusMedicalPartners"));
    }
  }
  const runtime=readFileSync(new URL("../src/auroraMedicalPartnerRuntime.ts",import.meta.url),"utf8");
  assert.match(runtime,/PRIVATE_STORAGE_NOT_CONFIGURED/);
  assert.match(runtime,/medicalPartnersEnabled/);
  assert.match(runtime,/verifyAuroraAccess/);
  assert.match(runtime,/validCsrf/);
  assert.match(runtime,/getStorage/);
  assert.match(runtime,/getMetadata/);
  assert.doesNotMatch(runtime,/makePublic/);
});
