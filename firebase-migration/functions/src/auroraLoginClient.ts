import { webUpdateClient } from "./auroraWebUpdateClient.js";
import { userFacingEntryPath } from "./auroraTenantEntry.js";
import { passwordRecoveryClient } from "./auroraPasswordRecovery.js";
// Browser-only security setup. No password, verification link or TOTP secret is sent to application APIs.
export function loginClient(orgId: string | null): string {
  const entryPath = userFacingEntryPath(orgId);
  return `
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, setPersistence, inMemoryPersistence, signInWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, reload, getIdTokenResult, signOut, multiFactor, getMultiFactorResolver, verifyPasswordResetCode, confirmPasswordReset,
  TotpMultiFactorGenerator } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
const orgId = ${JSON.stringify(orgId)};
const entryPath = ['/setup','/account-security'].includes(location.pathname) ? location.pathname : ${JSON.stringify(entryPath)};
const element = id => document.getElementById(id);
const form = element('login-form'), status = element('status'), submit = element('submit');
const normalizeIdentityEmail = value => String(value || '').trim().toLowerCase();
// Capture and remove action material before the first asynchronous Firebase initialization.
let recoveryQueryAtEntry = String(location.search || '');
const recoveryEntryParams = new URLSearchParams(recoveryQueryAtEntry);
const recoveryQueryPresent = recoveryEntryParams.has('oobCode') || recoveryEntryParams.getAll('mode').includes('resetPassword');
if (recoveryQueryPresent) history.replaceState(null, '', location.pathname);
let auth, resolver = null, setupUser = null, totpSecret = null, mfaSessionRetryUser = null;
let onboardingUser = null, onboardingRetrySession = false;
const clearSetup = () => { totpSecret = null; element('enrollment-key').textContent = ''; element('enrollment-code').value = ''; };
window.addEventListener('pagehide', () => { clearSetup(); mfaSessionRetryUser = null; onboardingUser = null; onboardingRetrySession = false; const input = element('registration-password'); if (input) input.value = ''; });
try {
  const config = await fetch('/__/firebase/init.json', {cache:'no-store'});
  if (!config.ok) throw new Error('CONFIG_UNAVAILABLE');
  auth = getAuth(initializeApp(await config.json()));
  auth.languageCode = 'pt-BR';
  await setPersistence(auth, inMemoryPersistence);
} catch { status.textContent = 'Acesso temporariamente indisponível. Tente novamente mais tarde.'; submit.disabled = true; }
${webUpdateClient()}
async function createSession(user) {
  const idToken = await user.getIdToken(true);
  let response = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch('/__sessionLogin', {
        method:'POST', headers:{'Content-Type':'application/json'}, cache:'no-store',
        body:JSON.stringify({ idToken, orgId })
      });
    } catch {
      if (attempt === 0) continue;
      throw new Error('SESSION_TEMPORARY_UNAVAILABLE');
    }
    if (response.ok) break;
    if (response.status >= 500) {
      if (attempt === 0) continue;
      throw new Error('SESSION_TEMPORARY_UNAVAILABLE');
    }
    let code = 'SESSION_DENIED';
    try { code = (await response.json())?.code || code; } catch { /* Keep a generic, non-sensitive denial. */ }
    throw new Error(code);
  }
  if (!response?.ok) throw new Error('SESSION_TEMPORARY_UNAVAILABLE');
  clearSetup(); await signOut(auth); location.replace(entryPath);
}
function accessIssueMessage(error) {
  const code = error?.message || error?.code || '';
  if (code === 'EMAIL_NOT_ALLOWED') return 'E-mail autenticado, mas fora da lista autorizada deste ambiente.';
  if (code === 'MEMBERSHIP_NOT_PROVISIONED') return 'Conta autenticada, mas ainda sem vínculo operacional provisionado na organização.';
  if (code === 'COMPANY_ACCESS_DENIED') return 'Conta autenticada, mas não autorizada para a empresa selecionada.';
  if (code === 'SESSION_DENIED' || code === 'INVALID_LOGIN') return 'Segundo fator aceito, mas a sessão privada foi negada pela autorização do ambiente.';
  if (code === 'SESSION_TEMPORARY_UNAVAILABLE') return 'A autenticação foi aceita, mas o serviço de sessão está temporariamente indisponível. Tente novamente.';
  if (error?.code === 'auth/network-request-failed') return 'Falha de conexão ao confirmar a autenticação. Verifique a internet e tente novamente.';
  if (error?.code === 'auth/too-many-requests') return 'Muitas tentativas em sequência. Aguarde e tente novamente.';
  return 'Segundo fator inválido ou expirado. Gere um novo código no autenticador e tente novamente.';
}
async function completeLogin(user) {
  setupUser = user;
  const token = await getIdTokenResult(user, true);
  const setupRequired = token.claims.auroraProfileVersion !== undefined || element('secure-setup').checked;
  if (!setupRequired || (user.emailVerified && token.claims.firebase?.sign_in_second_factor)) {
    if (token.claims.auroraOnboardingRequired === true) {
      // The server's current membership decides whether onboarding is still pending.
      try { await createSession(user); return; }
      catch (error) {
        if (!['EMAIL_NOT_ALLOWED','MEMBERSHIP_NOT_PROVISIONED'].includes(error?.message)) throw error;
        onboardingUser = user; onboardingRetrySession = false; form.hidden = true; element('mfa-panel').hidden = true;
        element('activation-panel').hidden = true; element('onboarding-panel').hidden = false;
        element('onboarding-status').textContent = 'Conclua o acolhimento para abrir seu acesso individual.';
        return;
      }
    }
    await createSession(user); return;
  }
  form.hidden = true; element('mfa-panel').hidden = true; element('activation-panel').hidden = false;
  element('email-setup').hidden = user.emailVerified;
  element('totp-setup').hidden = !user.emailVerified;
  element('activation-status').textContent = user.emailVerified
    ? 'Cadastre seu aplicativo autenticador para concluir o acesso seguro.'
    : 'Confirme seu e-mail para continuar. Você controla o envio da mensagem abaixo.';
  if (user.emailVerified && multiFactor(user).enrolledFactors.length) {
    await signOut(auth); setupUser = null; clearSetup();
    element('activation-panel').hidden = true; form.hidden = false; submit.disabled = false;
    status.textContent = 'Entre novamente e confirme seu segundo fator.';
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (!auth) return; mfaSessionRetryUser = null; submit.disabled = true; status.textContent = 'Validando acesso...';
  try {
    const email = normalizeIdentityEmail(element('email').value);
    element('email').value = email;
    const credential = await signInWithEmailAndPassword(auth, email, element('password').value);
    element('password').value = ''; await completeLogin(credential.user);
  } catch (error) {
    element('password').value = '';
    if (error?.code === 'auth/multi-factor-auth-required') {
      resolver = getMultiFactorResolver(auth, error);
      const hints = resolver.hints.filter(h => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      element('mfa-factor').replaceChildren();
      for (const hint of hints) { const option = document.createElement('option'); option.value = hint.uid; option.textContent = hint.displayName || 'Autenticador'; element('mfa-factor').appendChild(option); }
      if (hints.length) { form.hidden = true; element('mfa-panel').hidden = false; return; }
      status.textContent = 'O segundo fator cadastrado não é suportado neste ambiente.';
    } else if (error?.message === 'SESSION_TEMPORARY_UNAVAILABLE') {
      status.textContent = accessIssueMessage(error);
    } else if (error?.code === 'auth/network-request-failed') {
      status.textContent = 'Falha de conexão. Verifique a internet e tente novamente.';
    } else if (error?.code === 'auth/too-many-requests') {
      status.textContent = 'Muitas tentativas em sequência. Aguarde alguns instantes e tente novamente.';
    } else {
      status.textContent = 'Acesso não autorizado. Confira seu cadastro e a empresa selecionada.';
    }
    submit.disabled = false;
  }
});
element('mfa-submit').addEventListener('click', async () => {
  const button = element('mfa-submit'); button.disabled = true;
  try {
    if (!resolver && !mfaSessionRetryUser) throw new Error('MFA_REQUIRED');
    // A verified second factor may be reused in memory solely to recheck an unavailable app session.
    // Firebase and the server still validate a fresh token and current organization membership.
    let credential;
    if (mfaSessionRetryUser) {
      credential = {user:mfaSessionRetryUser};
    } else {
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(element('mfa-factor').value, element('mfa-code').value.trim());
      credential = await resolver.resolveSignIn(assertion);
    }
    try {
      await completeLogin(credential.user);
      mfaSessionRetryUser = null;
    } catch (error) {
      mfaSessionRetryUser = error?.message === 'SESSION_TEMPORARY_UNAVAILABLE' || error?.code === 'auth/network-request-failed'
        ? credential.user : null;
      throw error;
    }
  } catch (error) { element('mfa-status').textContent = accessIssueMessage(error); }
  finally { element('mfa-code').value = ''; button.disabled = false; }
});
element('onboarding-submit')?.addEventListener('click', async () => {
  const button = element('onboarding-submit'); button.disabled = true;
  try {
    if (!onboardingUser) throw new Error('ONBOARDING_LOGIN_REQUIRED');
    if (onboardingRetrySession) {
      try { await createSession(onboardingUser); onboardingUser = null; return; }
      catch (error) { if (!['EMAIL_NOT_ALLOWED','MEMBERSHIP_NOT_PROVISIONED'].includes(error?.message)) throw new Error('ONBOARDING_SESSION_RETRY'); }
    }
    const registrationPassword = element('registration-password').value.trim();
    element('registration-password').value = '';
    const idToken = await onboardingUser.getIdToken(true);
    onboardingRetrySession = true; // A lost response may hide a successful, irreversible consumption.
    const response = await fetch('/api/user-profiles', {method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({action:'REDEEM_ONBOARDING',idToken,registrationPassword})});
    if (!response.ok) throw new Error('ONBOARDING_REJECTED');
    try { await createSession(onboardingUser); onboardingUser = null; }
    catch { throw new Error('ONBOARDING_SESSION_RETRY'); }
  } catch (error) { element('onboarding-status').textContent = error?.message === 'ONBOARDING_REJECTED'
      ? 'Senha de cadastro inválida, expirada ou já utilizada. Se o acolhimento já foi concluído, entre novamente; caso contrário, solicite nova emissão ao Gestor Master.'
      : 'Não foi possível confirmar sua sessão. Toque em Concluir cadastro novamente ou entre novamente para retomar o acesso.'; }
  finally { button.disabled = false; }
});
${passwordRecoveryClient()}
element('verify-email').addEventListener('click', async () => {
  const button = element('verify-email'); button.disabled = true;
  try { if (!setupUser) throw new Error('SIGN_IN_REQUIRED'); await sendEmailVerification(setupUser); element('activation-status').textContent = 'Confira seu e-mail e confirme o endereço antes de continuar.'; }
  catch { element('activation-status').textContent = 'Não foi possível enviar agora. Aguarde e tente novamente.'; }
  finally { button.disabled = false; }
});
element('email-confirmed').addEventListener('click', async () => {
  try { if (!setupUser) throw new Error('SIGN_IN_REQUIRED'); await reload(setupUser); await completeLogin(setupUser); }
  catch { element('activation-status').textContent = 'Entre novamente para continuar a configuração.'; }
});
element('start-totp').addEventListener('click', async () => {
  const button = element('start-totp'); button.disabled = true;
  try {
    if (!setupUser?.emailVerified) throw new Error('VERIFIED_EMAIL_REQUIRED');
    totpSecret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(setupUser).getSession());
    element('enrollment-key').textContent = totpSecret.secretKey;
    element('enrollment-input').hidden = false;
    element('activation-status').textContent = 'Adicione esta chave ao seu autenticador e confirme o código. Não compartilhe a chave.';
  } catch { clearSetup(); element('activation-status').textContent = 'Cadastro do segundo fator indisponível. O administrador deve verificar a configuração de autenticação do ambiente.'; button.disabled = false; }
});
element('enroll-totp').addEventListener('click', async () => {
  const button = element('enroll-totp'); button.disabled = true;
  try {
    if (!setupUser || !totpSecret) throw new Error('SETUP_REQUIRED');
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, element('enrollment-code').value.trim());
    await multiFactor(setupUser).enroll(assertion, 'Aurora Nexus');
    clearSetup(); setupUser = null; await signOut(auth);
    element('activation-panel').hidden = true; form.hidden = false; submit.disabled = false;
    status.textContent = 'Segundo fator cadastrado. Entre novamente com sua senha e o código do autenticador.';
  } catch { element('activation-status').textContent = 'Não foi possível confirmar. Verifique o código ou entre novamente para reiniciar a configuração.'; }
  finally { button.disabled = false; }
});
`;
}
