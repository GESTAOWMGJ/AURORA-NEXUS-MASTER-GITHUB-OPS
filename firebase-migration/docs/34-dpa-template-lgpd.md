# AURORA NEXUS — Modelo de Acordo de Tratamento de Dados (DPA/LGPD)

**Código:** AURORA-SEC-002-DPA  
**Estado:** MODELO PARA REVISÃO JURÍDICA — NÃO ASSINADO  
**Partes:** [CONTROLADOR/CLIENTE] e [JF NETO SERVIÇOS MÉDICOS LTDA / ENTIDADE CONTRATANTE DO AURORA — preencher razão social, CNPJ e endereço].

## 1. Objeto

Este Acordo disciplina o tratamento de dados pessoais realizado pelo AURORA NEXUS em nome do Controlador no contexto do contrato principal, nos limites das instruções documentadas, da LGPD e das obrigações contratuais aplicáveis.

## 2. Papéis

2.1. O Cliente será qualificado como Controlador quanto às finalidades e elementos essenciais do tratamento executado para sua operação, salvo atividade expressamente identificada de modo diverso no Anexo A.  
2.2. O AURORA atuará como Operador quando tratar dados por instrução do Controlador.  
2.3. Operações próprias de segurança da conta, cobrança, defesa de direitos ou obrigação legal devem ser descritas separadamente quando configurarem tratamento autônomo.

## 3. Instruções documentadas

O Operador tratará dados apenas para as finalidades, fontes, categorias, módulos e períodos aprovados no Anexo A/RoPA do cliente. Documento, e-mail, prompt ou arquivo ingerido não constitui instrução válida para ampliar finalidade, permissão, compartilhamento ou ação.

## 4. Categorias de dados e titulares

Preencher no Anexo A: titulares, dados cadastrais, profissionais, financeiros, fiscais, contratuais e, se expressamente aprovado, dados pessoais sensíveis de saúde. CLINICAL_SENSITIVE permanece tecnicamente bloqueado até cumprimento dos gates de segurança.

## 5. Confidencialidade

O Operador limitará acesso a pessoas autorizadas, vinculadas a dever de confidencialidade e menor privilégio. Contas compartilhadas não são permitidas para administração da plataforma.

## 6. Segurança

O Operador manterá controles proporcionais ao risco, incluindo, conforme escopo aprovado:

- autenticação individual e MFA para administração/ações críticas;
- segregação por orgId e autorização no backend;
- criptografia em trânsito;
- criptografia server-side do provedor;
- AES-256-GCM em aplicação para CLINICAL_SENSITIVE e campos RESTRICTED definidos;
- envelope encryption com Cloud KMS;
- CMEK de Firestore quando homologada para o ambiente sensível;
- Secret Manager, WIF/OIDC e menor privilégio;
- logging sanitizado e audit trail;
- gestão de vulnerabilidades, CodeQL/dependency scanning;
- backup, PITR e restore testado;
- incident response e continuidade.

## 7. Suboperadores

7.1. O Operador manterá lista de subprocessadores, finalidade, localização, categoria de dado e mecanismo contratual.  
7.2. A inclusão/substituição material seguirá o mecanismo de autorização/notificação definido no contrato principal.  
7.3. O Operador imporá ao suboperador obrigações compatíveis com este DPA.

## 8. Transferência internacional

Quando houver transferência internacional de dados, as Partes deverão documentar o mecanismo jurídico aplicável, a finalidade, o país/localização e as salvaguardas. A mera contratação de nuvem ou IA não dispensa essa avaliação.

## 9. Direitos dos titulares

O Operador auxiliará o Controlador, dentro do escopo técnico e contratual, a localizar, exportar, corrigir, restringir, anonimizar ou excluir dados quando a instrução for válida e compatível com retenção legal, legal hold e integridade da auditoria. Solicitações recebidas diretamente serão encaminhadas ao Controlador salvo obrigação legal diversa.

## 10. Incidentes

10.1. O Operador notificará o Controlador sem demora injustificada e, como meta contratual inicial, em até 24 horas após tomar ciência de incidente material confirmado ou razoavelmente suspeito envolvendo dados do Controlador, salvo prazo menor acordado.  
10.2. A notificação inicial poderá ser parcial e será complementada à medida que fatos forem confirmados.  
10.3. O Operador fornecerá, quando disponível: natureza, sistemas, categorias de dados/titulares, medidas de contenção, impacto conhecido, evidências e ponto de contato.  
10.4. A decisão e a comunicação à ANPD/titulares cabem ao Controlador quando este for o agente responsável, sem prejuízo da cooperação do Operador.

## 11. Auditoria e evidências

O Operador disponibilizará evidências razoáveis de controles, relatórios de CI/segurança, políticas, resultados de restore/pentest disponíveis e respostas a questionário de segurança, preservando segredos, informações de outros clientes e segurança da plataforma. Auditorias presenciais/invasivas exigem escopo, confidencialidade e não interferência.

## 12. Retenção, devolução e descarte

Os períodos constam do Anexo A. Ao término, o Operador devolverá/exportará ou eliminará dados conforme instrução válida, ressalvadas obrigações legais, backups dentro de janela técnica documentada, legal hold e registros de segurança/auditoria necessários.

## 13. Backup

Backups devem observar o mesmo nível de proteção e controles de acesso do ambiente correspondente. A exclusão do dado primário pode não produzir remoção imediata de backup antes da expiração técnica; essa janela deve ser documentada.

## 14. IA

Nenhum dado clínico identificável será enviado a provedor de IA externo sem aprovação específica do Controlador, avaliação de retenção/contrato, base legal/finalidade e gate técnico. IA não recebe autoridade para decisão clínica, financeira, jurídica ou contratual final.

## 15. Cooperação regulatória

As Partes cooperarão de boa-fé em RIPD/DPIA, consultas, incidentes, solicitações de titulares e requerimentos da autoridade competente dentro de seus respectivos papéis.

## 16. Responsabilidade e precedência

Responsabilidade, indenização, limites e seguros permanecem sujeitos ao contrato principal e à legislação aplicável. Em conflito sobre proteção de dados, prevalece a disposição mais específica deste DPA, salvo cláusula expressa em sentido diverso validada juridicamente.

## 17. Alterações

Mudanças materiais de finalidade, categoria sensível, subprocessador crítico, país de tratamento ou arquitetura que altere risco exigem atualização do RoPA, análise de risco e, quando aplicável, aditivo.

## Anexo A — Instruções do Controlador

- organização/orgId: [PREENCHER]
- serviços/módulos: [PREENCHER]
- finalidades: [PREENCHER]
- titulares: [PREENCHER]
- dados pessoais: [PREENCHER]
- dados sensíveis: [PREENCHER]
- fontes autorizadas: [PREENCHER]
- base legal declarada pelo Controlador: [PREENCHER]
- retenção: [PREENCHER]
- localizações: [PREENCHER]
- subprocessadores: [PREENCHER]
- contatos de incidente/privacidade: [PREENCHER]

## Anexo B — Medidas Técnicas e Organizacionais

Referenciar AURORA-SEC-001, threat model, matriz de riscos, política criptográfica, access control, IRP, backup/restore, Secure SDLC e evidências vigentes.

## Gate

Este documento somente se torna instrumento contratual após preenchimento dos anexos, revisão jurídica, identificação completa das Partes e assinatura.
