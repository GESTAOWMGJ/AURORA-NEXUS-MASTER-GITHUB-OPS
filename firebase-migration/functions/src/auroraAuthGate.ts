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
  :root { color-scheme:dark; --bg:#090e17; --panel:#111a27; --line:#29394c; --accent:#32d2fa; --action:#32d2fa; --text:#f3f7fc; --muted:#a6b6ca; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font-family:Inter,Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  body:not(.private-shell) { display:grid; place-items:center; padding:36px 24px; }
  .login-layout { display:grid; grid-template-columns:1.15fr 1fr; gap:100px; align-items:center; width:min(1060px,100%); }
  .login-story { min-width:0; }
  .login-brand { display:flex; align-items:center; gap:12px; margin-bottom:72px; }
  .brand-mark { width:48px; height:50px; display:flex; align-items:center; justify-content:center; border:1px solid #32d2fa90; border-radius:13px; background:#0e2c3a; color:var(--accent); font-size:18px; font-weight:850; letter-spacing:-2px; }
  .brand-mark span { color:#c4f777; font-size:29px; margin-right:1px; }
  .brand-name { font-size:19px; font-weight:750; letter-spacing:.02em; }
  .brand-name span { color:var(--accent); }
  .brand-caption { display:block; color:var(--muted); font-size:9px; letter-spacing:.16em; margin-top:6px; }
  .eyebrow,.brand { margin:0 0 16px; color:#b7a9ff; letter-spacing:.15em; text-transform:uppercase; font-size:10px; font-weight:750; }
  h1 { margin:0 0 22px; font-size:clamp(36px,4.4vw,60px); letter-spacing:-.055em; line-height:1.04; font-weight:750; }
  h1 span { color:var(--accent); }
  p { margin:0 0 22px; color:var(--muted); font-size:14px; line-height:1.7; overflow-wrap:anywhere; }
  .story-copy { max-width:360px; }
  .login-principles { margin-top:34px; padding-top:23px; border-top:1px solid var(--line); display:flex; gap:22px; color:var(--muted); font-size:10px; }
  .login-principles span { display:grid; gap:8px; }
  .login-principles b { font-size:9px; font-weight:500; color:var(--accent); }
  .login-card { min-width:0; padding:34px; border:1px solid #35485c; border-top:3px solid var(--accent); border-radius:18px; background:var(--panel); }
  .private-label { display:inline-flex; align-items:center; gap:7px; padding:6px 9px; border:1px solid #375567; border-radius:6px; color:var(--accent); background:#112b38; font-size:10px; margin-bottom:26px; }
  .private-label svg { width:13px; height:13px; }
  h2 { margin:0 0 10px; font-size:27px; letter-spacing:-.04em; line-height:1.2; }
  .login-card>p { font-size:12px; margin-bottom:25px; }
  label { display:block; margin:18px 0 8px; color:var(--text); font-size:12px; font-weight:600; }
  input { width:100%; min-width:0; min-height:50px; padding:13px 14px; border:1px solid #51637c; border-radius:9px; background:var(--bg); color:var(--text); font-size:16px; }
  input:focus { outline:3px solid var(--accent); outline-offset:3px; }
  button { width:100%; min-height:49px; margin-top:25px; padding:13px 16px; border:0; border-radius:9px; background:var(--action); color:#082532; font-size:13px; font-weight:750; cursor:pointer; }
  button:hover { background:#73e2fd; }
  button:focus-visible { outline:3px solid var(--accent); outline-offset:4px; }
  button:disabled { opacity:.62; cursor:wait; }
  .status { min-height:18px; margin-top:12px; color:#ffcb62; font-size:12px; }
  .fineprint { margin-top:12px; padding-top:18px; border-top:1px solid var(--line); font-size:10px; line-height:1.7; color:var(--muted); }
  .login-footer { grid-column:1/-1; display:flex; justify-content:space-between; padding-top:24px; border-top:1px solid var(--line); color:var(--muted); font-size:9px; letter-spacing:.04em; margin-top:-55px; }
  .private-shell header { display:flex; justify-content:space-between; align-items:center; gap:20px; padding:24px 32px; border-bottom:1px solid var(--line); }
  .private-shell .brand { margin:0; color:var(--accent); font-size:13px; }
  .private-shell header button { width:auto; margin:0; min-width:76px; }
  .private-shell main { width:min(960px,calc(100% - 32px)); margin:32px auto; }
  .panel { padding:32px; border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:18px; background:var(--panel); }
  .private-shell h1 { font-size:32px; }
  .panel p:last-child { margin-bottom:0; }
  @media(max-width:1000px) { .login-layout { gap:50px; } .login-card { padding:28px; } .login-footer { margin-top:-20px; } .login-brand { margin-bottom:48px; } }
  @media(max-width:760px) { body:not(.private-shell) { padding:30px 18px; } .login-layout { grid-template-columns:1fr; width:min(430px,100%); gap:28px; } .login-brand { margin-bottom:28px; } .brand-name { font-size:18px; } h1 { font-size:36px; margin-bottom:0; } .login-story>.eyebrow,.story-copy,.login-principles { display:none; } .login-card { padding:27px; } .private-label { margin-bottom:20px; } .login-footer { grid-column:1; margin-top:0; padding-top:18px; gap:18px; font-size:8px; } .private-shell header { padding:20px 16px; } .panel { padding:24px; } }
  @media(max-width:360px) { .login-card { padding:22px; } h1 { font-size:32px; } h2 { font-size:24px; } .brand-name { font-size:16px; } .brand-caption { font-size:8px; } }
  @media(prefers-reduced-motion:reduce) { * { animation:none!important; transition:none!important; } }
  @media(forced-colors:active) { .login-card,.brand-mark,.private-label,input,button { border:1px solid CanvasText; } }
`;

function loginPage(message = "Acesso privado. Entre com usuário autorizado."): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#090e17">
  <title>Aurora Nexus | Login</title>
  <style>${AURORA_VISUAL_CSS}</style>
</head>
<body>
  <main class="login-layout">
    <section class="login-story" aria-label="Aurora Nexus">
      <div class="login-brand"><span class="brand-mark" aria-hidden="true">A<span>∕</span>N</span><div class="brand-name">AURORA <span>NEXUS</span><small class="brand-caption">GESTÃO SOB EVIDÊNCIA</small></div></div>
      <p class="eyebrow">SEU CENTRO DE COMANDO</p>
      <h1>Decida com<br><span>clareza.</span></h1>
      <p class="story-copy">Inteligência financeira, auditoria e governança. Um ambiente para enxergar o que importa.</p>
      <div class="login-principles"><span><b>01</b>FINANCEIRO</span><span><b>02</b>AUDITORIA</span><span><b>03</b>GOVERNANÇA</span></div>
    </section>
    <section class="login-card" aria-labelledby="login-title">
      <span class="private-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg> ACESSO PRIVADO</span>
      <h2 id="login-title">Acessar o ambiente.</h2>
      <p>${escapeHtml(message)}</p>
      <form id="login-form" autocomplete="on">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="username" required>
        <label for="password">Senha</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button id="submit" type="submit">Entrar no Aurora Nexus →</button>
        <div id="status" class="status" aria-live="polite"></div>
      </form>
      <div class="fineprint">Acesso exclusivo para usuários previamente autorizados.<br>Sem demonstração pública.</div>
    </section>
    <footer class="login-footer"><span>AURORA NEXUS · GESTÃO SOB EVIDÊNCIA</span><span>AMBIENTE RESTRITO</span></footer>
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
  <meta name="theme-color" content="#090e17">
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
