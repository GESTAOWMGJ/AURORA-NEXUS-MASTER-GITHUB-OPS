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

// Shared presentation only. Authentication, authorization, cookies and routing stay unchanged.
const AURORA_VISUAL_CSS = `
  :root { color-scheme:dark; --bg:#080c16; --panel:#101827; --line:#2a3850; --accent:#30d7ff; --action:#c0fa65; --text:#f4f7fc; --muted:#a7b5cb; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  body:not(.private-shell) { display:grid; place-items:center; padding:24px 16px; }
  main { width:min(480px,100%); padding:36px; border:1px solid var(--line); border-top:3px solid var(--accent); border-radius:20px; background:var(--panel); box-shadow:0 24px 70px #0005; }
  .eyebrow,.brand { margin:0 0 20px; color:var(--accent); letter-spacing:.15em; text-transform:uppercase; font-size:13px; font-weight:850; }
  h1 { margin:0 0 14px; font-size:clamp(28px,6vw,38px); letter-spacing:-.04em; line-height:1.1; }
  p { margin:0 0 24px; color:var(--muted); line-height:1.6; overflow-wrap:anywhere; }
  label { display:block; margin:18px 0 8px; color:var(--muted); font-size:12px; font-weight:750; }
  input { width:100%; min-height:48px; padding:14px; border:1px solid #43536c; border-radius:10px; background:var(--bg); color:var(--text); font-size:16px; }
  input:focus { outline:3px solid var(--accent); outline-offset:3px; }
  button { width:100%; min-height:48px; margin-top:24px; padding:14px 16px; border:0; border-radius:10px; background:var(--action); color:#111c08; font-size:15px; font-weight:850; cursor:pointer; }
  button:focus-visible { outline:3px solid var(--accent); outline-offset:4px; }
  button:disabled { opacity:.62; cursor:wait; }
  .status { min-height:22px; margin-top:14px; color:#ffcb57; font-size:13px; }
  .fineprint { margin-top:24px; padding-top:18px; border-top:1px solid var(--line); font-size:12px; line-height:1.6; color:var(--muted); }
  .private-shell header { display:flex; justify-content:space-between; align-items:center; gap:20px; padding:24px 32px; border-bottom:1px solid var(--line); }
  .private-shell .brand { margin:0; }
  .private-shell header button { width:auto; margin:0; min-width:76px; }
  .private-shell main { width:min(960px,calc(100% - 32px)); margin:32px auto; padding:0; border:0; background:transparent; box-shadow:none; }
  .panel { padding:32px; border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:18px; background:var(--panel); }
  .panel p:last-child { margin-bottom:0; }
  @media(max-width:480px) { main { padding:26px; } .private-shell header { padding:20px 16px; } .panel { padding:24px; } }
  @media(prefers-reduced-motion:reduce) { * { animation:none!important; transition:none!important; } }
`;

function loginPage(message = "Acesso privado. Entre com usuário autorizado."): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#080c16">
  <title>Aurora Nexus | Login</title>
  <style>${AURORA_VISUAL_CSS}</style>
</head>
<body>
  <main>
    <p class="eyebrow">Aurora Nexus</p>
    <h1>Seu centro de comando começa aqui.</h1>
    <p>${escapeHtml(message)}</p>
    <form id="login-form" autocomplete="on">
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" autocomplete="username" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button id="submit" type="submit">Entrar no Aurora Nexus</button>
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
  <meta name="theme-color" content="#080c16">
  <title>Aurora Nexus | Privado</title>
  <style>${AURORA_VISUAL_CSS}</style>
</head>
<body class="private-shell">
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
