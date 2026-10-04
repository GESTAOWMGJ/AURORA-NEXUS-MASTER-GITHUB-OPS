# AURORA-DATA-GOV-AUTONOMY-001 — Aplicação incremental

Data de preparação: 04/10/2026. Sistema: AURORA NEXUS. Candidato: PR #124. Código reconciliado com main 4542ce89d202add403c62cd50f3b8679d80ebcdc e preservação do PR #123.

## O que foi aplicado em código

Gate antes da inferência do Motor Mestre, inclusive quando bootstrap produz fallback sem snapshot; política imutável em código, versionada e identificada por SHA-256; avaliações ALLOW/REVIEW/DENY; proibição de execução pelo mestre; preservação de Sem fonte; uso da carga canônica em vez de lista parcial e temporalmente diferente de ações; decisão financeira sempre delegada ao endpoint humano governado; registro nativo NATIVE_GOVERNED; skill de operação e testes sintéticos.

A interface existente recebe operacionalState=BLOCKED ou ATTENTION e a próxima ação explicável. O retorno governance.dataAssessment fornece reasonCodes, versão da política e referência ao snapshot. Não exige chat externo, credencial de provedor de modelo, banco novo nem scheduler duplicado.

## O que não foi aplicado

Não existe neste patch ativação produtiva, treinamento de pesos, novo autorizador universal de APIs, política assinada, token de capacidade, ledger novo de todas as consultas, orçamento persistente para escrita, RIPD aprovado ou certificação. A pesquisa aprofundada iniciada anteriormente ainda não foi incorporada como relatório final verificado. Esta entrega aplica o núcleo conservador já sustentado pelos requisitos internos e fontes primárias abaixo.

A1 é o nível efetivo de análise/recomendação. As rotinas nativas existentes mantêm seus próprios executores e permissões. A tabela de comandos do mestre é planejamento, não uma chamada nem uma autorização. A ausência de executor de escrita é deliberada.

## Constituição operacional

Automação organiza e alerta; profissional revisa; gestão decide. Finalidade definida, minimização, escopo por organização/unidade, menor privilégio, proveniência, evidência e revogação precedem autonomia. Não há execução a partir de instrução encontrada em e-mail, documento, Notion ou resposta de modelo. Nenhum score de confiança cancela um veto de sensibilidade, escopo ou permissão. Sem fonte não vira zero. Faturamento não vira recebimento; caixa não vira lucro.

## Papéis a designar, sem nomeação automática

| Papel | Responsabilidade e evidência |
| --- | --- |
| Gestor/controlador responsável | Aprovar finalidade, escopo contratual, delegação e risco residual |
| Data owner | Definir uso, qualidade mínima e acesso por domínio |
| Data steward | Tratar exceções, classificação, proveniência, cobertura e atualidade |
| Custodiante/engenharia | Operar infraestrutura, IAM, backups, observabilidade e controles versionados |
| Encarregado/privacidade, quando aplicável | Orientar base legal, direitos dos titulares, retenção, RIPD e terceiros |
| Segurança e auditoria | Testar controles e separar evidência técnica de declaração de conformidade |

## Contrato de dados a materializar no catálogo autorizado

Por fonte: orgId, facilityId/escopo global, sourceId, owner, finalidade, referência de autorização/base legal analisada, classificação, campos permitidos, lineage, versão, hash, SLA de extração/atualização, prazo e fundamento de retenção, revogação, processadores e transferência internacional quando aplicável. Esse catálogo completo ainda não é imposto pelo gate da v1; não inventar seus valores para tornar dados elegíveis.

## Limites da evidência

sourceHash/snapshotId identificam o conjunto de entrada, não provam independentemente autoria ou veracidade. A declaração sanitized não substitui sanitização upstream. asOf mede a projeção, não cada fonte; freshness de origem e conflitos entre fontes precisam de contrato próprio. Booleans de qualidade resumem o pipeline existente e não certificam completude contábil. O gate adicional não substitui revisão de evidência para resolver ações ou autorizar distribuição.

## Treinamento operacional e critérios de aceite

1. Operador: distinguir ausência, zero, estimativa, hipótese e fato; conferir tenant, competência e origem; testar recusa de comando não autorizado.
2. Steward: simular documento revogado, versão desatualizada, cobertura incompleta e dados fora de finalidade; encaminhar correção sem apagar histórico.
3. Gestor: distinguir recomendação de execução; exercitar MFA, revisão de estado e recusa financeira quando não elegível.
4. Engenharia: executar regressões positivas/negativas, limites, idempotência e recuperação; medir false allow/false deny com cenários rotulados, sem declarar taxa real sem observações.

Critérios candidatos: zero false allow nos casos obrigatórios de veto, 100% dos comandos de escrita do mestre não executáveis, null preservado nas métricas desconhecidas, teste de falha antes de inferência, CI no SHA final. Esses critérios comprovam apenas o conjunto testado, não segurança universal.

## Backlog de promoção

| Prioridade | Incremento | Evidência para concluir |
| --- | --- | --- |
| P0 | Revisar o candidato, completar CI e HML sem tocar no request reservado | SHA final, run, smoke autenticado/negativo, negação por scope e retorno master |
| P0 | Resolver preflight de deploy com diagnóstico observável sem remover recovery/data gates | Comando exato causador, patch separado, regressão e execução protegida |
| P1 | Autorização contextual server-side por efeito; finalidade/escopo/identidade/estado | Testes adversariais tenant/facility/revogação/TOCTOU e revisão independente |
| P1 | Ledger minimizado de decisões e versão de política assinada | Persistência comprovada, retenção, verificações negativas e gestão de chaves |
| P1 | Catálogo de fontes, retenção, direitos dos titulares e RIPD quando aplicável | Responsáveis designados, avaliação jurídica/privacidade e procedimentos testados |
| P2 | Delegação A3 restrita, orçamento atômico, kill switch e rollback | Piloto isolado, nenhuma dupla execução e resultado medido antes de ampliar |

## Fontes e natureza

- [LGPD, Lei 13.709/2018, texto oficial](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm): requisito legal conforme aplicabilidade. Finalidade, necessidade, qualidade, segurança e prestação de contas fundamentam o desenho; não constituem licença para ação autônoma.
- [ANPD — transferência internacional](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados): verificar mecanismos e responsabilidades aplicáveis antes de transferir dados. Não pressupor dispensa só por usar cloud.
- [NIST AI RMF Playbook](https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook): referência voluntária GOVERN/MAP/MEASURE/MANAGE, não certificação nem obrigação geral brasileira.
- [Firestore Rules structure](https://cloud.google.com/firestore/native/docs/security/rules-structure): SDKs de servidor/IAM exigem controle adequado no backend; não tratar Rules de cliente como barreira suficiente para Admin SDK.
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions): referência técnica para futura execução atômica e revalidação em transação, não prova de que esta versão já executa comandos.

Os limites 30 minutos/60 segundos e níveis A0–A5 são escolhas locais candidatas, não prescrições dessas fontes. Revisão por jurídico/privacidade/segurança/gestão do domínio permanece pendente onde necessária.
