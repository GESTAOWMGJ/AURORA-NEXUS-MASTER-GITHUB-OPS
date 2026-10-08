# AURORA-MO-001 — Modus Operandi Mestre WMGJ → AURORA NEXUS

Incremento de 04/10/2026: `AURORA-USER-PROFILES-001` incorpora criação/retomada/revogação de perfis por administrador com MFA, por organização e sem banco paralelo. `AURORA-DAILY-UPDATES-001` representa a manutenção diária autorizada de cliente, web e mobile, ainda executada pela rotina hospedada existente e marcada LEGACY_MIRRORED. Contrato, evidências, gates e rollback em [AURORA_USER_PROFILES_1_0_0.md](AURORA_USER_PROFILES_1_0_0.md). A autorização antecipada de futuras versões evita repetir consentimento no mesmo escopo; não equivale a validação técnica ou implantação comprovada.

## Diretriz permanente do titular — desafios alimentam o motor

Decisão de 04/10/2026: aplicar este modus operandi a todo desafio e solução relacionados
à operação AURORA, WMGJ e clientes autorizados. Cada atendimento deve alimentar o mesmo
organismo operacional: registrar o desafio, fatos e limites de acesso; confrontar fontes;
formular e testar a menor solução; medir o resultado; incorporar o aprendizado versionado
ao motor base. Reutilizar primeiro capacidades existentes e preservar a linhagem.

O registro do desafio é obrigatório mesmo quando não houver solução concluída. Nesse caso,
manter pendência, evidência faltante, responsável e próxima verificação. Proposta, teste local,
CI, implantação e resultado real são estados distintos. Só desfechos comprovados podem
fundamentar promoção orgânica. Não transformar hipótese em regra operacional ativa.

Regras gerais, contratos e regressões pertencem à fonte mestre/registro nativo. Evidência
privada, documentos e valores permanecem no tenant autorizado. O motor aprende capacidades
abstratas; não acumula dados de clientes no repositório público nem amplia suas permissões.
Cada entrega deve declarar até onde o aprendizado foi efetivamente persistido ou implantado.

## Aprendizado de ingestão — revisão de 04/10/2026

Regra transversal M01/M08/M10: toda falha de alimentação deve confrontar mensagem-fonte,
filtro/janela, execução do gatilho na conta proprietária, frescor do índice, contrato de
colunas, arquivo pelo hash, fila e idempotência. Atualização da planilha ou deploy verde
não demonstram ingestão. Um watchdog que limpa a trava não demonstra recuperação do trabalho.

O registro nativo expõe `ingestionRecoveryPolicy`, ligado às rotinas legadas existentes.
O executor `replayMensagemGmailWMGJ` foi implementado e coberto por fixtures sintéticas no PR #148,
com dry-run padrão, SHA-256, reserva persistente de ID Drive e recibos de arquivo/índice/fila.
Permanece `LEGACY_MIRRORED`, desabilitado por padrão e pendente de validação de runtime;
código/testes não demonstram recuperação real nem resultado orgânico homologado.
`diagnosticarMensagemGmailWMGJ(messageId)` realiza inspeção somente leitura por ID exato.
Não instala gatilhos, não altera mensagens, não escreve documentos nem lança valores.

Cabeçalho divergente ou linhas incompatíveis bloqueiam novas escritas no indexador.
Não restaurar apenas o cabeçalho de uma tabela mista: preservar snapshot, reconciliar cada
layout e registrar transformação, antes/depois e revisão. Linhas de erro ou cópia sem
arquivo não constituem conclusão e não podem suprimir uma retomada.

Replay autorizado deve ler apenas a mensagem indicada; comparar os bytes com hash completo;
reutilizar a identidade legada para não reinserir eventos antigos; reconciliar arquivos
órfãos antes de criar; usar exclusão mútua compartilhada por todos os escritores; completar
somente destinos ausentes; registrar tentativa, etapa, hashes e recibos. Repetição deve
criar zero documentos, linhas de índice, itens de fila e lançamentos adicionais. Auditoria
de tentativa pode acrescentar eventos. OCR/parser automático opera apenas nos arquivos do
manifesto; metadados não comprovam competência ou valor. Não chamar o pipeline global.

Cada caso fica no tenant como achado aberto até resolução comprovada. Apenas regra
abstrata, teste sintético, revisão e desfecho validado podem alimentar a promoção orgânica.
Nenhum e-mail, identificador, anexo, saldo ou dado de cliente entra no código público.
Consultar `docs/AURORA_GMAIL_SINGLE_MESSAGE_RECOVERY.md` para os gates de recuperação.

## Status

- Código: `AURORA-MO-001`
- Escopo: operação, automação, auditoria, receita, governança e evolução do AURORA NEXUS.
- Tenant de referência: `WMGJ Operação`.
- Sistema-mãe: `AURORA NEXUS / JFN-AUD-GOV-001`.
- Regra: WMGJ é tenant-piloto e fonte de aprendizado operacional; não é dependência estrutural do produto.

Este documento é a fonte canônica do modus operandi operacional aprendido com a WMGJ.
Mudanças futuras devem preservar esta linhagem ou registrar explicitamente a razão, evidência, teste e rollback da alteração.

## 1. Ciclo mestre

### Implantação reutilizável — AURORA-INSTALL-INTEGRATION-001

O aprendizado da integração Windows/cloud passa a compor M08 no mesmo motor:
validar amostra estruturada e destino explícitos → verificar identidade da
organização → enviar amostra autorizada → conferir recibo → reconciliar no
armazenamento canônico. O registro nativo representa a capacidade como
`NATIVE_GOVERNED`, por organização e sob demanda, sem ativar outro executor.

`aurora-coletor/aurora_deployment.py` retoma etapas usando um checkpoint local
sanitizado no diretório da instalação existente. Credenciais nunca são gravadas.
Destino ou conteúdo diferentes bloqueiam a retomada; timeout repete a mesma chave
idempotente. Desde o componente 1.0.1, `--send` repete ping autenticado e POST
com a mesma chave/payload mesmo após recibo cached, retomando a projeção existente.
`--connect` permanece somente ping; recibo histórico não comprova uso atual.
Primeira operação exige prova remota do mesmo documento/sistema/versão/hash e
identidade imutável/revision. Projeção pending e prova ausente não são conclusão.

O padrão abstrato serve a novos clientes sem transportar dados WMGJ. Provisionamento
com MFA, IAM, publicação protegida, reconciliação real, empacotamento comercial e
aceite continuam sendo gates independentes. Código do instalador não prova
sincronização completa nem autoriza ampliar acesso. Nenhum executor agendado ou
conta administrativa é criado automaticamente.

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

Aprendizado `AURORA-PROD-PROJECT-001` (05/10/2026): nome pretendido ou candidato
histórico não é recurso provisionado. Destino produtivo exige ID/número explícitos,
contrato coerente e consulta autorizada confirmando projeto ativo antes de mutar.
Erro de consulta nunca autoriza criação ou fallback para outro ambiente. Concessões
de recurso como CMEK são específicas do projeto e não se propagam por inferência.
Regra incorporada ao bootstrap/workflow existentes, sem novo executor ou scheduler.

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

Nenhum dado bruto de um cliente é transferido, disponibilizado ou reutilizado em outro tenant.

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

## 22. Motor Mestre Operacional Nativo — AURORA-MASTER-OPS-001

O AURORA NEXUS possui um motor mestre operacional nativo para gerir a operação pela própria interface do software, sem dependência obrigatória de GPT, Gemini, OpenAI ou outro provedor externo.

Fluxo:

```text
SNAPSHOT CANÔNICO FIREBASE
→ AURORA NATIVE INTELLIGENCE
→ REGISTRO NATIVO DE ROTINAS
→ MOTOR MESTRE OPERACIONAL
→ PRIORIDADE / PRÓXIMA AÇÃO
→ COMANDO GOVERNADO DA INTERFACE
→ EVIDÊNCIA / AUDIT LEDGER
→ AURORA-ORG-001
```

Invariantes:

1. `externalProviderUsed=false` e `externalAiRequired=false` no caminho operacional padrão;
2. inferência lê somente o snapshot canônico Firebase e não relê a origem;
3. o motor não executa código arbitrário, movimentação financeira, decisão clínica ou mutação autônoma do sistema-fonte;
4. comandos permitidos reutilizam APIs governadas existentes: refresh, ações, integrações e decisão societária;
5. risco alto/crítico, resolução material, credenciais e decisões financeiras mantêm gate humano/MFA quando aplicável;
6. todas as rotinas permanecem representadas em `auroraNativeRoutines.ts`;
7. o aprendizado orgânico recebe apenas desfecho validado e sanitizado;
8. provedores externos podem existir futuramente como fallback substituível, nunca como requisito para disponibilidade do motor.

A interface deve apresentar o Motor Mestre como visão principal de inteligência operacional, mantendo leituras especializadas de receita, SLA, qualidade e próxima ação como subfunções explicáveis.

## 23. IA Master no PC autorizado — AURORA-IA-MASTER-001

O processamento físico local integra o mesmo produto: núcleo nativo compartilhado
para regras e modelo local para propostas de engenharia. Provedor externo permanece
desativado. O método é contexto versionado, sem treinamento automático de pesos.
Cache reduz inferências repetidas; auditoria registra hashes sem dados de clientes.

Prévia importada localmente não autentica a origem nem substitui o Firebase
canônico. Aprendizagem reutilizável continua restrita a padrões abstratos validados.
Nenhuma proposta executa código, adquire credenciais ou promove sua própria versão.
Alterações seguem patch, testes, revisão, CI, HML e reversão existentes.

Registro nativo, Release Cockpit e seção IA Master representam a capacidade; sua
presença não comprova dispositivo conectado, integração autenticada ou deploy.
Instalação, teste físico e publicação exigem evidências separadas por SHA.
Procedimento e limites: `desktop/ia-master/README.md`.


## 24. Updater integrado permanente — revisão de 08/10/2026

A rotina `AURORA-DAILY-UPDATES-001` conserva seu ID histórico e o executor hospedado existente, mas passa à cadência `HOURLY`, sob o nome AURORA Updater integrado. Permanece `LEGACY_MIRRORED`: não foi criado outro scheduler nem comprovado um serviço binário nativo por esta mudança. A autorização anterior cobre versões futuras dentro do escopo validado, sem reconfirmação redundante.

O mesmo `webUpdateClient()` já usado no login e no portal consulta o service worker na abertura, em intervalos de uma hora de uso visível/conectado e na retomada quando a verificação está vencida. Falha transitória mantém retry de 15 minutos. Eventos simultâneos usam a mesma operação/timer; eventos antes do prazo não repetem a chamada de atualização. Sem reload forçado, cache de dados privados, nova sessão ou coleta de credenciais. Não se promete execução com navegador/app fechado ou sem suporte a service worker.

A política entra no registro existente, na projeção e no Motor Mestre compartilhado. Cobertura pretendida: motor cloud, IA Master físico, Windows, macOS, web e PWA em iOS/Android. Aplicativos móveis nativos exigem caminho implementado e teste próprio. O registro expressa intenção e limites; não instala binários nem comprova atualização em cada destino. A autoridade da versão vigente continua em `AURORA-CANONICAL-RELEASE-001`, não no maior número de versão ou último commit.

Atualizar apenas artefatos alterados e compatíveis, com identidade preservada, gates/backup/rollback e recibo por destino. Xeon autorizado executa cargas pesadas; MacBook continua interface leve. A retomada de ingestão/know-how mantém seu checkpoint sem segundo executor do mesmo efeito. Dado bruto e regra privada não cruzam tenants.

Aceite de código: testes do JavaScript emitido, pausa/reconexão/retry/concorrência, propagação para projeção e Motor Mestre e TypeScript. Deploy, login real, atualização binária, ingestão e sincronização cloud permanecem aceites independentes. Rollback: reverter o incremento de código e política, sem apagar fontes, corpus ou checkpoints.
