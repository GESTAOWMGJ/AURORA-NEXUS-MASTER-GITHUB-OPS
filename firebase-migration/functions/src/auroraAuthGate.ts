import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

const AURORA_NEXUS_ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const SESSION_COOKIE_NAME = "__session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

function parseAllowedEmails(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isEmailAllowed(email: unknown, rawAllowedEmails: string): boolean {
  if (typeof email !== "string" || !email.trim()) return false;
  const allowed = parseAllowedEmails(rawAllowedEmails);
  if (allowed.size === 0) return false;
  return allowed.has(email.trim().toLowerCase());
}

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      const value = rawValue.join("=");
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

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
    input { width:100%; padding:14px 14px; border-radius:14px; border:1px solid #2e5f68; background:#061a1f; color:var(--text); outline:none; font-size:15px; }
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
    <div class="fineprint">Sem demonstração pública. Acesso restrito a usuários previamente autorizados.</div>
  </main>
  <script src="/__/firebase/10.12.5/firebase-app-compat.js"></script>
  <script src="/__/firebase/10.12.5/firebase-auth-compat.js"></script>
  <script src="/__/firebase/init.js"></script>
  <script>
    const form = document.getElementById('login-form');
    const statusEl = document.getElementById('status');
    const submit = document.getElementById('submit');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      statusEl.textContent = 'Validando acesso...';
      try {
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const credential = await firebase.auth().signInWithEmailAndPassword(email, password);
        const idToken = await credential.user.getIdToken();
        const response = await fetch('/__sessionLogin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken })
        });
        await firebase.auth().signOut();
        if (!response.ok) throw new Error('LOGIN_REJECTED');
        window.location.replace('/');
      } catch (error) {
        statusEl.textContent = 'Acesso não autorizado.';
        submit.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function protectedShell(decoded: DecodedIdToken): string {
  const email = escapeHtml(decoded.email || "usuário autorizado");
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aurora Nexus | Privado</title>
  <style>
    :root { color-scheme: dark; --bg:#071f25; --panel:#0d2d34; --line:#1d4a53; --gold:#c6a45d; --text:#f7f1e7; --muted:#b9c7c6; }
    body { margin:0; min-height:100vh; background:#071f25; color:var(--text); font-family:Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { display:flex; justify-content:space-between; align-items:center; padding:24px 32px; border-bottom:1px solid var(--line); background:rgba(7,31,37,.92); }
    main { padding:32px; }
    .brand { color:var(--gold); letter-spacing:.14em; text-transform:uppercase; font-weight:800; font-size:13px; }
    .panel { max-width:880px; border:1px solid var(--line); border-radius:22px; background:var(--panel); padding:28px; }
    h1 { margin:0 0 8px; }
    p { color:var(--muted); line-height:1.55; }
    button { border:1px solid var(--gold); border-radius:12px; background:transparent; color:var(--gold); padding:10px 14px; cursor:pointer; font-weight:700; }
  </style>
</head>
<body>
  <header>
    <div class="brand">Aurora Nexus</div>
    <button onclick="logout()">Sair</button>
  </header>
  <main>
    <section class="panel">
      <h1>Acesso autenticado</h1>
      <p>Sessão validada para <strong>${email}</strong>.</p>
      <p>Interface operacional privada. Nenhum dashboard, demonstração ou dado interno é entregue sem sessão autenticada.</p>
    </section>
  </main>
  <script>
    async function logout() {
      await fetch('/__sessionLogout', { method: 'POST' });
      window.location.replace('/');
    }
  </script>
</body>
</html>`;
}

async function verifySession(cookieHeader: string | undefined, allowedEmailsRaw: string): Promise<DecodedIdToken | null> {
  const cookie = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!cookie) return null;
  try {
    const decoded = await getAuth().verifySessionCookie(cookie, true);
    if (!isEmailAllowed(decoded.email, allowedEmailsRaw)) return null;
    return decoded;
  } catch (error) {
    logger.warn("Aurora Nexus session rejected", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export const auroraNexusAuthGate = onRequest(
  { cors: false, secrets: [AURORA_NEXUS_ALLOWED_EMAILS] },
  async (req, res) => {
    setSecurityHeaders(res);
    if (!["GET", "HEAD"].includes(req.method)) {
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const decoded = await verifySession(req.get("cookie"), AURORA_NEXUS_ALLOWED_EMAILS.value());
    if (!decoded) {
      res.status(200).type("html").send(loginPage());
      return;
    }

    res.status(200).type("html").send(protectedShell(decoded));
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
      const decoded = await getAuth().verifyIdToken(idToken, true);
      if (!isEmailAllowed(decoded.email, allowedEmailsRaw)) {
        logger.warn("Aurora Nexus login denied", { uid: decoded.uid, email: decoded.email || null });
        res.status(403).json({ ok: false, code: "EMAIL_NOT_ALLOWED" });
        return;
      }
      const sessionCookie = await getAuth().createSessionCookie(idToken, { expiresIn: SESSION_TTL_MS });
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
  { cors: false },
  async (req, res) => {
    setSecurityHeaders(res);
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Path=/`
    );
    res.status(204).send("");
  }
);
