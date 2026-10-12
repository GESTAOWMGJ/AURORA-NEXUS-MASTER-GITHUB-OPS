import type { AuroraMember } from "./auroraAccess.js";

function scriptValue(value: string): string { return JSON.stringify(value).replace(/</g, "\\u003c"); }

/** Browser SDK changes only its authenticated user; credentials never reach application APIs. */
export function accountSecurityClient(member: Pick<AuroraMember, "uid" | "email">, logoutCsrf: string): string {
  return `
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, setPersistence, inMemoryPersistence, signInWithEmailAndPassword,
  getIdTokenResult, signOut, reload, updatePassword, multiFactor, getMultiFactorResolver,
  TotpMultiFactorGenerator } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
const expectedUid = ${scriptValue(member.uid)}, expectedEmail = ${scriptValue(member.email.toLowerCase())};
const originalLogoutCsrf = ${scriptValue(logoutCsrf)};
const element = id => document.getElementById(id), status = element('security-status');
let auth = null, projectId = null, resolver = null, verifiedUser = null, totpSecret = null;
let oldFactorIds = [], newFactorId = null, confirmedFactorId = null, resumable = false, rotationUnconfirmed = false, busy = false;
const clearSecrets = () => {
  totpSecret = null;
  for (const id of ['security-password','security-mfa-code','security-new-password','security-confirm-password','security-enrollment-code']) element(id).value = '';
  element('security-enrollment-key').textContent = '';
  element('security-enrollment').hidden = true;
};
const controls = ['security-authenticate','security-mfa-confirm','security-change-password','security-start-totp','security-enroll-totp','security-resume-totp','security-remove-old','security-exit'];
function renderControls() {
  element('security-authenticate').disabled = busy || !auth;
  element('security-mfa-confirm').disabled = busy || !resolver;
  element('security-change-password').disabled = busy || !verifiedUser;
  element('security-start-totp').disabled = busy || !verifiedUser || Boolean(newFactorId) || rotationUnconfirmed;
  element('security-enroll-totp').disabled = busy || !verifiedUser || !totpSecret;
  element('security-resume-totp').disabled = busy || !verifiedUser || !confirmedFactorId || !resumable || Boolean(newFactorId) || rotationUnconfirmed;
  element('security-resume-totp').hidden = !resumable || Boolean(newFactorId) || rotationUnconfirmed;
  element('security-resume-help').hidden = element('security-resume-totp').hidden;
  element('security-remove-old').disabled = busy || !verifiedUser || !newFactorId || rotationUnconfirmed;
  element('security-old-factor').disabled = element('security-remove-old').disabled;
  element('security-exit').disabled = busy;
}
async function operate(action) {
  if (busy) return;
  busy = true; for (const id of controls) element(id).disabled = true;
  try { await action(); } finally { busy = false; renderControls(); }
}
async function requireVerified(user = verifiedUser) {
  if (!user || user.uid !== expectedUid || user.email?.trim().toLowerCase() !== expectedEmail) throw Error('ACCOUNT_MISMATCH');
  const token = await getIdTokenResult(user, true), claims = token.claims;
  const age = Date.now() / 1000 - claims.auth_time;
  if (claims.sub !== expectedUid || claims.aud !== projectId || claims.email?.trim().toLowerCase() !== expectedEmail) throw Error('ACCOUNT_MISMATCH');
  if (user.emailVerified !== true || claims.email_verified !== true || claims.firebase?.sign_in_second_factor !== TotpMultiFactorGenerator.FACTOR_ID) throw Error('MFA_REQUIRED');
  if (!Number.isFinite(claims.auth_time) || age < 0 || age > 300) throw Error('RECENT_LOGIN_REQUIRED');
  return user;
}
function factors(user) {
  const list = multiFactor(user).enrolledFactors;
  if (!Array.isArray(list) || list.some(f => typeof f.uid !== 'string' || !f.uid) || new Set(list.map(f => f.uid)).size !== list.length) throw Error('FACTORS_UNCONFIRMED');
  return list;
}
function factorLabel(factor, fallback) {
  const name = typeof factor.displayName === 'string' && factor.displayName ? factor.displayName : fallback;
  const time = typeof factor.enrollmentTime === 'string' && Number.isFinite(Date.parse(factor.enrollmentTime))
    ? new Date(factor.enrollmentTime).toLocaleString('pt-BR') : 'data não confirmada';
  return name + ' · cadastro: ' + time + ' · ' + factor.uid.slice(-8);
}
function showOldFactors(list) {
  const select = element('security-old-factor'); select.replaceChildren();
  for (const factor of list.filter(f => oldFactorIds.includes(f.uid) && f.factorId === TotpMultiFactorGenerator.FACTOR_ID)) {
    const option = document.createElement('option'); option.value = factor.uid;
    option.textContent = factorLabel(factor, 'Autenticador antigo'); select.appendChild(option);
  }
}
async function acceptedLogin(user, confirmedHint = null) {
  await requireVerified(user); await reload(user);
  const list = factors(user);
  // A token claim alone cannot populate this marker: only a resolved MFA hint
  // from this login, still enrolled after reload, identifies the factor to keep.
  if (!confirmedHint || !list.some(f => f.uid === confirmedHint && f.factorId === TotpMultiFactorGenerator.FACTOR_ID)) throw Error('MFA_REQUIRED');
  confirmedFactorId = confirmedHint;
  resumable = list.length >= 2 && list.some(f => f.uid !== confirmedHint && f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (rotationUnconfirmed) {
    const added = list.filter(f => !oldFactorIds.includes(f.uid) && f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (added.length === 0 && oldFactorIds.every(id => list.some(f => f.uid === id))) {
      rotationUnconfirmed = false; verifiedUser = user; resolver = null; clearSecrets();
      status.textContent = 'Os fatores antigos foram conferidos; não há novo cadastro confirmado. Você pode reiniciar o cadastro.';
      return;
    }
    if (added.length !== 1 || !oldFactorIds.every(id => list.some(f => f.uid === id))) throw Error('ROTATION_UNCONFIRMED');
    newFactorId = added[0].uid; rotationUnconfirmed = false;
    await signOut(auth); verifiedUser = null; resolver = null; confirmedFactorId = null; resumable = false; clearSecrets();
    status.textContent = 'Novo fator localizado. Confirme novamente sua senha e o código do NOVO autenticador antes de retirar um antigo.';
    return;
  }
  if (newFactorId && (confirmedFactorId !== newFactorId || !list.some(f => f.uid === newFactorId && f.factorId === TotpMultiFactorGenerator.FACTOR_ID))) throw Error('ROTATION_UNCONFIRMED');
  verifiedUser = user; resolver = null; element('security-mfa-panel').hidden = true;
  if (newFactorId) showOldFactors(list);
  status.textContent = newFactorId ? 'Autenticador confirmado neste acesso será mantido. Escolha somente outro que deseja retirar.' : 'Identidade confirmada. Você pode alterar sua senha, cadastrar um novo autenticador ou retomar uma troca já iniciada.';
}
function rejected(error) {
  verifiedUser = null; confirmedFactorId = null; resumable = false; clearSecrets();
  status.textContent = error?.message === 'ACCOUNT_MISMATCH' ? 'A identidade confirmada não corresponde à conta desta sessão. Entre novamente com seu próprio acesso.'
    : error?.message === 'RECENT_LOGIN_REQUIRED' ? 'A confirmação expirou. Confirme novamente sua senha e seu autenticador.'
    : newFactorId || rotationUnconfirmed ? 'Troca parcial: o estado final não foi confirmado. Não repita a retirada sem conferir os fatores. Confirme novamente o acesso ou mantenha os fatores e saia.'
    : 'Não foi possível confirmar. Confira a senha e o código do autenticador. Se perdeu todos os fatores, solicite recuperação administrativa verificada.';
}
async function finish(message) {
  verifiedUser = null; resolver = null; confirmedFactorId = null; resumable = false; clearSecrets();
  try { if (auth) await signOut(auth); } catch { /* Still clear the original app cookie. */ }
  try {
    if (!originalLogoutCsrf) throw Error('LOGOUT_UNAVAILABLE');
    const response = await fetch('/__sessionLogout', {method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-Aurora-CSRF':originalLogoutCsrf},body:'{}'});
    if (!response.ok) throw Error('LOGOUT_UNAVAILABLE');
    status.textContent = message + ' Sessão encerrada. Entre novamente com sua senha e seu autenticador.';
    location.replace('/portal');
  } catch { status.textContent = message + ' O encerramento da sessão original não foi confirmado. Toque em Sair novamente antes de continuar.'; }
}
try {
  const response = await fetch('/__/firebase/init.json', {cache:'no-store',credentials:'same-origin',redirect:'error'});
  if (!response.ok) throw Error('CONFIG_UNAVAILABLE');
  const config = await response.json();
  if (typeof config.projectId !== 'string' || !config.projectId) throw Error('CONFIG_UNAVAILABLE');
  projectId = config.projectId; auth = getAuth(initializeApp(config)); await setPersistence(auth, inMemoryPersistence);
} catch { auth = null; status.textContent = 'Configuração da autenticação indisponível. Nenhuma alteração foi realizada.'; }
renderControls();
window.addEventListener('pagehide', () => { verifiedUser = null; resolver = null; confirmedFactorId = null; resumable = false; clearSecrets(); if (auth) void signOut(auth).catch(() => {}); });
element('security-auth-form').addEventListener('submit', async event => {
  event.preventDefault(); await operate(async () => {
    const password = element('security-password').value;
    verifiedUser = null; resolver = null; confirmedFactorId = null; resumable = false; clearSecrets();
    element('security-password').value = '';
    if (!auth || !password) { status.textContent = 'Informe sua senha atual para confirmar a identidade.'; return; }
    try { await acceptedLogin((await signInWithEmailAndPassword(auth, expectedEmail, password)).user); }
    catch (error) {
      if (error?.code === 'auth/multi-factor-auth-required') {
        resolver = getMultiFactorResolver(auth, error);
        const hints = resolver.hints.filter(f => f.factorId === TotpMultiFactorGenerator.FACTOR_ID && (!newFactorId || f.uid === newFactorId));
        element('security-mfa-factor').replaceChildren();
        for (const hint of hints) { const option = document.createElement('option'); option.value = hint.uid; option.textContent = factorLabel(hint, 'Autenticador'); element('security-mfa-factor').appendChild(option); }
        if (!hints.length) { resolver = null; rejected(Error('MFA_REQUIRED')); return; }
        element('security-mfa-panel').hidden = false;
        status.textContent = newFactorId ? 'Informe o código do NOVO autenticador.' : 'Informe o código do autenticador atual.';
      } else rejected(error);
    }
  });
});
element('security-mfa-confirm').addEventListener('click', async () => operate(async () => {
  try {
    if (!resolver) throw Error('MFA_REQUIRED');
    const factorId = element('security-mfa-factor').value, code = element('security-mfa-code').value.trim();
    element('security-mfa-code').value = '';
    if (!resolver.hints.some(f => f.uid === factorId && f.factorId === TotpMultiFactorGenerator.FACTOR_ID) || (newFactorId && factorId !== newFactorId)) throw Error('MFA_REQUIRED');
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(factorId, code);
    await acceptedLogin((await resolver.resolveSignIn(assertion)).user, factorId);
  } catch (error) { rejected(error); }
}));
element('security-password-form').addEventListener('submit', async event => {
  event.preventDefault(); await operate(async () => {
    const password = element('security-new-password').value, confirmation = element('security-confirm-password').value;
    element('security-new-password').value = ''; element('security-confirm-password').value = '';
    try {
      const user = await requireVerified();
      if (password.length < 12 || password !== confirmation) { status.textContent = 'Informe uma nova senha de pelo menos 12 caracteres e a mesma confirmação.'; return; }
      await updatePassword(user, password); await finish('Senha alterada. Os autenticadores foram preservados.');
    } catch (error) { rejected(error); }
  });
});
element('security-start-totp').addEventListener('click', async () => operate(async () => {
  try {
    const user = await requireVerified();
    if (newFactorId || rotationUnconfirmed) throw Error('ROTATION_UNCONFIRMED');
    await reload(user); const list = factors(user);
    if (!list.some(f => f.factorId === TotpMultiFactorGenerator.FACTOR_ID)) throw Error('MFA_REQUIRED');
    oldFactorIds = list.map(f => f.uid);
    totpSecret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession());
    element('security-enrollment-key').textContent = totpSecret.secretKey;
    element('security-enrollment').hidden = false;
    status.textContent = 'Adicione a chave ao novo autenticador e confirme seu código. Nenhum fator antigo será retirado neste passo.';
  } catch (error) { rejected(error); }
}));
element('security-resume-totp').addEventListener('click', async () => operate(async () => {
  try {
    const user = await requireVerified();
    if (!confirmedFactorId || newFactorId || rotationUnconfirmed) throw Error('ROTATION_UNCONFIRMED');
    await reload(user); const list = factors(user);
    if (list.length < 2 || !list.some(f => f.uid === confirmedFactorId && f.factorId === TotpMultiFactorGenerator.FACTOR_ID)
      || !list.some(f => f.uid !== confirmedFactorId && f.factorId === TotpMultiFactorGenerator.FACTOR_ID)) throw Error('LAST_OR_UNKNOWN_FACTOR');
    newFactorId = confirmedFactorId;
    oldFactorIds = list.filter(f => f.uid !== confirmedFactorId).map(f => f.uid);
    clearSecrets(); showOldFactors(list);
    status.textContent = 'Troca retomada com os fatores conferidos no Firebase. O autenticador usado nesta confirmação será mantido. Selecione somente outro que reconheça para retirar.';
  } catch (error) { rejected(error); }
}));
element('security-enroll-totp').addEventListener('click', async () => operate(async () => {
  try {
    const user = await requireVerified();
    if (!totpSecret || newFactorId || rotationUnconfirmed) throw Error('SETUP_REQUIRED');
    const code = element('security-enrollment-code').value.trim(); element('security-enrollment-code').value = '';
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, code);
    rotationUnconfirmed = true;
    await multiFactor(user).enroll(assertion, 'Aurora Nexus');
    await reload(user); const list = factors(user);
    if (!oldFactorIds.every(id => list.some(f => f.uid === id))) throw Error('ROTATION_UNCONFIRMED');
    const added = list.filter(f => !oldFactorIds.includes(f.uid) && f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (added.length !== 1) throw Error('ROTATION_UNCONFIRMED');
    newFactorId = added[0].uid; rotationUnconfirmed = false; verifiedUser = null; resolver = null; confirmedFactorId = null; resumable = false; clearSecrets();
    showOldFactors(list); await signOut(auth);
    status.textContent = 'Novo autenticador cadastrado; os antigos foram preservados. Confirme novamente a senha e o código do NOVO autenticador para retirar somente um antigo, ou mantenha ambos e saia.';
  } catch (error) { rejected(error); }
}));
element('security-remove-old').addEventListener('click', async () => operate(async () => {
  let user = null, selected = null, retained = [];
  try {
    user = await requireVerified();
    if (!newFactorId || confirmedFactorId !== newFactorId || rotationUnconfirmed) throw Error('ROTATION_UNCONFIRMED');
    await reload(user); const list = factors(user); selected = element('security-old-factor').value;
    if (list.length < 2 || selected === newFactorId || !oldFactorIds.includes(selected)
      || !list.some(f => f.uid === selected && f.factorId === TotpMultiFactorGenerator.FACTOR_ID)
      || !list.some(f => f.uid === newFactorId && f.factorId === TotpMultiFactorGenerator.FACTOR_ID)) throw Error('LAST_OR_UNKNOWN_FACTOR');
    retained = list.filter(f => f.uid !== selected).map(f => f.uid);
    await multiFactor(user).unenroll(selected);
    await reload(user); const remaining = factors(user);
    if (remaining.some(f => f.uid === selected) || !retained.every(id => remaining.some(f => f.uid === id))) throw Error('REMOVAL_UNCONFIRMED');
    await finish('Autenticador antigo retirado. O novo e os demais fatores foram preservados.');
  } catch (error) {
    if (user && retained.length) {
      try {
        await reload(user); const remaining = factors(user);
        if (!remaining.some(f => f.uid === selected) && retained.every(id => remaining.some(f => f.uid === id))) {
          await finish('Retirada conferida após resposta interrompida. O novo e os demais fatores foram preservados.');
          return;
        }
        if (remaining.some(f => f.uid === selected) && retained.every(id => remaining.some(f => f.uid === id))) {
          rejected(error); status.textContent = 'Troca parcial: o novo e os fatores antigos continuam cadastrados. Confirme novamente a senha e o NOVO autenticador para retomar, ou mantenha os fatores e saia.';
          return;
        }
      } catch { /* Unknown remote state is not reported as successful removal. */ }
    }
    rejected(error);
  }
}));
element('security-exit').addEventListener('click', async () => operate(() => finish('Os fatores atuais foram mantidos.')));
`;
}
