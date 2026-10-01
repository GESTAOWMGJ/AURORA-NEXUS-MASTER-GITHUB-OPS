# AURORA NEXUS — App como entrada principal da gestão

Data: 2026-10-01  
Escopo: tenant-piloto WMGJ / homologação controlada.

## Decisão operacional

A interface autenticada do Aurora Nexus passa a ser o ponto principal de entrada da gestão. O chat deixa de ser dependência operacional para registrar, acompanhar e priorizar trabalho.

Fluxo esperado:

```text
gestor abre web app ou cliente instalável
→ registra ação estruturada
→ ação entra no Firestore com trilha de auditoria
→ status e SLA aparecem no próprio app
→ fontes/conectores alimentam a projeção
→ gestor inicia, acompanha e resolve com evidência
```

## Capacidades desta mudança

- registro estruturado de ação gerencial diretamente no app, com título, contexto, prioridade, prazo e competência;
- alvo `managementInput` persistido em `managerInputs`, separado do documento-fonte;
- painel com abertas, em andamento, concluídas e vencidas;
- registro de atividade recente e leitura de fontes da projeção;
- atualização automática da tela em até 60 s enquanto visível;
- gestão de chaves de integração no próprio app para administradores com MFA;
- PWA instalável com manifesto e service worker sem cache de dados privados;
- clientes Mac/Windows continuam sendo lançadores do mesmo portal, portanto recebem a interface atualizada na próxima abertura;
- conectores plug-and-play do coletor permanecem no mesmo branch: Drive → extração contínua → Firebase e integração externa com segredos fora do manifesto.

## Guardrails mantidos

- login obrigatório, sessão HttpOnly e CSRF por rota;
- segregação por organização e RBAC;
- chave de integração bruta exibida uma única vez;
- nenhum segredo em GitHub, logs ou configuração pública;
- nenhuma baixa financeira, pagamento ou aceite de glosa automático;
- fechamento de ação auditável continua exigindo evidência quando aplicável;
- documentos-fonte não são movidos ou apagados pelo app;
- esta mudança não autoriza merge ou deploy automático.

## Critério para promoção

1. CI do PR no SHA final verde;
2. revisão humana do diff;
3. teste autenticado em homologação: login, criação de ação, início, refresh, integração e logout;
4. confirmação de que o app lista o registro real de ações WMGJ sem dados sintéticos;
5. deploy HML somente pelo workflow protegido e a partir da `main` validada.

