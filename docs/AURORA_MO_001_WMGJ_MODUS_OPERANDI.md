# AURORA-MO-001 — Modus Operandi Mestre WMGJ → AURORA NEXUS

## Status

- Código: `AURORA-MO-001`
- Escopo: operação, automação, auditoria, receita, governança e evolução do AURORA NEXUS.
- Tenant de referência: `WMGJ Operação`.
- Sistema-mãe: `AURORA NEXUS / JFN-AUD-GOV-001`.
- Regra: WMGJ é tenant-piloto e fonte de aprendizado operacional; não é dependência estrutural do produto.

Este documento é a fonte canônica do modus operandi operacional aprendido com a WMGJ.
Mudanças futuras devem preservar esta linhagem ou registrar explicitamente a razão, evidência, teste e rollback da alteração.

## 1. Ciclo mestre

Toda capacidade operacional do AURORA segue:

```text
OBSERVAR
→ INGESTAR
→ COMPROVAR
→ CONFRONTAR
→ DETECTAR
→ PRIORIZAR
→ AGIR
→ VALIDAR
→ MEDIR
→ APRENDER
→ REUTILIZAR
```

O sistema não deve tratar ausência de evidência como zero, nem corrigir divergências silenciosamente.

## 2. Cadeia financeira canônica

```text
Produção
→ validação assistencial
→ faturamento
→ recebimento
→ repasses
→ tributos
→ custos
→ margem
→ validação contábil/societária
```

Invariantes:

- produção ≠ receita;
- faturamento ≠ recebimento;
- saldo bancário ≠ lucro;
- estimativa ≠ fato comprovado;
- ausência de evidência ≠ zero;
- nova evidência muda o estado da divergência, não apaga o histórico.

## 3. Reconciliação e dupla checagem

Quando fontes distintas representam o mesmo fato, o AURORA deve confrontá-las.

Padrão WMGJ:

```text
escala
× presença
× produção
× registro/relatório
× autorização
× faturamento
× NFS-e
× banco
× repasse profissional
× tributos
```

Diferenças viram exceções rastreáveis.

## 4. Gestão por exceção

O gestor deve receber prioritariamente:

- o que mudou;
- o que está errado;
- impacto financeiro, operacional, assistencial ou regulatório;
- evidência disponível;
- evidência faltante;
- responsável;
- SLA e aging;
- próxima ação;
- resultado após intervenção.

Pendência nunca fica passiva.

Ciclo obrigatório:

```text
detectar
→ registrar
→ atribuir responsável
→ cobrar
→ verificar resposta
→ confrontar evidência
→ atualizar estado
→ repetir até fechamento
```

Estados sem evidência suficiente permanecem `PENDENTE`, `DIVERGENTE`, `BLOQUEADO` ou `NÃO_COMPROVADO`.

## 5. Unidade mínima de achado

Todo achado material deve manter:

- `orgId`;
- competência;
- fato;
- fonte;
- evidência;
- valor ou impacto;
- desvio;
- causa provável quando sustentada;
- prioridade;
- responsável;
- SLA;
- aging;
- última ação;
- próxima ação;
- status;
- residual;
- evidência de resolução;
- KPI de verificação.

## 6. Automação WMGJ que forma a matriz de referência

### 6.1 Apps Script canônico em `src/`

A fonte executável oficial é `src/*.gs`.

Blocos observados na baseline:

- `00_CORE_WMGJ.gs`: API/webhook, comandos, autorização, logs, Gmail, Drive, dashboard e status;
- `01_PIPELINE_CONFIABILIDADE_WMGJ.gs`: pipeline de confiabilidade;
- `02_AUTOMACAO_GATILHOS_WMGJ.gs`: instalação/orquestração de gatilhos;
- `03_TESTES_PIPELINE_WMGJ.gs`: testes do pipeline;
- `04_EXTRACAO_DOCUMENTAL_WMGJ.gs`: extração documental;
- `05_FORMATACAO_TEXTO_EXTRAIDO_WMGJ.gs`: normalização de texto;
- `05_GEMINI_CLASSIFICADOR_WMGJ.gs`: classificador externo opcional;
- `06_PARSER_EXTRATO_BANCARIO_WMGJ.gs`: parser bancário;
- `07_ORQUESTRADOR_FINANCEIRO_WMGJ.gs`: extração → formatação → extrato → resumo financeiro, com falha explícita;
- `08_RELATORIO_EXECUTIVO_SOCIOS_WMGJ.gs`: consolidação executiva;
- `09_INDEXADOR_GMAIL_FATURAMENTO_WMGJ.gs` e `09B_BUSCA_GMAIL_AMPLA_WMGJ.gs`: ingestão e indexação de e-mails;
- `10_PARSER_NOTAS_FISCAIS_XML_WMGJ.gs`: notas fiscais/XML;
- `11_ORQUESTRADOR_GMAIL_FISCAL_FINANCEIRO_WMGJ.gs`: Gmail → bruto → fiscal → pipeline financeiro → relatório → controle de ciclos;
- `12_AUTOMACAO_SEM_EXECUCAO_HUMANA_WMGJ.gs`: automação operacional controlada;
- `12_ROBO_GMAIL_DASHBOARD_WMGJ.gs`: atualização por Gmail;
- `13_DASHBOARD_FINANCEIRO_WMGJ.gs`: dashboard;
- `13_TRAVA_CONCORRENCIA_WATCHDOG_WMGJ.gs`: concorrência/watchdog;
- `14_ORGANIZADOR_DRIVE_OPERACIONAL_WMGJ.gs`: organização segura, quarentena/revisão e log, sem exclusão definitiva;
- `33_ROTINA_INGESTAO_AUDITORIA_NF_WMGJ.gs`: ingestão/auditoria de NF;
- `34_AURORA_RC11_FIRESTORE_CONTROL.gs`: controle do piloto real RC1.1;
- `35_AURORA_FIRESTORE_BRIDGE_WMGJ.gs`: ponte canônica para Firestore;
- `36_AURORA_FIRESTORE_MIGRATION_WMGJ.gs`: migração/checkpoint;
- `99_DEPLOY_SYNC_WMGJ.gs`: sincronização de deploy.

Regra: referências em diretórios legados não substituem `src/` como fonte executável.

### 6.2 GitHub Actions

Workflows de referência:

- `deploy-appscript.yml`: audita limites de fonte, publica Apps Script, cria versão e executa diagnósticos controlados;
- `deploy-aurora-firebase.yml`: deploy HML protegido, candidato imutável, WIF, preflight e smoke autenticado;
- `validate-firestore-migration.yml`: build, Rules, dependências, FastAPI/OpenAI contracts e validação sem deploy;
- `validate-aurora-organic.yml`: integração orgânica;
- `aurora-hml-auth-smoke-once.yml`: smoke de autenticação HML;
- `aurora-rc11-recovery-real-ingest.yml`: Recovery Gate → HMAC → runtime → amostra real → reconciliação → Native Intelligence → kill switch;
- workflows de instaladores/onboarding permanecem gates separados de validação.

Deploy de código e execução operacional são pipelines distintos.

## 7. Coletor AURORA

O `aurora-coletor` preserva:

- Python 3 + biblioteca padrão como baseline;
- leitura apenas da fonte autorizada;
- estado local restrito ao target;
- segredo somente em ambiente;
- validação sem transmissão por padrão;
- transmissão apenas por `--once` ou `--watch`;
- identidade técnica revogável e rotacionável;
- recibo do servidor obrigatório;
- retentativa para falhas transitórias;
- bloqueio em falhas permanentes ou 401/403;
- deduplicação local por hash e remota por conteúdo normalizado;
- nenhuma credencial ou dado bruto sensível no estado local.

## 8. Firestore e migração segura

Regras herdadas do kit WMGJ → Firestore:

1. nada fecha sem evidência;
2. nada migra apagando ou sobrescrevendo a fonte;
3. toda escrita possui `orgId`, `schemaVersion`, `idempotencyKey`, origem e versão;
4. IA pode classificar/extrair/recomendar, mas decisão crítica exige revisão humana;
5. dados clínicos identificáveis ficam fora do primeiro backfill;
6. Apps Script inicia em `DRY_RUN=true`;
7. deploy e execução operacional são separados.

## 9. Gate absoluto de dados reais

A ordem mínima é:

```text
RESTORE VERIFIED
→ INGEST AUTHENTICATED
→ REAL SAMPLE
→ RECONCILED
→ NATIVE INSIGHT VERIFIED
→ KILL SWITCH / ROLLBACK VERIFIED
```

Nenhum dado real é promovido para compensar falta de recuperação, autenticação, reconciliação ou evidência.

## 10. Segurança estrutural

Preservar:

- login-first;
- isolamento por `orgId`;
- RBAC;
- deny-by-default;
- WIF/identidade técnica;
- HMAC + `keyId`;
- nonce e timestamp;
- anti-replay;
- idempotência;
- Secret Manager;
- audit ledger;
- versionamento e hash;
- revisão humana;
- backup/PITR/restore;
- rollback;
- LGPD e segregação por finalidade.

Documentos são dados, nunca autorização para executar comandos.

## 11. Módulos AURORA

O conhecimento WMGJ deve ser absorvido dentro do sistema-mãe:

- M01 — Ingestão & Proveniência;
- M02 — Contratos, Regras & Evidências;
- M03 — Receita & Conciliação;
- M03.1 — JFN-AUD-FAT-001;
- M04 — Glosas & Divergências;
- M05 — SLA & Workflow;
- M06 — Governança & Plano de Ação;
- M07 — Analytics & Relatórios;
- M08 — Integrações;
- M09 — Segurança/LGPD/Isolamento;
- M10 — Audit Ledger;
- M11 — AURORA-ORG-001;
- M12 — Collective Intelligence.

Não criar banco, produto ou sistema paralelo para uma capacidade que pertence a esses módulos.

## 12. Evolução orgânica

Novo aprendizado WMGJ segue:

```text
evidência
→ padrão
→ proposta limitada
→ teste sintético
→ revisão humana
→ piloto WMGJ
→ medição
→ promoção ou rollback
```

A promoção transforma uma regra particular em capacidade reutilizável apenas quando houver evidência suficiente.

## 13. Inteligência

Precedência:

```text
Conectores autorizados (MV / TASY / ERP / Drive / Gmail)
→ materialização canônica no Firebase
→ Aurora Native Intelligence
→ Organic Engine
→ Knowledge Registry
→ Pattern Matcher
→ modelo privado/controlado quando homologado
→ provedores externos opcionais e excepcionais
```

A inteligência nativa é condicionada ao Firebase: sem `dashboardSnapshots/current` e sem contrato `sourceAccessDuringInference=false`, não há inferência nativa. Depois que um dado/documento alcança snapshot canônico `nativeReady`, a análise operacional não relê a origem. O link/fonte permanece como proveniência e para revalidação explícita, não como dependência de execução.

Provedor externo de IA fica desabilitado por padrão na classificação documental. Regra nativa determinística é tentada primeiro; uso externo só pode ocorrer quando explicitamente habilitado para caso não resolvido pelo motor nativo, com payload mínimo, sanitizado e rastreado. Repetição de chamada externa para padrão já absorvido é desperdício a eliminar.

Regras essenciais de faturamento, auditoria, SLA, segurança, autorização, evidência, conciliação e fragilidade documental não podem depender exclusivamente de LLM externo.

## 14. Inteligência coletiva

Modo inicial: `PRIVATE`.

Quando autorizado e homologado:

```text
Tenant Local
→ Organic Engine
→ Privacy Gate
→ Knowledge Capsule
→ Knowledge Registry
→ Pattern Matcher
→ hipótese devolvida ao tenant
→ validação local
→ reforço ou descarte
```

Princípio:

> O AURORA não transfere dados de um cliente para outro. Transfere capacidade diagnóstica.

## 15. Disciplina de desenvolvimento

Toda solicitação relevante deve seguir:

```text
prompt
→ baseline atual
→ menor incremento coerente
→ patch
→ teste
→ CI
→ HML
→ dado real quando autorizado
→ evidência
→ Release Cockpit
→ nova baseline
```

Separar sempre:

- especificado;
- implementado;
- testado;
- CI;
- implantado;
- publicado;
- validado com dados reais.

Código existente não equivale a operação comprovada.

## 16. Regra de produto

A WMGJ fornece a matriz operacional de referência, mas o resultado deve permanecer multi-tenant, reutilizável e desacoplado.

Posicionamento:

> O ERP registra a operação. O AURORA NEXUS audita, confronta, interpreta e melhora a realidade que existe ao redor dela.

## 17. Regra de manutenção deste documento

Antes de alterar automações WMGJ/AURORA, o agente deve:

1. ler este documento;
2. ler `skills/aurora-nexus-continuous-dev/SKILL.md`;
3. localizar a baseline real na `main`;
4. reutilizar os workflows e módulos existentes;
5. não criar projeto paralelo;
6. preservar segurança, evidência, rollback e isolamento;
7. atualizar este documento quando uma nova capacidade operacional for promovida à baseline.


## 18. Auditoria técnica semanal de código e automação

A manutenção do AURORA inclui auditoria técnica semanal do repositório, sempre baseada na ponta real da `main` no momento da revisão.

Escopo mínimo:

1. resolver o SHA atual da `main` antes de usar qualquer baseline informado anteriormente;
2. revisar mudanças, PRs e workflows materialmente relevantes dos últimos 7 dias;
3. verificar sintaxe/configuração de workflows e contratos tocados;
4. verificar funções duplicadas, fontes executáveis concorrentes e preservação da fonte canônica;
5. verificar exposição ou manejo inadequado de segredos, sem imprimir valores sensíveis;
6. revisar mudanças de algoritmo, contratos e gates;
7. confrontar testes, CI e SHA/base realmente validados;
8. não estimar custo ou consumo sem dado real observável.

O relatório executivo deve conter no máximo 3 prioridades materiais, selecionadas entre:

- segurança/integridade;
- falha de algoritmo;
- custo/eficiência.

Cada prioridade deve registrar evidência objetiva (SHA, PR, workflow, arquivo/trecho ou teste), impacto, estado verificado e próximo passo verificável.

CI verde em SHA ou base antiga não libera uma branch divergente. Antes de sair de draft, a branch deve ser reconciliada com a `main` corrente e os checks relevantes devem ser repetidos no SHA final.

Correções decorrentes desta auditoria são feitas somente em branch isolada, com PR draft e revisão humana, sem merge ou deploy automático.

A auditoria deve manter separados os estados: especificado, implementado, testado, CI verificado, implantado e validado em ambiente real.


## 19. Plano de dados nativo Firebase — regra fundamental

O Firebase é a memória operacional executável do AURORA NEXUS. Drive, MV, TASY, Gmail, APIs e demais sistemas são fontes de aquisição e proveniência.

Fluxo obrigatório:

```text
ORIGEM AUTORIZADA
→ CAPTURA
→ EXTRAÇÃO
→ CLASSIFICAÇÃO NATIVA
→ SANITIZAÇÃO
→ HASH + VERSÃO + PROVENIÊNCIA
→ SNAPSHOT CANÔNICO FIREBASE
→ PROJEÇÃO
→ INTELIGÊNCIA NATIVA
→ AÇÃO / REVISÃO
→ APRENDIZAGEM ORGÂNICA VALIDADA
```

Invariantes:

1. análise nativa lê somente estado persistido no Firebase; não consulta Drive/MV/TASY durante inferência;
2. `nativeReady=true` significa que o snapshot operacional possui fatos estruturados suficientes para análise sem releitura da origem;
3. `sourceIndependent=true` significa independência operacional pós-ingestão; não significa que o documento-fonte possa ser apagado;
4. arquivo-fonte permanece imutável e referenciável como evidência/proveniência;
5. desconexão da origem após ingestão não invalida snapshots já aceitos; gera perda de cobertura apenas para conteúdo novo/alterado;
6. documento com extração degradada, baixa confiança ou campos canônicos ausentes permanece fragilidade explícita; não é promovido silenciosamente a evidência perfeita;
7. narrativa bruta, prontuário e PHI não entram no endpoint genérico. Conteúdo clínico-sensível exige caminho criptográfico dedicado, finalidade autorizada e controles AURORA-SEC-001;
8. hashes, versões, `orgId`, origem, SLA, estado e trilha de auditoria acompanham o snapshot;
9. IA externa nunca é requisito para disponibilidade do núcleo operacional.

O snapshot genérico deve privilegiar fatos estruturados: categoria, competência, valores canônicos, contagens, estágio do fluxo, confiança, método de extração, origem, SLA, fragilidade, necessidade de releitura e hashes. Texto narrativo bruto não é necessário para o motor operacional padrão.

## 20. Vigilância documental contínua de MV, TASY e outros ERPs

A instalação do AURORA deve provisionar um registro de fontes documentais por organização. Cada fonte recebe:

- `sourceId` estável;
- sistema de origem: `MV`, `TASY`, `ERP` ou `DRIVE`;
- modo de entrada implementado;
- pasta/endpoint explicitamente autorizado;
- SLA documental;
- estado ativo/inativo;
- diagnóstico de acessibilidade;
- isolamento por organização.

Há dois modos canônicos implementados: `DRIVE_FOLDER`, para exportações/sincronizações documentais em pastas autorizadas; e `AURORA_INTEGRATION_API`, para push server-to-server de fatos documentais estruturados por MV, TASY ou outro ERP usando chave Aurora com escopo `documents.ingest`. O endpoint direto não aceita narrativa bruta, PHI ou campos arbitrários. Ambos terminam no mesmo `sourceDocument` canônico do Firebase. Um conector indisponível não derruba os demais.

A vigilância deve procurar pelo menos:

- documento novo ou alterado;
- extração degradada;
- classificação de baixa confiança;
- campos canônicos ausentes;
- documento dependente de releitura da origem;
- fila parada;
- documento além do SLA da fonte;
- gargalo entre recebido → extraído → validado;
- uso residual de IA externa que já possa ser substituído por regra nativa;
- recorrência por sistema, setor, tipo documental e causa-raiz.

Ciclo de resolução:

```text
DETECTAR NO FIREBASE
→ MANTER EXCEÇÃO ATIVA
→ PRIORIZAR POR SLA / IMPACTO / RECORRÊNCIA
→ PROPOR CORREÇÃO
→ REVISÃO HUMANA QUANDO MATERIAL
→ EXECUTAR INTERVENÇÃO PERMITIDA
→ MEDIR RESULTADO
→ REGISTRAR EVIDÊNCIA
→ ALIMENTAR AURORA-ORG-001
→ REUTILIZAR REGRA VALIDADA
```

A aprendizagem orgânica não fecha pendência por inferência. Somente resolução validada com evidência pode virar `REWORK`, `VALIDATED_DECISION`, `SECTOR_NEED` ou outro sinal elegível. Pendências criadas pelo watchdog carregam metadados orgânicos controlados; após resolução humana válida, a observação correspondente é registrada automaticamente e de forma idempotente no checkpoint AURORA-ORG-001, sem uma segunda consulta à origem. Ferramentas promovidas continuam limitadas por escopo, revisão, teste, rollback e proibição de mutação autônoma do sistema-fonte.

Essa vigilância é complementar aos módulos já existentes de faturamento, glosa, reconciliação, SLA, governança e auditoria; não cria produto, banco ou motor paralelo.

## 21. Registro nativo de rotinas e agendamentos

Toda rotina recorrente, gatilho operacional ou fechamento pertencente ao modus operandi WMGJ deve ser representado no motor por `firebase-migration/functions/src/auroraNativeRoutines.ts`.

O registro é parte do contexto da Aurora Native Intelligence e deve declarar:

- identificador estável;
- módulo AURORA;
- finalidade;
- cadência;
- gatilho;
- escopo `PER_ORG` ou `PLATFORM`;
- gate humano;
- proibição ou permissão explícita de mutação de fonte;
- estado real de execução.

Estados:

- `NATIVE_ACTIVE`: rotina implementada e executada no runtime Firebase;
- `NATIVE_EVENT`: rotina nativa disparada por mudança de estado/evento canônico;
- `NATIVE_GOVERNED`: capacidade nativa governada, dependente de evidência/revisão;
- `LEGACY_MIRRORED`: rotina WMGJ ainda executada em Apps Script, mas já conhecida pelo motor e aguardando migração sem dupla execução.

Regra absoluta: `LEGACY_MIRRORED` nunca pode ser apresentado como `NATIVE_ACTIVE`. A migração deve evitar duplicar execução, notificação, cobrança ou processamento.

Rotinas atualmente materializadas no registro incluem watchdog de runtime, projeção, vigilância documental, fechamento mensal societário `AURORA-FIN-SOC-001`, saneamento de receita `AURORA-REV-SAN-001`, auditoria técnica semanal e espelhamento governado das rotinas Apps Script recorrentes.

Toda nova rotina da WMGJ ou de outro cliente deve seguir:

```text
evento operacional validado
→ necessidade recorrente
→ sinal orgânico sanitizado
→ proposta tenant-agnostic
→ teste sintético
→ revisão humana
→ piloto isolado no tenant
→ resultado medido
→ promoção ao registro nativo ou descarte
```

Nenhum dado bruto, identificador, valor financeiro particular, regra contratual específica ou evidência sensível de um cliente é transferido a outro cliente. O que pode ser promovido é somente a capacidade diagnóstica/operacional abstraída, versionada e testável.

## 22. Fechamento mensal simplificado para gestor

O AURORA deve manter uma visão leiga e atualizada do fechamento mensal no mesmo web app/PWA, derivada exclusivamente do Firebase canônico.

A página deve responder, sem exigir conhecimento contábil:

- quanto há de contas vencidas;
- quanto há de contas a vencer;
- qual é o vencimento aberto mais urgente e seu valor;
- qual é o próximo vencimento e seu valor;
- qual é a receita esperada;
- qual é o saldo em conta comprovado;
- quanto ainda falta entrar para atingir a receita esperada, somente quando ambos os valores estiverem comprovados;
- quanto há a receber até o vencimento atual;
- quanto há a receber até o próximo vencimento;
- qual é o total recebível;
- qual é o valor distribuível validado, quando existir.

Invariantes:

- ausência permanece `null / Sem fonte`, nunca zero presumido;
- saldo bancário não vira lucro distribuível por diferença simples;
- o valor distribuível deve existir explicitamente no fechamento canônico;
- aprovação de distribuição exige `distributionGateState=ELIGIBLE`, fechamento `CLOSED`, snapshot atual, cobertura suficiente, usuário autorizado e MFA;
- o botão de aprovação registra `APPROVED_FOR_DISTRIBUTION` ou `REJECTED` com gestor, função, data, motivo, competência, valor e hash do snapshot;
- a aprovação não executa PIX, transferência, pagamento, baixa ou distribuição;
- toda execução financeira permanece externa/manual ou em fluxo futuro com gate próprio, nunca implícita no clique de aprovação.
