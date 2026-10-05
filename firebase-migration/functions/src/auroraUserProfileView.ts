export function userProfileSection(): string {
  return `<article class="card section" id="user-profiles"><h2>Usuários da empresa</h2><p class="sub">Cada pessoa recebe acesso individual. No primeiro acesso, ela define a senha, confirma o e-mail e cadastra um autenticador.</p>
<form id="user-profile-form" class="action-input-grid"><label>Nome<input id="profile-name" maxlength="80" required></label><label>E-mail<input id="profile-email" type="email" maxlength="254" autocomplete="off" required></label><label>Perfil<select id="profile-role"><option value="viewer">Consulta</option><option value="operator">Operação</option><option value="auditor">Auditoria</option><option value="finance">Financeiro</option><option value="director">Direção</option><option value="org_admin">Administração da empresa</option></select></label><label>Todas as unidades<input id="profile-all" type="checkbox"></label><label class="wide">Unidades autorizadas<input id="profile-facilities" maxlength="2000" placeholder="Identificadores separados por vírgula; exigidos para acesso restrito"></label><button class="btn primary" type="submit">Criar perfil</button></form>
<p id="profile-status" class="sub" aria-live="polite"></p><div id="profile-list" class="activity-list"></div></article>`;
}
export function userProfileClient(): string {
  return `
let profileRequest = null, profileSignature = null;
const profileStatus = document.getElementById('profile-status');
async function loadProfiles() {
  if (!capabilities.manageProfiles || sessionBlocked) return;
  try {
    const response = await fetch('/api/user-profiles', {credentials:'same-origin',cache:'no-store'});
    if (response.status === 401) { stopSessionView(); return; }
    const data = await response.json();
    if (sessionBlocked) return;
    if (!response.ok) { profileStatus.textContent = data.code === 'PROFILE_ENGINE_NOT_ENABLED' ? 'A criação de perfis ainda não foi liberada para esta empresa.' : 'Não foi possível consultar os perfis.'; return; }
    profileForm.querySelector('button').disabled = !data.engineEnabled;
    if (!data.engineEnabled) profileStatus.textContent = 'Novos cadastros estão suspensos. Os acessos existentes continuam disponíveis para revisão e revogação.';
    const list = document.getElementById('profile-list'); list.replaceChildren();
    for (const item of data.profiles) {
      const row = document.createElement('div'); row.className = 'activity-row';
      const label = document.createElement('span'); label.textContent = item.name + ' · ' + item.role + ' · ' + (item.active ? 'Cadastro habilitado' : 'Acesso bloqueado'); row.appendChild(label);
      if (item.managed && (item.active || item.profileState === 'REVOKED')) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = 'Revogar acesso';
        if (!item.active) button.textContent = 'Confirmar revogação';
        button.addEventListener('click', async () => {
          if (!window.confirm('Revogar o acesso de ' + item.name + ' a esta empresa?')) return;
          button.disabled = true;
          try { const r = await fetch('/api/user-profiles', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Aurora-CSRF':csrf.userProfile},body:JSON.stringify({action:'REVOKE',uid:item.uid})}); if (!r.ok) throw new Error('REVOKE_FAILED'); await loadProfiles(); }
          catch { profileStatus.textContent = 'Revogação não confirmada. Atualize a lista antes de tentar novamente.'; button.disabled = false; }
        }); row.appendChild(button);
      }
      list.appendChild(row);
    }
    if (data.truncated) profileStatus.textContent = 'Exibindo os primeiros 100 perfis. Outros cadastros podem existir.';
  } catch { profileStatus.textContent = 'Status dos perfis não confirmado.'; }
}
const profileForm = document.getElementById('user-profile-form');
if (profileForm) profileForm.addEventListener('submit', async event => {
  event.preventDefault(); if (!capabilities.manageProfiles || sessionBlocked) return;
  const payload = {action:'CREATE',email:document.getElementById('profile-email').value.trim(),displayName:document.getElementById('profile-name').value.trim(),role:document.getElementById('profile-role').value,allFacilities:document.getElementById('profile-all').checked,facilityIds:document.getElementById('profile-facilities').value.split(',').map(x => x.trim()).filter(Boolean)};
  if (payload.allFacilities) payload.facilityIds = [];
  const signature = JSON.stringify(payload);
  if (signature !== profileSignature) { profileSignature = signature; profileRequest = crypto.randomUUID(); }
  const button = profileForm.querySelector('button'); button.disabled = true;
  try {
    const response = await fetch('/api/user-profiles',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Aurora-CSRF':csrf.userProfile},body:JSON.stringify({...payload,requestId:profileRequest})});
    const result = await response.json();
    if (sessionBlocked) return;
    if (!response.ok) {
      const messages = {PROFILE_IDENTITY_ALREADY_EXISTS:'Já existe uma identidade com esse e-mail. Peça a revisão do cadastro; nenhuma conta existente foi alterada.',INVALID_PROFILE:'Revise nome, e-mail, perfil e unidades autorizadas.',PROFILE_FACILITY_NOT_ACTIVE:'Uma das unidades informadas não está ativa.',PROFILE_ENGINE_NOT_ENABLED:'A criação de perfis ainda não foi liberada para esta empresa.',PROFILE_BUSY:'Este cadastro está em processamento. Aguarde antes de tentar novamente.',PROFILE_REQUEST_CONFLICT:'O pedido mudou durante o processamento. Solicite revisão.',PROFILE_REQUIRES_REVIEW:'O cadastro exige revisão administrativa.'};
      profileStatus.textContent = messages[result.code] || 'Cadastro não concluído. Tente novamente com os mesmos dados para retomar.'; return;
    }
    profileStatus.textContent = 'Cadastro pronto. A pessoa deve abrir ' + result.loginPath + ', usar “Definir ou redefinir senha” e concluir a verificação de e-mail e o segundo fator. Nenhuma mensagem foi enviada automaticamente.';
    profileRequest = null; profileSignature = null; profileForm.reset(); await loadProfiles();
  } catch { profileStatus.textContent = 'Não foi possível confirmar o cadastro. Tente novamente com os mesmos dados.'; }
  finally { button.disabled = false; }
});
loadProfiles();
`;
}
