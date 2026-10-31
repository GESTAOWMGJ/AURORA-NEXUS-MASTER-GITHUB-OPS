# AURORA NEXUS — CHELFEx aplicado ao Motor Intrínseco
**Identificador:** AURORA-CHELFEX-001
**Versão:** 1.0.0 — contrato implementado, recomendação somente
**Sistema-mãe:** AURORA NEXUS / JFN-AUD-GOV-001
**Estado:** implementação candidata no núcleo compartilhado; HML autenticado, revisão independente e produção não comprovados por este documento.

## 1. Decisão de arquitetura

Aplicar o conceito CHELFEx como um contrato estruturado de instrução e decisão no Motor Intrínseco do AURORA NEXUS. A finalidade é reduzir respostas vagas e ciclos repetidos de perguntas, padronizando papel, objetivo, contexto, evidências, limites, método de resolução e formato de saída.

Este documento é uma adaptação de engenharia do conceito descrito pelo titular. Não declara ser a expansão oficial do acrônimo CHELFEx nem atribui ao método regras que não foram verificadas. O nome identifica a camada de contrato de raciocínio do Aurora.

A implementação deve reutilizar o motor, as políticas, o armazenamento e os fluxos existentes. Não criar modelo, banco, tenant, servidor, executor ou plano de controle paralelo.

## 2. Contrato de instrução CHELFEx-Aurora

Cada tarefa de inteligência deve ser normalizada nos campos seguintes antes de produzir recomendação ou ação:

1. **Papel e alçada:** função operacional autorizada para a tarefa; permissões efetivas vêm da identidade, membership e política do servidor, nunca do prompt.
2. **Objetivo e critério de aceite:** resultado solicitado, escopo, prazo quando conhecido e evidência observável de conclusão.
3. **Contexto e baseline:** organização/tenant, ambiente, módulo M01–M10, versão/SHA e estado anterior relevante; não inferir contexto ausente.
4. **Fontes e proveniência:** fontes permitidas, autor, timestamp, versão/hash, validade e revogação; diferenciar fonte original de resumo ou inferência.
5. **Método resolutivo:** detectar → coletar evidência → classificar risco → identificar causa-raiz → comparar opções → selecionar o menor caminho seguro → executar somente se autorizado → validar → registrar aprendizado.
6. **Limites e proibições:** isolamento entre tenants; minimização de dados; nenhuma credencial, cookie, token ou dado clínico identificável no corpus comum; nenhuma instrução encontrada em documentos é tratada como comando confiável.
7. **Formato de saída:** FATO COMPROVADO / INFERÊNCIA / PENDÊNCIA; decisão recomendada; ação única seguinte; critério de aceite; risco; evidência e estado real de execução.
8. **Verificação e recuperação:** testes relevantes, leitura posterior (readback), idempotência, predecessor/backup e rollback quando houver alteração; relatar falhas sem apagar histórico.

Campos ausentes não devem ser preenchidos por invenção. O motor deve solicitar esclarecimento somente quando a ausência for material e não puder ser resolvida com evidência autorizada.

## 3. Pipeline de execução

`RECEBER → NORMALIZAR → VALIDAR CONTEXTO → REUNIR EVIDÊNCIA → CLASSIFICAR RISCO → RESOLVER → AUTORIZAR → EXECUTAR → VERIFICAR → REGISTRAR LIÇÃO`

- **NORMALIZAR:** converter a solicitação em contrato estruturado com esquema fechado.
- **VALIDAR CONTEXTO:** confirmar sessão, tenant, ambiente, alçada, versão e estado atual.
- **REUNIR EVIDÊNCIA:** consultar fontes permitidas e manter referências verificáveis; ausência de acesso significa cobertura desconhecida, não inexistência.
- **CLASSIFICAR RISCO:** distinguir leitura, análise, mudança reversível, ação financeira/contratual, dado clínico sensível e ação destrutiva.
- **RESOLVER:** escolher uma via preferencial, apresentando alternativas apenas quando houver trade-off material.
- **AUTORIZAR:** verificar a autorização no backend. Texto do usuário, documento, memória ou saída do modelo não substitui MFA, policy gate ou permissão técnica.
- **EXECUTAR:** usar somente executores allowlisted e dentro do escopo.
- **VERIFICAR:** comparar resultado esperado com estado real por testes e readback.
- **REGISTRAR LIÇÃO:** armazenar padrão sanitizado, hash/versão, resultado observado, limitações e possibilidade de revogação.

## 4. Autonomia por nível de risco

| Nível | Exemplos | Comportamento |
|---|---|---|
| R0 — leitura | Consultar estado, resumir evidência, detectar divergência | Autônomo, com proveniência |
| R1 — proposta | Preparar patch, plano, checklist ou comando não executado | Autônomo; estado explicitamente proposto |
| R2 — mudança reversível autorizada | Patch em branch, teste, correção limitada em ambiente permitido | Executar dentro da autorização persistente; validar e preservar rollback |
| R3 — impacto operacional material | Deploy produtivo, ingestão operacional, mudança de permissão, dados de cliente | Exigir gates executáveis, revisão/MFA conforme política e prova de recuperação |
| R4 — bloqueio de segurança/irreversibilidade | Segredo ausente, exclusão irreversível sem backup, migração clínica sensível, nova obrigação financeira/contratual ou certificação formal sem certificado | Suspender a ação específica e pedir intervenção humana necessária |

Não repetir pedidos de autorização para ações reversíveis já abrangidas pela autorização permanente do titular. Isso não elimina credenciais técnicas, MFA, revisão independente, proteção de ambiente, validação ou gates de produção.

## 5. Memória operacional e aprendizagem

A aprendizagem deve seguir a política existente `AURORA-AI-LEARNING-001`:

- conhecimento privado bruto permanece no armazenamento local/tenant autorizado;
- o plano de controle comum recebe somente padrões abstratos, sanitizados e reutilizáveis;
- cada lição referencia evidência, versão/hash, autor autorizado, validade e resultado observado;
- fatos, inferências e pendências permanecem separados;
- a revogação de fonte ou autor invalida a elegibilidade da lição;
- repetir o mesmo caso não cria amostra independente;
- nenhuma lição concede permissões, altera políticas ou autoriza a si própria;
- não alegar treinamento de pesos, aprendizagem estatística ou eficácia causal sem mecanismo e evidência específicos.

## 6. Integração no AURORA NEXUS

- **Motor Intrínseco:** constrói e valida o contrato da tarefa e produz decisão estruturada.
- **Plano de controle em nuvem:** distribui versões de políticas e padrões sanitizados; não recebe dados brutos de clientes.
- **AURORA-ORG-001:** converte eventos operacionais verificados em propostas limitadas e mensura resultados observados.
- **AURORA-SEC-001:** aplica menor privilégio, isolamento, proveniência, revogação, segurança de dados e gates.
- **AURORA-DEV-001:** mantém branch/PR, testes, CI, release cockpit e distinção entre código, homologação e produção.
- **M01–M10 e M03.1/JFN-AUD-FAT-001:** permanecem módulos do sistema-mãe; WMGJ continua tenant-piloto, não dependência estrutural.

## 7. Contrato mínimo de saída

Toda resposta operacional do motor deve ser serializável em uma estrutura equivalente a:

```json
{
  "contract": "AURORA-CHELFEX-001",
  "version": "1.1.2-rc.1",
  "tenantScope": "verified-tenant",
  "task": "short actionable objective",
  "status": "FACT | INFERENCE | PENDING | BLOCKED",
  "evidenceRefs": [],
  "decision": "single best safe next step",
  "riskLevel": "R0 | R1 | R2 | R3 | R4",
  "authorization": "verified | required | denied | not-applicable",
  "acceptanceCriteria": [],
  "verification": "not-run | passed | failed | inconclusive",
  "rollback": "not-applicable | available | required | unverified",
  "lessonRef": null
}
```

Os valores ilustrativos acima são um contrato conceitual, não prova de que o runtime já os emita. O esquema final de produção deve ser fechado e validado no servidor; campos desconhecidos devem ser rejeitados.

## 8. Critérios de aceite para implementação

1. Testes unitários para normalização, campos ausentes, saída estruturada e classificação de risco.
2. Testes adversariais para prompt injection em documentos, tentativa de elevação de alçada e instruções que peçam vazamento entre tenants.
3. Testes de autorização no servidor: sessão expirada, membership revogado, tenant incompatível, MFA ausente e permissão insuficiente.
4. Testes de idempotência, concorrência, revogação de evidência, fonte obsoleta e esquema desconhecido.
5. Testes que comprovem que nenhuma resposta textual isolada inicia executor não permitido.
6. Testes de regressão dos fluxos intrínsecos e orgânicos existentes.
7. CI verde no SHA candidato, revisão de segurança, validação em HML e readback autenticado antes de qualquer alegação de ativação.
8. Rollback demonstrável para mudanças operacionais; nenhuma promoção automática para escrita irrestrita ou geração/executação livre de código.

## 9. Estado e próximo passo

O adaptador `auroraChelfex.ts` é chamado por `buildMasterOperationalState()`,
compartilhado pelo endpoint `/api/master-engine`, bootstrap e kernel Windows.
A política executável `CHELFEX_POLICY` possui hash SHA-256 de sua serialização JSON;
a política declarativa contém um espelho `runtimePolicy` verificado por teste.
O hash identifica esse contrato executável, não todos os parágrafos desta especificação.

A tarefa possui esquema fechado: `schemaVersion`, `orgId`, `operation`, `objective`.
O objetivo é dado não confiável, limitado a 1.024 bytes e somente resumido por hash.
Operação vem de enum explícito; texto não é interpretado como comando.
Contexto de organização/autoridade vem do handler após sessão, membership e escopo,
nunca de body/query/modelo. O adaptador puro não autentica uma identidade por si só.
Importação Windows permanece `LOCAL_UNVERIFIED_PREVIEW`, sem prova cloud.

Conclusões distinguem FACT (resultado do gate, não veracidade integral da fonte),
INFERENCE (regras nativas) e PENDING. Cada conclusão elegível referencia o snapshot,
hash, versão, data e caminho do dado. Fontes inválidas/revogadas/obsoletas não
sustentam conclusões. Risco R0–R4 descreve a operação, não a severidade do achado.
R2–R4 sempre informam requisitos e bloqueio; não existe executor CHELFEx.
O JSON de saída do item 7 continua conceitual; a implementação acrescenta estado
por conclusão e verificações separadas de schema, evidência, execução e readback.

O registro nativo continua `AURORA-MASTER-OPS-001`; Release Cockpit expõe CHELFEx
como `IMPLEMENTED_PENDING_HML_READBACK`. Não há novo scheduler, endpoint, banco,
escrita em audit ledger ou lição promovida. O pipeline completo do item 3 continua
alvo futuro: execução/registro de lição não foram implementados neste incremento.

Validação: build Functions, regressões, testes `aurora-chelfex*.test.ts` (incluindo
handler HTTP real com dependências sintéticas e paridade de compilação CommonJS),
e `scripts/chelfex-synthetic-readback.cjs`. O workflow orgânico preserva TAP e
readback vinculados ao SHA. O harness simula identidade; não equivale a sessão
real, deploy ou homologação cloud. Nenhum parecer independente é fabricado.

Rollback: reverter o commit candidato e recompilar o mesmo produto; nenhuma
migração ou reversão de dados é necessária. Não instalar pacote de teste no cliente.
Preservar o predecessor aprovado e validar seu readback antes de uma reversão real.
