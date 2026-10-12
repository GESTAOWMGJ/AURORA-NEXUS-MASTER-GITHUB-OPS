import type { AuroraMember } from "./auroraAccess.js";
import { accountSecurityClient } from "./auroraAccountSecurityClient.js";
import { auroraDesignStyles } from "./auroraDesignSystem.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Render after the existing session and live membership checks. No account administration API. */
export function accountSecurityPage(member: AuroraMember, logoutCsrf: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aurora Nexus | Segurança da conta</title><style>
${auroraDesignStyles()}
:root{--cream:var(--bg);--petrol:var(--ink)}body{margin:0;background:radial-gradient(ellipse at top left,#e8eee5,transparent 60%),var(--cream);color:var(--text);line-height:1.6}main{max-width:800px;margin:auto;padding:40px 20px}.eyebrow{font-size:12px;letter-spacing:.16em;color:#81632e;font-weight:750}section{background:var(--panel);border:1px solid var(--line);border-top:3px solid var(--gold);border-radius:12px;padding:26px;margin:20px 0;box-shadow:var(--shadow)}h1{font:400 42px/1.12 'Source Serif 4',Georgia,serif;letter-spacing:-.025em;margin:12px 0 18px}h2{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:23px;margin-top:0}label{display:block;margin:14px 0 6px;font-size:14px;font-weight:650}input,select{width:100%;min-height:46px;padding:12px;background:#fff;color:var(--petrol);border:1px solid #a6b1ad;border-radius:8px;font:inherit}input[readonly]{background:var(--panel2)}button,a{display:inline-block;min-height:46px;margin-top:14px;padding:11px 16px;background:var(--petrol);color:#fffdf8;border:1px solid var(--petrol);border-radius:8px;font:inherit;font-weight:650;cursor:pointer;text-decoration:none}button.secondary,a{background:transparent;color:var(--petrol);border-color:#a6b1ad}button:hover:not(:disabled),a:hover{filter:brightness(1.08)}button:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid var(--info);outline-offset:3px}small{color:var(--muted)}code{display:block;overflow-wrap:anywhere;padding:12px;background:var(--panel2);border:1px solid var(--line);border-radius:8px}#security-status{min-height:24px;padding:14px 16px;border-left:3px solid var(--gold);background:var(--panel2);color:#62491d}[hidden]{display:none!important}@media(max-width:520px){main{padding:26px 16px}section{padding:20px}h1{font-size:34px}button,a{width:100%;text-align:center}}
</style></head><body><main><p class="eyebrow">AURORA NEXUS · SUA CONTA</p><h1>Senha e autenticador</h1>
<p>Estas ações alteram somente sua própria conta. Confirme sua senha e o código atual para continuar. A autenticação em dois fatores permanece obrigatória.</p>
<p id="security-status" role="status" aria-live="polite">Confirme sua identidade para habilitar as alterações.</p>
<section aria-labelledby="security-auth-title"><h2 id="security-auth-title">1. Confirmar identidade</h2><form id="security-auth-form">
<label for="security-email">E-mail da sessão</label><input id="security-email" type="email" value="${escapeHtml(member.email)}" readonly autocomplete="username">
<label for="security-password">Senha atual</label><input id="security-password" type="password" autocomplete="current-password" required>
<button id="security-authenticate" type="submit" disabled>Confirmar senha e autenticador</button></form>
<div id="security-mfa-panel" hidden><label for="security-mfa-factor">Autenticador para confirmar este acesso</label><select id="security-mfa-factor"></select>
<label for="security-mfa-code">Código TOTP</label><input id="security-mfa-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8">
<button id="security-mfa-confirm" type="button" disabled>Confirmar código</button></div>
<small>A confirmação vale por até cinco minutos. Uma sessão aberta não substitui essa confirmação.</small></section>
<section aria-labelledby="security-password-title"><h2 id="security-password-title">2. Alterar senha</h2><form id="security-password-form"><label for="security-new-password">Nova senha</label>
<input id="security-new-password" type="password" autocomplete="new-password" required minlength="12"><label for="security-confirm-password">Confirmar nova senha</label>
<input id="security-confirm-password" type="password" autocomplete="new-password" required minlength="12"><small>Use pelo menos 12 caracteres e confirme a mesma senha.</small><button id="security-change-password" type="submit" disabled>Alterar senha e sair</button></form></section>
<section aria-labelledby="security-totp-title"><h2 id="security-totp-title">3. Reconfigurar autenticador</h2><p>Cadastre e confirme o novo autenticador antes de retirar um antigo. Os demais fatores são preservados.</p>
<button id="security-resume-totp" class="secondary" type="button" disabled hidden>Retomar troca com o autenticador confirmado</button>
<p id="security-resume-help" hidden><small>Já cadastrou o substituto? Entre com o código dele e retome. O autenticador usado nesta confirmação será mantido; você poderá retirar somente outro que reconhecer.</small></p>
<button id="security-start-totp" type="button" disabled>Cadastrar novo autenticador</button><div id="security-enrollment" hidden>
<p>Adicione esta chave ao seu aplicativo autenticador. Não compartilhe a chave.</p><code id="security-enrollment-key"></code>
<label for="security-enrollment-code">Código do novo autenticador</label><input id="security-enrollment-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8">
<button id="security-enroll-totp" type="button" disabled>Confirmar novo autenticador</button></div>
<label for="security-old-factor">Autenticador antigo a retirar</label><select id="security-old-factor" disabled></select>
<button id="security-remove-old" type="button" disabled>Retirar somente o antigo selecionado e sair</button>
<p><small>Nunca removemos o último fator. Após cadastrar o novo, entre novamente com a senha e o código do NOVO autenticador para confirmar a troca. Se houver falha, mantenha os fatores e retome a confirmação.</small></p>
<p>Perdeu acesso a todos os autenticadores? Solicite recuperação administrativa com verificação de identidade. Este painel não desativa MFA nem substitui a verificação pelo administrador.</p></section>
<button id="security-exit" type="button">Manter os fatores atuais e sair</button> <a href="/portal">Voltar ao portal</a>
<script type="module">${accountSecurityClient(member, logoutCsrf)}</script></main></body></html>`;
}
