import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
  CSRF_PURPOSES,
  SESSION_COOKIE_NAME,
  csrfTokenForSession,
  isEmailAllowed,
  parseAllowedEmails,
  resolveMember,
  validCsrf,
  verifySession
} from "./auroraAccess.js";
import { auroraProtectedShell } from "./auroraFrontend.js";
import { auroraAuth } from "./firebase.js";
import { servePrivateDownloads } from "./auroraDownloads.js";

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

function loginPage(message = "Acesso privado. Entre com usuário autorizado."): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
    button:disabled { opacity:.62; cursor:wait; }
    .status { min-height:22px; margin-top:14px; color:#f0d99c; font-size:13px; }
    .fineprint { margin-top:22px; font-size:12px; color:#91a7a6; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Aurora Nexus</p>
    <h1>Ambiente privado</h1>
    <p>${escapeHtml(message)}</p>
    <form id="login-form" autocomplete="on">
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" autocomplete="username" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button id="submit" type="submit">Entrar</button>
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
    <div class="fineprint">Sem demonstração pública. Acesso restrito a usuários previamente autorizados.</div>
  </main>
  <script src="/__/firebase/10.12.5/firebase-app-compat.js"></script>
  <script src="/__/firebase/10.12.5/firebase-auth-compat.js"></script>
  <script src="/__/firebase/init.js"></script>
  <script>
    const form = document.getElementById('login-form');
    const statusEl = document.getElementById('status');
    const submit = document.getElementById('submit');
    const mfaPanel = document.getElementById('mfa-panel');
    const mfaFactor = document.getElementById('mfa-factor');
    const mfaCode = document.getElementById('mfa-code');
    const mfaSubmit = document.getElementById('mfa-submit');
    const mfaStatus = document.getElementById('mfa-status');
    let mfaResolver = null;

    async function createPrivateSession(credential) {
      const idToken = await credential.user.getIdToken(true);
      const response = await fetch('/__sessionLogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      await firebase.auth().signOut();
      if (!response.ok) throw new Error('LOGIN_REJECTED');
      window.location.replace('/');
    }

    function requestTotpChallenge(error) {
      const totp = firebase.auth.TotpMultiFactorGenerator;
      const resolver = error && error.resolver;
      const hints = resolver && Array.isArray(resolver.hints)
        ? resolver.hints.filter((hint) => totp && hint.factorId === totp.FACTOR_ID)
        : [];
      if (!resolver || hints.length === 0) throw new Error('UNSUPPORTED_MFA_FACTOR');
      mfaResolver = resolver;
      mfaFactor.replaceChildren();
      for (const hint of hints) {
        const option = document.createElement('option');
        option.value = hint.uid;
        option.textContent = hint.displayName || 'Aplicativo autenticador';
        mfaFactor.appendChild(option);
      }
      form.hidden = true;
      mfaPanel.hidden = false;
      mfaStatus.textContent = 'Digite o código do aplicativo autenticador.';
      mfaCode.focus();
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      statusEl.textContent = 'Validando acesso...';
      try {
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const credential = await firebase.auth().signInWithEmailAndPassword(email, password);
        await createPrivateSession(credential);
      } catch (error) {
        if (error && error.code === 'auth/multi-factor-auth-required') {
          try {
            requestTotpChallenge(error);
            return;
          } catch (_) {
            statusEl.textContent = 'O segundo fator cadastrado não é suportado neste ambiente.';
          }
        } else {
          statusEl.textContent = 'Acesso não autorizado.';
        }
        submit.disabled = false;
      }
    });
    mfaSubmit.addEventListener('click', async () => {
      mfaSubmit.disabled = true;
      mfaStatus.textContent = 'Validando segundo fator...';
      try {
        if (!mfaResolver) throw new Error('MFA_RESOLVER_MISSING');
        const code = mfaCode.value.trim();
        if (!/^[0-9]{6,8}$/.test(code)) throw new Error('MFA_CODE_INVALID');
        const hint = mfaResolver.hints.find((item) => item.uid === mfaFactor.value);
        if (!hint) throw new Error('MFA_HINT_INVALID');
        const assertion = firebase.auth.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
        const credential = await mfaResolver.resolveSignIn(assertion);
        await createPrivateSession(credential);
      } catch (_) {
        mfaStatus.textContent = 'Segundo fator inválido ou expirado.';
        mfaSubmit.disabled = false;
      }
    });
  </script>
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

    const isDownload = req.path === "/downloads" || req.path.startsWith("/downloads/");
    const decoded = await verifySession(req.get("cookie"), AURORA_NEXUS_ALLOWED_EMAILS.value());
    if (!decoded) {
      if (isDownload) {
        await servePrivateDownloads(req, res, null);
        return;
      }
      res.status(200).type("html").send(loginPage());
      return;
    }

    const member = await resolveMember(decoded);
    if (!member) {
      res.status(403).type("html").send(loginPage("Conta válida, mas o acesso à organização ainda não foi provisionado."));
      return;
    }
    if (isDownload) {
      await servePrivateDownloads(req, res, member);
      return;
    }
    const csrfSecret = AURORA_NEXUS_CSRF_HMAC_KEY.value();
    const csrfTokens = {
      action: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.action),
      refresh: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.refresh),
      logout: csrfTokenForSession(req.get("cookie"), csrfSecret, CSRF_PURPOSES.logout)
    };
    if (!csrfTokens.action || !csrfTokens.refresh || !csrfTokens.logout) {
      logger.error("Aurora Nexus CSRF key is not configured");
      res.status(503).type("html").send(loginPage("Acesso temporariamente indisponível por configuração de segurança."));
      return;
    }
    let shell = auroraProtectedShell(member, csrfTokens as { action: string; refresh: string; logout: string });
    if (["platform_admin", "org_admin", "director"].includes(member.role) || member.permissions.includes("downloads.hml.read")) {
      shell = shell.replace("</nav>", '<a href="/downloads">Instaladores Mac e Windows</a></nav>');
    }
    if (member.allFacilities && (["platform_admin", "org_admin", "director", "auditor"].includes(member.role) || member.permissions.includes("organic.write"))) {
      shell = shell.replace("</nav>", '<a href="/organic">Evolução orgânica e modus operandi</a></nav>');
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
      if (!isEmailAllowed(decoded.email, allowedEmailsRaw)) {
        logger.warn("Aurora Nexus login denied", { uid: decoded.uid, email: decoded.email || null });
        res.status(403).json({ ok: false, code: "EMAIL_NOT_ALLOWED" });
        return;
      }
      const member = await resolveMember(decoded);
      if (!member) {
        res.status(403).json({ ok: false, code: "MEMBERSHIP_NOT_PROVISIONED" });
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
