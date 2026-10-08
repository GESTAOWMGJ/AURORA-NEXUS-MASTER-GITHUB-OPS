/** Public entry paths select presentation only. Membership always authorizes data. */
export const CANONICAL_PORTAL_PATH = "/portal";

const RESERVED = new Set(["login", "portal", "setup", "downloads", "organic", "api", "reports", "assets", "static", "health", "healthz"]);

export function isCompanySlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
    && value.length >= 2 && value.length <= 63 && !RESERVED.has(value);
}

export function companyEntryPath(orgId: string): string {
  if (!isCompanySlug(orgId)) throw new Error("INVALID_COMPANY_ENTRY");
  return `/${orgId}`;
}

export function userFacingEntryPath(_memberOrgId?: string | null): string {
  return CANONICAL_PORTAL_PATH;
}

export function companyEntry(path: string): { orgId: string; path: string; manifest: boolean } | null {
  // Do not decode or normalize redirects, encoded separators, Unicode or traversal.
  const match = /^\/([a-z0-9-]+)(?:\/(login|manifest\.webmanifest))?\/?$/.exec(path);
  const orgId = match?.[1];
  if (!isCompanySlug(orgId)) return null;
  return { orgId, path: companyEntryPath(orgId), manifest: match?.[2] === "manifest.webmanifest" };
}

export function companyEntryAllowsMember(requestedOrg: unknown, memberOrg: string): boolean {
  return requestedOrg === undefined || requestedOrg === null
    || (isCompanySlug(requestedOrg) && requestedOrg === memberOrg);
}

/** Call only with a Firebase-verified token. This claim selects, never grants membership. */
export function sessionOrganization(verifiedClaim: unknown): string | null {
  if (verifiedClaim === undefined) return "wmgj"; // Preserve existing pilot sessions.
  return isCompanySlug(verifiedClaim) ? verifiedClaim : null;
}

export function companyManifest(orgId: string): Record<string, unknown> {
  const path = companyEntryPath(orgId);
  return {
    name: `Aurora Nexus · ${orgId}`, short_name: "Aurora", id: path, start_url: path,
    scope: "/", display: "standalone", background_color: "#06191e", theme_color: "#06191e",
    description: "Acesso privado de gestão, auditoria e rastreabilidade operacional.",
    icons: [{ src: "/aurora-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
  };
}

export function portalManifest(): Record<string, unknown> {
  return {
    name: "Aurora Nexus", short_name: "Aurora", id: CANONICAL_PORTAL_PATH, start_url: CANONICAL_PORTAL_PATH,
    scope: "/", display: "standalone", background_color: "#06191e", theme_color: "#06191e",
    description: "Acesso privado de gestão, auditoria e rastreabilidade operacional.",
    icons: [{ src: "/aurora-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
  };
}
