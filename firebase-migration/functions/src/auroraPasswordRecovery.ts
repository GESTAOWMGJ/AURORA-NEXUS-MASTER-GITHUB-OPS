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
let recoveryCode = null, recoveryBusy = false;
const recoveryStatus = element('recovery-status');
function clearRecovery() {
  recoveryCode = null;
  for (const id of ['recovery-link','recovery-new-password','recovery-confirm-password']) element(id).value = '';
  element('recovery-account').textContent = ''; element('new-password-form').hidden = true;
}
function showRecovery() {
  form.hidden = true; element('mfa-panel').hidden = true;
  element('password-recovery-panel').hidden = false;
  element('recovery-email').value = element('email').value.trim();
}
function actionCodeFromLink(value) {
  const link = new URL(value);
  if (link.protocol !== 'https:' || link.searchParams.get('mode') !== 'resetPassword') throw new Error('INVALID_RECOVERY_LINK');
  const code = link.searchParams.get('oobCode');
  if (!code || code.length > 2048) throw new Error('INVALID_RECOVERY_LINK');
  return code;
}
async function validateRecoveryCode(code) {
  if (!auth || recoveryBusy) return;
  recoveryBusy = true; clearRecovery();
  try {
    const email = await verifyPasswordResetCode(auth, code);
    recoveryCode = code;
    element('recovery-account').textContent = 'Conta: ' + email;
    element('new-password-form').hidden = false;
    recoveryStatus.textContent = 'Link válido. Informe e confirme sua nova senha.';
  } catch { clearRecovery(); recoveryStatus.textContent = 'Link inválido, expirado ou já utilizado. Solicite outro link.'; }
  finally { recoveryBusy = false; }
}
element('open-password-recovery').addEventListener('click', () => { clearRecovery(); showRecovery(); recoveryStatus.textContent = ''; });
element('mfa-recovery-help').addEventListener('click', () => {
  element('mfa-status').textContent = 'Se perdeu todos os autenticadores, solicite recuperação ao administrador autorizado. A troca de senha não remove o segundo fator.';
});
element('reset-password').addEventListener('click', async () => {
  const email = element('recovery-email').value.trim();
  if (!email || !email.includes('@')) { recoveryStatus.textContent = 'Informe o e-mail autorizado.'; return; }
  if (!auth || recoveryBusy) return;
  recoveryBusy = true; const button = element('reset-password'); button.disabled = true; clearRecovery();
  try { await sendPasswordResetEmail(auth, email); } catch { /* Same response: no account enumeration. */ }
  finally { recoveryStatus.textContent = 'Se o e-mail estiver autorizado, as instruções de redefinição serão enviadas.'; button.disabled = false; recoveryBusy = false; }
});
element('verify-recovery-link').addEventListener('click', async () => {
  let code;
  try { code = actionCodeFromLink(element('recovery-link').value.trim()); }
  catch { clearRecovery(); recoveryStatus.textContent = 'Cole o link completo de redefinição recebido por e-mail.'; return; }
  await validateRecoveryCode(code);
});
element('new-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!auth || !recoveryCode || recoveryBusy) return;
  const password = element('recovery-new-password').value;
  if (password.length < 12 || password !== element('recovery-confirm-password').value) {
    recoveryStatus.textContent = 'Use pelo menos 12 caracteres e confirme a mesma senha.'; return;
  }
  const code = recoveryCode; recoveryBusy = true;
  const button = element('confirm-password-reset'); button.disabled = true;
  element('recovery-new-password').value = ''; element('recovery-confirm-password').value = '';
  try {
    await confirmPasswordReset(auth, code, password); clearRecovery();
    try { await signOut(auth); } catch { /* Password reset already completed; never present it as failed. */ }
    recoveryStatus.textContent = 'Senha redefinida. Volte ao acesso e entre com a nova senha e seu autenticador.';
  } catch {
    clearRecovery(); recoveryStatus.textContent = 'Não foi possível redefinir. Valide o link novamente ou solicite outro; confira também os requisitos da senha.';
  } finally { button.disabled = false; recoveryBusy = false; }
});
element('recovery-back').addEventListener('click', () => {
  if (recoveryBusy) return;
  clearRecovery(); element('password-recovery-panel').hidden = true; form.hidden = false;
});
window.addEventListener('pagehide', clearRecovery);
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
