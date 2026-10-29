import { createHash } from "node:crypto";

/** Professional recruitment is separate from Aurora user provisioning/clinical records. */
export const CREDMED_SCHEMA = "aurora.credmed.v1";
export const CREDMED_DOCUMENT_TYPES = [
  "CRM_ID", "CRM_CERTIFICATE", "RQE", "DIPLOMA", "CURRICULUM", "COURSE_CERTIFICATE",
  "SPECIALTY_CERTIFICATE", "OTHER_CREDENTIAL"
] as const;
export type MedicalDocumentType = typeof CREDMED_DOCUMENT_TYPES[number];
export const CREDMED_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const CREDMED_MAX_DOCUMENTS = 8;
export const CREDMED_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type PartnerApplication = {
  fullName: string; email: string; phone: string; crmNumber: string; crmState: string;
  city: string; state: string; specialty: string; rqe: string | null;
  experienceYears: number | null; workAreas: string[]; availability: string[];
  engagement: string[]; companyOption: boolean; notes: string | null;
  noticeAccepted: true; futureOpportunitiesAccepted: boolean;
  preCredentialTermsAccepted: true;
};
export class CredentialError extends Error {
  constructor(readonly code: string, readonly httpStatus = 400) { super(code); }
}
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function validInvitationToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
    && Buffer.from(token, "base64url").length === 32
    && Buffer.from(token, "base64url").toString("base64url") === token;
}
const cleanText = (value: unknown, min: number, max: number, field: string): string => {
  if (typeof value !== "string") throw new CredentialError("INVALID_" + field);
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < min || text.length > max || /[\x00-\x1f<>]/.test(text)) throw new CredentialError("INVALID_" + field);
  return text;
};
const allowList = (raw: unknown, allowed: readonly string[], max: number, field: string): string[] => {
  if (!Array.isArray(raw) || raw.length > max || raw.some(x => typeof x !== "string" || !allowed.includes(x)))
    throw new CredentialError("INVALID_" + field);
  return [...new Set(raw)].sort();
};
const WORK_AREAS = ["UTI_ADULTO","EMERGENCIA","ENFERMARIA","AMBULATORIO","CARDIOLOGIA","ECOCARDIOGRAFIA","TELEMEDICINA","OUTROS"];
const AVAILABILITY = ["DIURNO","NOTURNO","12_HORAS","24_HORAS","DIAS_UTEIS","FINS_DE_SEMANA","EVENTUAL","FIXO"];
const ENGAGEMENT = ["PLANTAO","CONSULTA","EXAME","COORDENACAO","AUDITORIA","TELEATENDIMENTO"];
export function validateMedicalApplication(input: unknown): PartnerApplication {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CredentialError("INVALID_APPLICATION");
  const d = input as Record<string, unknown>;
  const keys = ["fullName","email","phone","crmNumber","crmState","city","state","specialty",
    "rqe","experienceYears","workAreas","availability","engagement","companyOption","notes",
    "noticeAccepted","futureOpportunitiesAccepted","preCredentialTermsAccepted"];
  if (Object.keys(d).some(k => !keys.includes(k))) throw new CredentialError("UNEXPECTED_APPLICATION_FIELD");
  const fullName = cleanText(d.fullName, 5, 120, "NAME");
  const email = cleanText(d.email, 5, 254, "EMAIL").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CredentialError("INVALID_EMAIL");
  const phone = cleanText(d.phone, 10, 22, "PHONE");
  if (phone.replace(/\D/g, "").length < 10 || phone.replace(/\D/g, "").length > 13)
    throw new CredentialError("INVALID_PHONE");
  const crmNumber = cleanText(d.crmNumber, 1, 15, "CRM").replace(/\s/g, "");
  if (!/^[0-9]{1,10}[A-Za-z]?$/.test(crmNumber)) throw new CredentialError("INVALID_CRM");
  const uf = (value: unknown, field: string) => {
    const item = cleanText(value, 2, 2, field).toUpperCase();
    if (!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(item))
      throw new CredentialError("INVALID_" + field);
    return item;
  };
  const crmState = uf(d.crmState, "CRM_UF");
  const state = uf(d.state, "STATE");
  const city = cleanText(d.city, 2, 90, "CITY");
  const specialty = cleanText(d.specialty, 2, 100, "SPECIALTY");
  const rqe = d.rqe === undefined || d.rqe === null || d.rqe === "" ? null : cleanText(d.rqe, 1, 15, "RQE");
  if (rqe && !/^[0-9]{1,12}$/.test(rqe)) throw new CredentialError("INVALID_RQE");
  const experienceYears = d.experienceYears === null || d.experienceYears === "" || d.experienceYears === undefined
    ? null : Number(d.experienceYears);
  if (experienceYears !== null && (!Number.isSafeInteger(experienceYears) || experienceYears < 0 || experienceYears > 70))
    throw new CredentialError("INVALID_EXPERIENCE");
  const workAreas = allowList(d.workAreas, WORK_AREAS, 8, "WORK_AREAS");
  const availability = allowList(d.availability, AVAILABILITY, 8, "AVAILABILITY");
  const engagement = allowList(d.engagement, ENGAGEMENT, 6, "ENGAGEMENT");
  if (!workAreas.length || !availability.length || !engagement.length) throw new CredentialError("MISSING_WORK_PREFERENCES");
  const companyOption = d.companyOption === true;
  const notes = d.notes === undefined || d.notes === null || d.notes === ""
    ? null : cleanText(d.notes, 1, 1000, "NOTES");
  if (d.noticeAccepted !== true || d.preCredentialTermsAccepted !== true
      || typeof d.futureOpportunitiesAccepted !== "boolean") throw new CredentialError("NOTICE_AND_TERMS_REQUIRED");
  return { fullName, email, phone, crmNumber, crmState, city, state, specialty, rqe,
    experienceYears, workAreas, availability, engagement, companyOption, notes,
    noticeAccepted: true, futureOpportunitiesAccepted: d.futureOpportunitiesAccepted,
    preCredentialTermsAccepted: true };
}
export type MedicalAttachment = { kind: MedicalDocumentType; bytes: Buffer; mimeType: "application/pdf" | "image/png" | "image/jpeg"; sha256: string };
export function validateMedicalAttachment(raw: unknown): MedicalAttachment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CredentialError("INVALID_ATTACHMENT");
  const r = raw as Record<string,unknown>;
  if (Object.keys(r).some(k => !["kind","base64","mimeType"].includes(k))
    || !CREDMED_DOCUMENT_TYPES.includes(r.kind as MedicalDocumentType)
    || typeof r.base64 !== "string" || r.base64.length > Math.ceil(CREDMED_MAX_FILE_BYTES * 4 / 3) + 8
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.base64))
    throw new CredentialError("INVALID_ATTACHMENT");
  const bytes = Buffer.from(r.base64, "base64");
  if (!bytes.length || bytes.length > CREDMED_MAX_FILE_BYTES
    || bytes.toString("base64") !== r.base64) throw new CredentialError("INVALID_ATTACHMENT_BYTES");
  const pdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const mimeType = pdf ? "application/pdf" : png ? "image/png" : jpg ? "image/jpeg" : null;
  if (!mimeType || mimeType !== r.mimeType) throw new CredentialError("FILE_TYPE_MISMATCH");
  return { kind: r.kind as MedicalDocumentType, bytes, mimeType, sha256: sha256(bytes) };
}
export function medicalCredentialReadiness(input: { crmVerified: boolean; specialtyVerified: boolean; documentsReviewed: boolean; mandatoryTrainingVerified: boolean; restricted: boolean }) {
  if (input.restricted) return "RESTRICTED";
  return input.crmVerified && input.specialtyVerified && input.documentsReviewed && input.mandatoryTrainingVerified
    ? "ELIGIBLE_FOR_OPPORTUNITY" : "PENDING_REVIEW";
}
