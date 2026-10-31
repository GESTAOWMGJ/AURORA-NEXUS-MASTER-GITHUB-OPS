# AURORA PERSONALITÉ — Organização documental por tenant e nuvem elegível
**Documento de incremento candidato — 30/10/2026**  
**Cliente-piloto alvo:** consultório da Dra. Bruna (sem divulgar CNPJ, identificadores privados ou dados clínicos)  
**Sistema-mãe:** AURORA NEXUS | AURORA-MO-001 | AURORA-ORG-001 | AURORA-SEC-001/002  
**Estado:** SPECIFIED, não IMPLEMENTED, HML_VERIFIED ou PRODUCTION_VERIFIED.

## Decisão do titular
Em 30/10/2026, o titular da operação AURORA autorizou incluir na entrega Personalité o módulo de organização documental inspirado no aprendizado da WMGJ, com seleção da nuvem que a cliente efetivamente utilize. O titular declarou validar pessoalmente a entrega, o escopo, revisão, ambiente e credenciais. **Essa decisão registra autorização do patrocinador e intenção de revisão pessoal, não evidência de revisão independente realizada, credenciais emitidas, acesso à nuvem, aceite autenticado da Dra. Bruna, testes HML ou implantação.** A titular da conta/nuvem deve consentir especificamente com os escopos e identidades concedidos.

## Fonte e arquitetura
Reutilizar a abstração documental do AURORA-ORG-001, o pipeline canônico de sourceDocument e o AURORA-MO-001; a WMGJ é referência de padrões, nunca fonte de dados ou credenciais do novo tenant. Estrutura: conector autorizado (Google Drive ou outro provedor suportado) → inventário/metadados → hash/proveniência e ingestão canônica do tenant → fila e classificação governada → revisão humana → índice/readback → painel privado. Sem segundo banco, motor, scheduler ou executor paralelo. Se o provedor da cliente não possuir adaptador validado, marcar CONNECTOR_UNSUPPORTED e oferecer entrada manual controlada, não fingir sincronização. Não presumir que Google Drive seja a escolha.

## Experiência do consultório (escopo proposto)
1. Tela de escolha de nuvem, identificando provedor, conta autorizadora, tenant, escopo, data de consentimento, expiração/revogação e estado do conector. Nunca solicitar senha em formulário AURORA.
2. Inventário inicial read-only de pastas e arquivos autorizados, por IDs opacos e metadados mínimos; filtro por raiz explicitamente selecionada pela Dra. Bruna. Não varrer unidade pessoal inteira nem contas WMGJ/JFN.
3. Plano de organização sugerida: Administração/Contrato, Financeiro/Fiscal, Agenda/Atendimento administrativo, Comunicação/Marketing, RH/Prestadores, Governança e Revisão; categorias são configuráveis. Conteúdo clínico, prontuários e registros de pacientes: CLINICAL_SENSITIVE, fora de ingestão/reorganização automática até AURORA-SEC-002, consentimento, controles de dados sensíveis e aprovação específica.
4. Fila com PENDING, PROCESSING, PROCESSED, DUPLICATE, NEEDS_REVIEW, RETRYABLE_ERROR, BLOCKED. Classificações por nome são hipóteses, não confirmação documental. Duplicidade por hash/versão sem excluir arquivos; conteúdo e competência não são inferidos de nome ou data de modificação.
5. Modo padrão DRY_RUN/READ_ONLY: sugerir destino, metadados e nome; mostrar antes/depois, conflito, permissões e efeito esperado. Mover, renomear, compartilhar, remover e criar pastas dependem de autorização nominal, privilégio mínimo, teste de reversão e recibo individual. Nenhuma exclusão automática.
6. Painel privado Personalité: cobertura (itens descobertos/escopo concedido), duplicados potenciais, pendências, idade do último snapshot, erros, revisões, progresso com denominador; sem vazamento de conteúdo ou identidade clínica.
7. Rutina eventual de sincronização é tenant-scoped, idempotente, sob scheduler nativo existente e com checkpoint/lease compartilhado. Não duplicar trigger Apps Script legado. Desconexão/revogação impede novas leituras e mutações; histórico preservado e protegido.
8. Não enviar dados pessoais ou documentos a modelo externo para classificar por padrão. Memória orgânica recebe apenas outcomes sanitizados, validados e com proveniência; não aprende usando dados brutos entre organizações.

## Contrato de evidência mínimo
- tenantId, connectorId, providerType, environment, authPrincipalRef, grantedScope, approvedRootIds, consentEvidenceRef, reviewDecisionRef e revision;
- sourceFileId opaco, sourceVersion, checksum quando disponível, sourceModifiedAt, observedAt, classificationProposal, reviewState, targetProposal, sourceRef e receipt;
- READBACK: contagem total de itens descobertos, itens analisados, processados, aliases, falhas, sem comprovante e cobertura desconhecida; cada resultado atribuível ao mesmo tenant e ciclo;
- rastreamento de incidentes/limites, chave idempotente por tenant+source+version+operation e estado before/after imutável;
- nenhuma credencial ou token em código, PR, logs ou relatórios.

## Gates para teste e ativação
G0 SPECIFIED: desenho/contrato no repositório (este documento).
G1 IMPLEMENTED: adaptadores concretos, endpoints privados, tela, validações server-side, regras de acesso, testes e revisão de segurança.
G2 CI_VERIFIED: CI no SHA final e regressões por isolamento, OAuth/expiração, conflitos, revogação, deduplicação, idempotência, falhas parciais e readback.
G3 HML_VERIFIED: consentimento e escopos de teste, tenant sintético, teste emulador e navegador autenticado, download/restore, rollback e smoke com logs/snapshot.
G4 CLIENT_AUTHORIZED: aceite autenticado da própria titular do consultório e autorização da conta de nuvem; distinção da aprovação do patrocinador AURORA.
G5 PRODUCTION_VERIFIED: implantação identificada por SHA, conector efetivamente autorizado, leitura validada de raiz aprovada, recibo/readback e aprovação de movimentações se aplicável. Nunca marcar completa por CI, merge, deploy ou scheduler.

## Matriz de testes esperados
- Drive com escopo apenas em uma pasta / provider alternativo ainda não homologado / revogação OAuth / token vencido.
- Duas organizações com nomes e IDs de documentos iguais: resultado e logs isolados.
- Mesmo arquivo/version repetido: não duplica item; mesma chave com conteúdo diferente bloqueia.
- Pasta compartilhada com permissões divergentes: sugerir, não elevar; recusar mover sem autorização.
- Documento sensível/clinico: quarentena/bloqueio; zero extração e zero envio a IA externa.
- Falha parcial, 429 e paginação: cobertura UNKNOWN/PARTIAL sem declarar ausência.
- Tentativa de mover/renomear sem revisão MFA: bloqueio; com autorização sintética: comprovante, reversão e readback do destino.
- Reconexão e recuperação de checkpoint sem duplicação de trabalho.

## Pendências para efetiva entrega à Dra. Bruna
- Identificar titularidade e nuvem escolhida sem acessar contas de terceiros por inferência.
- Formalizar consentimento, escopos e aprovação de credenciais por dona da nuvem.
- Implementar integração e testes; registrar CI do SHA final.
- Validar segurança de dados sensíveis e licença/necessidade conforme LGPD e política do consultório.
- Obter revisão humana independente, homologação autenticada e recibo operacional antes de indicar módulo ATIVO.

## Rollback
Revogar conector e bloquear novas operações por tenant; preservar trilha e checkpoints, restaurar destino somente com manifesto/recibo e aprovação; não apagar fontes. Reconciliar mudanças concorrentes e não restaurar permissões ampliadas.

**Não há implantação, sincronização real, reorganização ou tratamento de documentos de paciente autorizados ou executados por este documento.**
