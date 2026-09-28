# AURORA NEXUS — ciclo orgânico e retomada 1.2.0

Data: 28/09/2026. Extensão AURORA-ORG-001, no mesmo PR #38. Derivada da integração 1.1.0 e da regra de continuidade desktop 1.1.1. Não altera a versão registral, a identidade do aplicativo original ou a arquitetura de armazenamento.

## Entrega executável

A integração existente já recebia REWORK, VALIDATED_DECISION, BILLING_EXCEPTION e SECTOR_NEED ligados a uma ação resolvida, com referências verificadas. Esta versão acrescenta composição de planos de revisão, relatórios executáveis limitados, realimentação por resultados e retomada de comandos com retorno incerto.

O módulo auroraOrganicLearning.ts deriva planos do checkpoint já revalidado. Três casos e três referências válidas, na mesma categoria e setor, continuam sendo o limiar de composição. O limiar é regra operacional, não demonstração de independência estatística ou suficiência para decisões financeiras.

| Sinal | Ferramenta composta | Parte substantiva ainda humana |
|---|---|---|
| REWORK | REWORK_CHECKLIST | Causa do retrabalho e adequação da correção |
| VALIDATED_DECISION | DECISION_REGISTER | Aplicabilidade da decisão a um novo caso |
| BILLING_EXCEPTION | EXCEPTION_REGISTER | Confronto contratual, produção, nota e crédito bancário |
| SECTOR_NEED | SECTOR_INVENTORY | Capacidade, prioridade e alteração do processo |

Cada plano possui identificador estável, versão do compilador, fingerprint, setor, categoria, passos permitidos e seis verificações de contrato: integridade da definição; evidência atual; limiar e cobertura; organização/setor/categoria; compatibilidade template-sinal; leitura limitada. Essas verificações em runtime não são apresentadas como teste nativo, avaliação clínica ou homologação do ambiente.

EXECUTE, depois de aprovação e MFA, mantém a contagem de sinais e produz relatório com casos opacos agrupados, quantidade de evidências e checklist. Somente vínculo de evidência atual e agrupamento são marcados VERIFIED_BY_RUNTIME. Causa, decisão, confronto financeiro, capacidade e avaliação do resultado ficam PENDING_HUMAN_REVIEW. O executor não aprova esses itens por inferência.

## Aprendizagem e manutenção

O ciclo é recalculado em cada consulta autorizada e após os comandos operacionais. Necessidades abaixo do limiar não geram ferramenta executável. A mesma necessidade, definição e recomendação mantém o mesmo identificador; reler não fabrica uma ferramenta nova.

Resultados observados são ligados à execução existente. BENEFIT sugere CONTINUE_OBSERVATION; NO_BENEFIT sugere REFINE_FOR_REVIEW; ADVERSE produz SUSPEND_AND_REVIEW e suspende o piloto. Sem resultado, MEASURE_PILOT. Evidência insuficiente exige REVALIDATE_EVIDENCE. Uma candidata sem aprovação atual requer REVIEW_CANDIDATE.

A avaliação atual utiliza somente resultados da revisão e fingerprint atuais, com autor, executor e fontes revalidados. Fontes alteradas/revogadas e resultados de versões anteriores não sustentam benefício atual. O histórico não é apagado. Repetições sobre o mesmo conjunto contam como uma observação, não como amostras independentes.

Histórico adverso é mantido conservadoramente mesmo quando as evidências antigas deixam de ser elegíveis. Não há reativação automática nem endpoint de limpeza desse alerta neste incremento. A resolução desse bloqueio exige revisão de governança e desenvolvimento/homologação do procedimento correspondente; não apagar o resultado para liberar a ferramenta.

O componente produz indicação de manutenção, não modifica livremente o próprio código. São composições de quatro famílias de templates e um executor limitado. Novos executores, integrações, conteúdo documental, escrita operacional ou lógica financeira exigem implementação e autorização próprias. Não há treinamento automático de modelos nem mensuração quantitativa de tempo, redução causal de retrabalho ou receita recuperada nesta versão; measuredFinancialGain permanece null.

## Continuidade, aprovação e armazenamento

Nenhum banco, coleção paralela, servidor, arquivo de memória oficial ou projeto novo é criado. Permanecem auroraDb e organizations/{orgId}/runtimeCheckpoints/aurora-organic-v1, com apiIdempotency e auditEvents na transação existente. A visão learning é derivada; os relatórios ficam em runs[].result.report e a aprovação inclui planFingerprint no mesmo checkpoint. O catálogo local não recebe memória oficial.

Aprovações anteriores sem planFingerprint não autorizam o novo relatório: são invalidadas conservadoramente e exigem nova revisão autenticada/MFA. Revalidação em duas passagens não aumenta duas vezes a revisão da proposta. Os limites de 64 sinais, 64 execuções e 180 kB continuam; alcançar o limite bloqueia, sem apagar histórico ou criar outro armazenamento.

## Retomada após falha

Na página orgânica, uma falha de transporte, timeout, retorno HTML inválido ou erro 5xx preserva, somente na memória da janela, o corpo exato do comando, expectedVersion e Idempotency-Key. O botão Repetir envio pendente reutiliza a mesma operação. Enquanto ela estiver incerta, novos comandos são bloqueados. Uma leitura posterior ou o aumento da versão do estado não são tratados como prova de que o comando foi aplicado.

Erros 400/409 exigem leitura atual antes de nova intenção. 401/403 limpam a visão e interrompem reenvios. Um comando confirmado seguido de falha na leitura é distinguido de comando não confirmado. Timeout: 15 s para leitura e 30 s para envio. Não há repetição automática de escrita nem armazenamento de senhas ou comandos no navegador entre sessões. Fechar/recarregar a janela perde a chave pendente local: consultar estado e trilha existente antes de emitir nova intenção.

A leitura automática ocorre a cada 60 s apenas com a página visível, conectada, sem edição ativa, envio em curso ou retorno incerto. A retomada de rede/foco solicita leitura, nunca ativação. Isto não instala uma rotina autônoma de servidor nem uma automação de produção.

A causa da mensagem Internal Server Error da conversa anterior não foi estabelecida; estes controles tratam falhas do fluxo da aplicação, não demonstram a correção da infraestrutura da conversa.

## Validação e limites de implantação

A suíte orgânica passou localmente em 59 cenários: 28 de integração/paridade já existentes, 18 de composição/aprendizagem e 13 de cliente/retomada. Os testes usam fontes, membros, respostas HTTP e DOM sintéticos; não são login real, concorrência real no Firestore ou funcionamento no Mac. O resultado de CI deve ser associado ao SHA final, nunca herdado de um commit anterior.

Atualizar a habilidade e AGENTS.md torna o procedimento disponível no repositório; não habilita sozinho organicEnabled nem organicSectors. Nenhum deploy, merge, alteração de dados reais, publicação de pacote ou instalação desktop é feito por esse incremento. O PR permanece draft. O original do Mac continua a baseline obrigatória e não deve ser substituído pelo launcher HML.

## Critérios restantes para operação real

Revalidar o ambiente autorizado, o esquema do checkpoint, as alçadas/setores e o login/MFA; testar idempotência e concorrência no ambiente apropriado; usar o gate de recuperação HML sem banco paralelo (PITR + delete protection + backup `READY` recente + ausência de coleções operacionais) e reservar ensaio real de restore para antes da ingestão/cutover; publicar a versão rastreável; testar captura, geração, revisão, execução, resultado, revogação e retomada autenticadas. Para atualização desktop, identificar tecnicamente o original e comprovar compatibilidade, backup/rollback e identidade preservada. Nenhum desses passos é presumido pela aprovação da suíte sintética.
