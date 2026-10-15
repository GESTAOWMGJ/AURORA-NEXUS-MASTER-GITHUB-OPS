// Recovery material is handled only by the Firebase browser SDK, in memory.
export function passwordRecoveryMarkup(): string {
  return `<section id="password-recovery-panel" hidden aria-labelledby="password-recovery-title">
    <h2 id="password-recovery-title">Redefinir senha</h2>
    <p>Receba o link no seu e-mail. Você também pode colar o link recebido para definir a nova senha aqui.</p>
    <label for="recovery-email">E-mail da conta</label><input id="recovery-email" type="email" autocomplete="username" required>
    <button id="reset-password" type="button">Enviar link de recuperação</button>
    <label for="recovery-link">Link de recuperação recebido por e-mail</label><input id="recovery-link" type="password" autocomplete="off" maxlength="4096">
    <button id="verify-recovery-link" class="secondary" type="button">Validar link</button>
    <form id="new-password-form" hidden>
      <p id="recovery-account"></p>
      <label for="recovery-new-password">Nova senha</label><input id="recovery-new-password" type="password" autocomplete="new-password" minlength="12" maxlength="4096" required>
      <label for="recovery-confirm-password">Confirmar nova senha</label><input id="recovery-confirm-password" type="password" autocomplete="new-password" minlength="12" maxlength="4096" required>
      <p>Use pelo menos 12 caracteres. Redefinir a senha mantém o segundo fator da conta.</p>
      <button id="confirm-password-reset" type="submit">Salvar nova senha</button>
    </form>
    <button id="recovery-back" class="secondary" type="button">Voltar ao acesso</button>
    <div id="recovery-status" class="status" role="status" aria-live="polite"></div>
  </section>`;
}

// Uses the login client's auth/element/form variables; no application API receives a password or action code.
export function passwordRecoveryClient(): string {
  return `
let recoveryCode = null, recoveryBusy = false, recoveryCooldownUntil = 0;
let authFocusActive = true, authFocusRevision = 0;
const recoveryStatus = element('recovery-status');
function captureAuthFocus() { return { element: document.activeElement, revision: authFocusRevision }; }
function focusVisibleAuthField(id, previousFocus = null) {
  const field = element(id), active = document.activeElement;
  if (!authFocusActive || !field || field.disabled || field.closest('[hidden]') || !field.getClientRects().length) return;
  if (previousFocus && (previousFocus.revision !== authFocusRevision || (active && active !== previousFocus.element && active !== document.body))) return;
  field.focus();
}
const normalizeRecoveryEmail = value => String(value || '').trim().toLowerCase();
const validRecoveryEmail = value => {
  if (!value || value.length > 254 || value.includes(' ')) return false;
  const at = value.indexOf('@');
  return at > 0 && at === value.lastIndexOf('@') && value.lastIndexOf('.') > at + 1 && value[value.length - 1] !== '.';
};
const genericRecoveryMessage = 'Se o e-mail estiver autorizado, as instruções de redefinição serão enviadas.';
const recoveryHosts = new Set([
  'auroranexus.com.br',
  'wmgj-hml-jfn-20260927.web.app',
  'wmgj-hml-jfn-20260927.firebaseapp.com'
]);
function clearRecovery() {
  recoveryCode = null;
  for (const id of ['recovery-link','recovery-new-password','recovery-confirm-password']) element(id).value = '';
  element('recovery-account').textContent = ''; element('new-password-form').hidden = true;
}
function showRecovery(moveFocus = false) {
  form.hidden = true; element('mfa-panel').hidden = true;
  element('password-recovery-panel').hidden = false;
  element('recovery-email').value = normalizeRecoveryEmail(element('email').value);
  if (moveFocus) focusVisibleAuthField('recovery-email');
}
function actionCodeFromLink(value) {
  const link = new URL(value);
  const modes = link.searchParams.getAll('mode'), codes = link.searchParams.getAll('oobCode');
  if (link.protocol !== 'https:' || !recoveryHosts.has(link.hostname.toLowerCase())
      || modes.length !== 1 || modes[0] !== 'resetPassword' || codes.length !== 1
      || !/^[A-Za-z0-9_-]{1,2048}$/.test(codes[0] || '')) throw new Error('INVALID_RECOVERY_LINK');
  return codes[0];
}
async function validateRecoveryCode(code, moveFocus = false) {
  if (!auth || recoveryBusy) return;
  const previousFocus = captureAuthFocus();
  recoveryBusy = true; clearRecovery();
  try {
    const email = await verifyPasswordResetCode(auth, code);
    recoveryCode = code;
    element('recovery-account').textContent = 'Conta: ' + email;
    element('new-password-form').hidden = false;
    recoveryStatus.textContent = 'Link válido. Informe e confirme sua nova senha.';
    if (moveFocus) focusVisibleAuthField('recovery-new-password', previousFocus);
  } catch { clearRecovery(); recoveryStatus.textContent = 'Link inválido, expirado ou já utilizado. Solicite outro link.'; }
  finally { recoveryBusy = false; }
}
element('open-password-recovery').addEventListener('click', () => { clearRecovery(); showRecovery(true); recoveryStatus.textContent = ''; });
element('mfa-recovery-help').addEventListener('click', () => {
  element('mfa-status').textContent = 'Se perdeu todos os autenticadores, solicite recuperação ao administrador autorizado. A troca de senha não remove o segundo fator.';
});
element('reset-password').addEventListener('click', async () => {
  const email = normalizeRecoveryEmail(element('recovery-email').value);
  element('recovery-email').value = email;
  if (!validRecoveryEmail(email)) { recoveryStatus.textContent = 'Informe um e-mail válido.'; return; }
  if (!auth || recoveryBusy) return;
  if (Date.now() < recoveryCooldownUntil) { recoveryStatus.textContent = genericRecoveryMessage; return; }
  recoveryBusy = true; const button = element('reset-password'); button.disabled = true; clearRecovery();
  try {
    await sendPasswordResetEmail(auth, email);
    recoveryCooldownUntil = Date.now() + 60 * 1000;
    recoveryStatus.textContent = genericRecoveryMessage;
  } catch (error) {
    if (error?.code === 'auth/network-request-failed' || error?.code === 'auth/internal-error') {
      recoveryCooldownUntil = Date.now() + 15 * 1000;
      recoveryStatus.textContent = 'Serviço de recuperação temporariamente indisponível. Aguarde e tente novamente.';
    } else if (error?.code === 'auth/too-many-requests') {
      recoveryCooldownUntil = Date.now() + 60 * 1000;
      recoveryStatus.textContent = 'Muitas solicitações em sequência. Aguarde antes de tentar novamente.';
    } else {
      recoveryCooldownUntil = Date.now() + 60 * 1000;
      recoveryStatus.textContent = genericRecoveryMessage;
    }
  } finally { button.disabled = false; recoveryBusy = false; }
});
element('verify-recovery-link').addEventListener('click', async () => {
  let code;
  try { code = actionCodeFromLink(element('recovery-link').value.trim()); }
  catch { clearRecovery(); recoveryStatus.textContent = 'Cole o link completo de redefinição recebido por e-mail.'; return; }
  await validateRecoveryCode(code, true);
});
element('new-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!auth || !recoveryCode || recoveryBusy) return;
  const password = element('recovery-new-password').value;
  if (password.length < 12 || password !== element('recovery-confirm-password').value) {
    recoveryStatus.textContent = 'Use pelo menos 12 caracteres e confirme a mesma senha.'; return;
  }
  const code = recoveryCode; recoveryBusy = true;
  const previousFocus = captureAuthFocus();
  const button = element('confirm-password-reset'); button.disabled = true;
  element('recovery-new-password').value = ''; element('recovery-confirm-password').value = '';
  try {
    await confirmPasswordReset(auth, code, password); clearRecovery();
    try { await signOut(auth); } catch { /* Password reset already completed; never present it as failed. */ }
    recoveryStatus.textContent = 'Senha redefinida. Volte ao acesso e entre com a nova senha e seu autenticador.';
    focusVisibleAuthField('recovery-back', previousFocus);
  } catch {
    clearRecovery(); recoveryStatus.textContent = 'Não foi possível redefinir. Valide o link novamente ou solicite outro; confira também os requisitos da senha.';
  } finally { button.disabled = false; recoveryBusy = false; }
});
element('recovery-back').addEventListener('click', () => {
  if (recoveryBusy) return;
  clearRecovery(); element('password-recovery-panel').hidden = true; form.hidden = false;
  focusVisibleAuthField(element('email').value.trim() ? 'password' : 'email');
});
window.addEventListener('pagehide', () => { authFocusActive = false; authFocusRevision++; clearRecovery(); });
window.addEventListener('pageshow', () => { authFocusActive = true; });
const recoveryParams = new URLSearchParams(location.search || '');
if (recoveryParams.get('mode') === 'resetPassword') {
  const code = recoveryParams.get('oobCode');
  history.replaceState(null, '', location.pathname);
  showRecovery();
  if (code && code.length <= 2048) await validateRecoveryCode(code);
  else recoveryStatus.textContent = 'Link inválido. Solicite outro link de recuperação.';
}
`;
}
