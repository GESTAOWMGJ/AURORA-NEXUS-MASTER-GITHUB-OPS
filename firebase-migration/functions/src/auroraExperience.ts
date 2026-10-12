/** Section navigation is presentation only; APIs retain membership/MFA enforcement. */
export function auroraExperienceClient(): string {
  return `
const auroraPageNames={overview:['Seu dia, com clareza.','Os números que merecem atenção e uma próxima ação para cada prioridade.'],finance:['Seu dinheiro, em perspectiva.','Confira vencimentos, saldo e recebimentos antes de decidir.'],actions:['Pendências que avançam.','Registre o que precisa ser feito, acompanhe prazos e conclua com evidência.'],assistant:['Uma próxima ação, explicada.','Peça orientação ao motor do Aurora a partir das fontes da empresa.'],master:['Seu Aurora, em evolução.','Desenvolva melhorias com IA local, revisão de mudanças e verificações.'],settings:['Sua operação, conectada.','Gerencie equipe, fontes e conexões com os acessos da sua conta.'],activity:['O que mudou na operação.','Acompanhe o histórico registrado e os resultados da equipe.']};
const auroraMenu=document.getElementById('portal-navigation'),auroraMenuButton=document.getElementById('menu-toggle');
function closeAuroraMenu(){auroraMenu.classList.remove('menu-open');auroraMenuButton.setAttribute('aria-expanded','false')}
function revealAuroraSection(hash,moveFocus=false){
  const id=(hash||'#overview').slice(1),target=document.getElementById(id),page=target?.closest('[data-page]')||document.getElementById('overview');
  if(!page)return;
  for(const node of document.querySelectorAll('[data-page]'))node.hidden=node!==page;
  const name=page.dataset.page,labels=auroraPageNames[name]||auroraPageNames.overview;
  document.getElementById('page-title').textContent=labels[0];document.getElementById('page-description').textContent=labels[1];
  for(const link of auroraMenu.querySelectorAll('a[href^="#"]')){const destination=document.getElementById(link.getAttribute('href').slice(1));const active=destination?.closest('[data-page]')===page;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}
  closeAuroraMenu();
  if(moveFocus){const destination=target&&page.contains(target)?target:page;destination.closest('details')?.setAttribute('open','');destination.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});const focus=destination.querySelector('h2')||document.getElementById('page-title');focus.tabIndex=-1;focus.focus({preventScroll:true})}
}
auroraMenuButton.addEventListener('click',()=>{const open=auroraMenu.classList.toggle('menu-open');auroraMenuButton.setAttribute('aria-expanded',String(open))});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeAuroraMenu();auroraMenuButton.focus()}});
document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(link&&link.getAttribute('href')!=='#app'&&document.getElementById(link.getAttribute('href').slice(1))){event.preventDefault();const hash=link.getAttribute('href');if(location.hash!==hash)history.pushState(null,'',hash);revealAuroraSection(hash,true)}});
window.addEventListener('hashchange',()=>revealAuroraSection(location.hash,true));window.addEventListener('popstate',()=>revealAuroraSection(location.hash,true));
revealAuroraSection(location.hash);
function renderFinancialFocus(data){const focus=buildFinancialFocus(data);const panel=document.getElementById('financial-focus');panel.className='financial-focus '+focus.tone;txt('focus-title',focus.title);txt('focus-label',focus.label);txt('focus-value',focus.amountCents===null?'Veja o resumo':money(focus.amountCents));txt('focus-explanation',focus.explanation);txt('focus-period',focus.period);const next=document.getElementById('focus-next');next.setAttribute('href',focus.nextHref);next.textContent=focus.nextLabel;document.getElementById('coverage-warning').hidden=!focus.coverageIncomplete;const alerts=document.getElementById('attention-list');alerts.replaceChildren();for(const item of (Array.isArray(data.projection?.alerts)?data.projection.alerts:[]).slice(0,6)){const row=document.createElement('article');row.className='attention-item '+(['HIGH','CRITICAL','ERROR'].includes(item.severity)?'danger':'');const title=document.createElement('b'),detail=document.createElement('p');title.textContent=String(item.title||'Atenção necessária');detail.textContent=String(item.detail||'Confira a fonte antes de decidir.');row.append(title,detail);alerts.append(row)}document.getElementById('attention-empty').hidden=alerts.children.length>0}
`;
}
