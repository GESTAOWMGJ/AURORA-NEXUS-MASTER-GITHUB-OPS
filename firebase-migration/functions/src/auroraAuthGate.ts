import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
  CSRF_PURPOSES,
  SESSION_COOKIE_NAME,
  csrfTokenForSession,
  identityMayEnter,
  parseAllowedEmails,
  resolveMember,
  validCsrf,
  verifySession
} from "./auroraAccess.js";
import { auroraProtectedShell } from "./auroraFrontend.js";
import { auroraAuth } from "./firebase.js";
import { servePrivateDownloads } from "./auroraDownloads.js";
import { loginClient } from "./auroraLoginClient.js";
import { companyEntry, companyEntryAllowsMember, companyEntryPath, companyManifest, isCompanySlug } from "./auroraTenantEntry.js";

const AURORA_NEXUS_ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const AURORA_NEXUS_CSRF_HMAC_KEY = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setSecurityHeaders(res: { set(name: string, value: string): unknown }): void {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' https://www.gstatic.com",
      "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
      "object-src 'none'"
    ].join("; ")
  );
}

function loginPage(message = "Acesso privado. Entre com usuário autorizado.", entryOrg: string | null = null): string {
  const entryPath = entryOrg ? companyEntryPath(entryOrg) : "/";
  const manifestPath = entryOrg ? `${entryPath}/manifest.webmanifest` : "/manifest.webmanifest";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#06191e">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Aurora Nexus">
  <link rel="manifest" href="${escapeHtml(manifestPath)}">
  <title>Aurora Nexus | Login</title>
  <style>
    :root { color-scheme: dark; --bg:#071f25; --panel:#0d2d34; --line:#1d4a53; --gold:#c6a45d; --text:#f7f1e7; --muted:#b9c7c6; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:radial-gradient(circle at 20% 0%, #123b43 0, var(--bg) 38%, #041316 100%); font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--text); }
    main { width:min(440px, calc(100vw - 32px)); padding:32px; border:1px solid var(--line); border-radius:24px; background:linear-gradient(180deg, rgba(13,45,52,.96), rgba(7,31,37,.96)); box-shadow:0 30px 80px rgba(0,0,0,.35); }
    .eyebrow { margin:0 0 10px; color:var(--gold); letter-spacing:.18em; text-transform:uppercase; font-size:12px; font-weight:700; }
    h1 { margin:0 0 8px; font-size:30px; line-height:1.08; }
    p { margin:0 0 22px; color:var(--muted); line-height:1.55; }
    label { display:block; margin:14px 0 6px; color:#e6eeee; font-size:13px; font-weight:650; }
    input, select { width:100%; padding:14px 14px; border-radius:14px; border:1px solid #2e5f68; background:#061a1f; color:var(--text); outline:none; font-size:15px; }
    input:focus { border-color:var(--gold); box-shadow:0 0 0 3px rgba(198,164,93,.18); }
    button { width:100%; margin-top:18px; border:0; border-radius:14px; padding:14px 16px; background:var(--gold); color:#08191d; font-weight:800; cursor:pointer; font-size:15px; }
    button.secondary { margin-top:10px; background:transparent; color:var(--text); border:1px solid #2e5f68; }
    button:disabled { opacity:.62; cursor:wait; }
    .status { min-height:22px; margin-top:14px; color:#f0d99c; font-size:13px; }
    .fineprint { margin-top:22px; font-size:12px; color:#91a7a6; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Aurora Nexus</p>
    <h1>${entryOrg ? escapeHtml(entryOrg.toUpperCase()) : "Ambiente privado"}</h1>
    <p>${escapeHtml(message)}</p>
    <form id="login-form" autocomplete="on">
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" autocomplete="username" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <label><input id="secure-setup" type="checkbox" style="width:auto"> Configurar segundo fator neste acesso</label>
      <button id="submit" type="submit">Entrar</button>
      <button id="reset-password" class="secondary" type="button">Definir ou redefinir senha</button>
      <div id="status" class="status" aria-live="polite"></div>
    </form>
    <section id="mfa-panel" hidden>
      <p>Esta conta exige um segundo fator TOTP. Confirme o fator cadastrado antes de criar a sessão privada.</p>
      <label for="mfa-factor">Fator</label>
      <select id="mfa-factor"></select>
      <label for="mfa-code">Código temporário</label>
      <input id="mfa-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8">
      <button id="mfa-submit" type="button">Confirmar segundo fator</button>
      <div id="mfa-status" class="status" aria-live="polite"></div>
    </section>
    <section id="activation-panel" hidden>
      <h2>Ative seu acesso seguro</h2>
      <div id="email-setup"><button id="verify-email" type="button">Enviar verificação de e-mail</button><button id="email-confirmed" type="button" class="secondary">Já confirmei meu e-mail</button></div>
      <div id="totp-setup" hidden><button id="start-totp" type="button">Configurar autenticador</button><div id="enrollment-input" hidden><p>Chave para o seu aplicativo autenticador:</p><code id="enrollment-key" style="overflow-wrap:anywhere"></code><label for="enrollment-code">Código do autenticador</label><input id="enrollment-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8"><button id="enroll-totp" type="button">Confirmar cadastro</button></div></div>
      <div id="activation-status" class="status" aria-live="polite"></div>
    </section>
    <div class="fineprint">Sem demonstração pública. Acesso restrito a usuários previamente autorizados.</div>
  </main>
  <script type="module">${loginClient(entryOrg)}</script>
</body>
</html>`;
}

export const auroraNexusAuthGate = onRequest(
  { cors: false, secrets: [AURORA_NEXUS_ALLOWED_EMAILS, AURORA_NEXUS_CSRF_HMAC_KEY] },
  async (req, res) => {
    setSecurityHeaders(res);
    if (!["GET", "HEAD"].includes(req.method)) {
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const entry = companyEntry(req.path);
    if (entry?.manifest) {
      // Public installation metadata only; it neither resolves nor authorizes a tenant.
      res.status(200).type("application/manifest+json").send(JSON.stringify(companyManifest(entry.orgId)));
      return;
    }
    const isDownload = req.path === "/downloads" || req.path.startsWith("/downloads/");
    const decoded = await verifySession(req.get("cookie"), AURORA_NEXUS_ALLOWED_EMAILS.value());
    if (!decoded) {
      if (isDownload) {
        await servePrivateDownloads(req, res, null);
        return;
      }
      res.status(200).type("html").send(loginPage(undefined, entry?.orgId));
      return;
    }

    const member = await resolveMember(decoded);
    if (!member) {
      res.status(403).type("html").send(loginPage("Conta válida, mas o acesso à organização ainda não foi provisionado.", entry?.orgId));
      return;
    }
    if (!companyEntryAllowsMember(entry?.orgId, member.orgId)) {
      res.status(403).type("html").send(loginPage("Esta conta não está autorizada para a empresa selecionada.", entry?.orgId));
      return;
    }
    if (isDownload) {
      await servePrivateDownloads(req, res, member);
      return;
    }
    if (!entry && ["/", "/login", "/portal"].includes(req.path) && isCompanySlug(member.orgId)) {
      res.redirect(303, companyEntryPath(member.orgId));
      return;
    }
    const csrfSecret = AURORA_NEXUS_CSRF_HMAC_KEY.value();
    const csrfTokens = {
      action: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.action),
      refresh: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.refresh),
      userProfile: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.userProfile),
      integrationKey: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.integrationKey),
      distributionApproval: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.distributionApproval),
      logout: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.logout)
    };
    if (!csrfTokens.action || !csrfTokens.refresh || !csrfTokens.integrationKey || !csrfTokens.userProfile || !csrfTokens.distributionApproval || !csrfTokens.logout) {
      logger.error("Aurora Nexus CSRF key is not configured");
      res.status(503).type("html").send(loginPage("Acesso temporariamente indisponível por configuração de segurança.", entry?.orgId));
      return;
    }
    let shell = auroraProtectedShell(member, csrfTokens as { action: string; refresh: string; integrationKey: string; userProfile: string; distributionApproval: string; logout: string }, entry?.path);
    if (["platform_admin", "org_admin", "director"].includes(member.role) || member.permissions.includes("downloads.hml.read")) {
      shell = shell.replace("</nav>", '<a href="/downloads">Instaladores Mac e Windows</a></nav>');
    }
    if (member.allFacilities && (["platform_admin", "org_admin", "director", "auditor"].includes(member.role) || member.permissions.includes("organic.write"))) {
      shell = shell.replace("</nav>", '<a href="/organic">Evolução orgânica e modus operandi</a></nav>');
    }
    if (member.allFacilities && (["platform_admin", "org_admin", "director"].includes(member.role) || member.permissions.includes("shareholder.report.read"))) {
      shell = shell.replace("</nav>", '<a href="/reports/shareholders">Relatório financeiro aos sócios</a></nav>');
    }
    res.status(200).type("html").send(shell);
  }
);

export const auroraNexusSessionLogin = onRequest(
  { cors: false, secrets: [AURORA_NEXUS_ALLOWED_EMAILS] },
  async (req, res) => {
    setSecurityHeaders(res);
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (req.get("sec-fetch-site") && req.get("sec-fetch-site") !== "same-origin") {
      res.status(403).json({ ok: false, code: "CROSS_SITE_LOGIN_REJECTED" });
      return;
    }
    if (!String(req.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      res.status(415).json({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }

    const allowedEmailsRaw = AURORA_NEXUS_ALLOWED_EMAILS.value();
    if (parseAllowedEmails(allowedEmailsRaw).size === 0) {
      logger.error("Aurora Nexus access list is not configured");
      res.status(503).json({ ok: false, code: "ACCESS_LIST_NOT_CONFIGURED" });
      return;
    }

    const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
    if (!idToken) {
      res.status(400).json({ ok: false, code: "MISSING_ID_TOKEN" });
      return;
    }

    try {
      const decoded = await auroraAuth.verifyIdToken(idToken, true);
      if (!await identityMayEnter(decoded, allowedEmailsRaw)) {
        logger.warn("Aurora Nexus login denied", { uid: decoded.uid, email: decoded.email || null });
        res.status(403).json({ ok: false, code: "EMAIL_NOT_ALLOWED" });
        return;
      }
      const member = await resolveMember(decoded);
      if (!member) {
        res.status(403).json({ ok: false, code: "MEMBERSHIP_NOT_PROVISIONED" });
        return;
      }
      if (!companyEntryAllowsMember(req.body?.orgId, member.orgId)) {
        res.status(403).json({ ok: false, code: "COMPANY_ACCESS_DENIED" });
        return;
      }
      const sessionCookie = await auroraAuth.createSessionCookie(idToken, { expiresIn: SESSION_TTL_MS });
      res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionCookie)}; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict; Path=/`
      );
      res.status(204).send("");
    } catch (error) {
      logger.warn("Aurora Nexus login failed", { error: error instanceof Error ? error.message : String(error) });
      res.status(401).json({ ok: false, code: "INVALID_LOGIN" });
    }
  }
);

export const auroraNexusSessionLogout = onRequest(
  { cors: false, secrets: [AURORA_NEXUS_CSRF_HMAC_KEY] },
  async (req, res) => {
    setSecurityHeaders(res);
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"), AURORA_NEXUS_CSRF_HMAC_KEY.value(), CSRF_PURPOSES.logout)) {
      res.status(403).json({ ok: false, code: "CSRF_REJECTED" });
      return;
    }
    res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Path=/`);
    res.status(204).send("");
  }
);
