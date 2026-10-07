import { webUpdateClient } from "./auroraWebUpdateClient.js";
// Browser-only security setup. No password, verification link or TOTP secret is sent to application APIs.
export function loginClient(orgId: string | null): string {
  return `
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, setPersistence, inMemoryPersistence, signInWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, reload, getIdTokenResult, signOut, multiFactor, getMultiFactorResolver,
  TotpMultiFactorGenerator } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
const orgId = ${JSON.stringify(orgId)};
const entryPath = location.pathname === '/setup' ? '/setup' : (orgId ? '/' + orgId : '/');
const element = id => document.getElementById(id);
const form = element('login-form'), status = element('status'), submit = element('submit');
let auth, resolver = null, setupUser = null, totpSecret = null;
const clearSetup = () => { totpSecret = null; element('enrollment-key').textContent = ''; element('enrollment-code').value = ''; };
window.addEventListener('pagehide', clearSetup);
try {
  const config = await fetch('/__/firebase/init.json', {cache:'no-store'});
  if (!config.ok) throw new Error('CONFIG_UNAVAILABLE');
  auth = getAuth(initializeApp(await config.json()));
  await setPersistence(auth, inMemoryPersistence);
} catch { status.textContent = 'Acesso temporariamente indisponível. Tente novamente mais tarde.'; submit.disabled = true; }
${webUpdateClient()}
async function createSession(user) {
  const idToken = await user.getIdToken(true);
  const response = await fetch('/__sessionLogin', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ idToken, orgId })});
  if (!response.ok) throw new Error('SESSION_DENIED');
  clearSetup(); await signOut(auth); location.replace(entryPath);
}
async function completeLogin(user) {
  setupUser = user;
  const token = await getIdTokenResult(user, true);
  const setupRequired = token.claims.auroraProfileVersion !== undefined || element('secure-setup').checked;
  if (!setupRequired || (user.emailVerified && token.claims.firebase?.sign_in_second_factor)) {
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
  event.preventDefault(); if (!auth) return; submit.disabled = true; status.textContent = 'Validando acesso...';
  try {
    const credential = await signInWithEmailAndPassword(auth, element('email').value.trim(), element('password').value);
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
    } else { status.textContent = 'Acesso não autorizado. Confira seu cadastro e a empresa selecionada.'; }
    submit.disabled = false;
  }
});
element('mfa-submit').addEventListener('click', async () => {
  const button = element('mfa-submit'); button.disabled = true;
  try {
    if (!resolver) throw new Error('MFA_REQUIRED');
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(element('mfa-factor').value, element('mfa-code').value.trim());
    const credential = await resolver.resolveSignIn(assertion);
    element('mfa-code').value = ''; await completeLogin(credential.user);
  } catch { element('mfa-status').textContent = 'Segundo fator inválido, expirado ou acesso não autorizado.'; }
  finally { button.disabled = false; }
});
element('reset-password').addEventListener('click', async () => {
  const email = element('email').value.trim();
  if (!email || !email.includes('@')) { status.textContent = 'Informe o e-mail autorizado.'; return; }
  if (!auth) return;
  const button = element('reset-password'); button.disabled = true;
  try { await sendPasswordResetEmail(auth, email); } catch { /* No account enumeration. */ }
  finally { status.textContent = 'Se o e-mail estiver autorizado, as instruções de redefinição serão enviadas.'; button.disabled = false; }
});
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
