# AURORA-TISS-SADT-001 — ferramenta de faturamento no motor

Versão do componente: **1.0.0**. Data do incremento: **21/10/2026**.
Módulo preservado: **M03.1 / JFN-AUD-FAT-001**, com M01, M08, M09 e M10.
Baseline de engenharia: `226a7f101f4bf1e0680afca2459132f01ebaf71d`.

## Resultado e estado

O incremento acrescenta uma ferramenta executável à IA Master existente:

1. importar XML TISS SP-SADT selecionado na sessão autenticada;
2. extrair guias, procedimentos, despesas e totais por regra determinística;
3. apresentar divergências e verificações ainda pendentes;
4. preparar os campos a partir da análise mantida no servidor;
5. identificar a aba configurada, preencher e ler os campos de volta;
6. registrar tentativa e resultado por hashes na auditoria existente.

O parser é genérico para o subconjunto suportado. O executor de navegador desta
versão aceita somente a fixture sintética incluída no pacote, em ambiente de
homologação configurado. Dados clínicos reais não são enviados a portais nem
persistidos no Firebase por este componente. Não existe transmissão de lote,
geração de protocolo, baixa financeira ou autorização de pagamento.

Estado de engenharia: **IMPLEMENTED**, com testes sintéticos locais. CI no SHA
candidato, instalação, homologação de portal, adoção com dados reais e produção
são evidências independentes, registradas no PR e nos recibos correspondentes.
A existência deste documento não promove nenhum desses estados.

Não há outro motor, servidor permanente, banco, scheduler ou processo de IA.
O módulo usa a mesma porta local, sessão, organização, empacotador e auditoria da
IA Master. O modelo local e os provedores externos não participam do cálculo.

## Referência oficial e escopo XML

Consulta ANS em 21/10/2026: publicação **Setembro/2026**; componente Comunicação
**04.03.00**. O valor literal no XML é **`4.03.00`**, sem zero à esquerda.
Organizacional e TUSS são `202609`; Conteúdo/Estrutura e Segurança/Privacidade
são `202511`. A vigência de cada código deve ser conferida no catálogo aplicável.

Fontes primárias:

- [Publicação TISS Setembro/2026](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-setembro-2026).
- [Componente Comunicação e XSD oficiais](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/PadroTISSComunicao_202511.zip).
- [Componente Organizacional 202609](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/PadroTISS_ComponenteOrganizacional_202609.pdf).
- [Contrato escrito entre operadora e prestador](https://www.gov.br/ans/pt-br/assuntos/prestadores/fator-de-qualidade-1/obrigatoriedade-do-contrato-escrito).

| Elemento | Contrato implementado |
| --- | --- |
| Namespace | `http://www.ans.gov.br/padroes/tiss/schemas` |
| Raiz | `mensagemTISS` |
| Versão | `cabecalho/Padrao = 4.03.00` |
| Mensagem | `ENVIO_LOTE_GUIAS` |
| Lote | `prestadorParaOperadora/loteGuias` |
| Guias | `guiasTISS/guiaSP-SADT`, até 100 por lote |
| Procedimentos | `procedimentosExecutados/procedimentoExecutado` |
| Outras despesas | `outrasDespesas/despesa/servicosExecutados` |
| Total geral | `valorTotal/valorTotalGeral` |

Outras versões, tipos de mensagem, categorias de guia e estruturas desconhecidas
ficam rejeitados ou pendentes de implementação. Não reinterpretar XML de NFS-e
como TISS nem usar a versão de monitoramento ANS `01.06.00` como versão SP-SADT.

O parser aceita identificadores textuais e preserva zeros à esquerda. CNPJ segue
o domínio alfanumérico do XSD 4.03.00. Credenciais em `loginSenhaPrestador` são
rejeitadas; a senha de autorização de uma guia é um campo assistencial distinto.

## Conferência financeira e TUSS

Os cálculos usam `Decimal`; os totais canônicos da análise usam centavos inteiros.
Procedimentos e despesas são reconciliados separadamente, inclusive materiais,
medicamentos, gases, diárias, taxas e OPME. Ausência de total opcional permanece
ausência; não é convertida em zero comprovado.

A comparação de item usa quantidade × valor unitário × fator de redução/acréscimo,
com `ROUND_HALF_UP` como regra **local de conferência**. Isso não é apresentado
como arredondamento universal imposto pela ANS. O XML não é corrigido nem
reescrito. Divergência fica `REVIEW_REQUIRED`.

O módulo extrai tabela/código e verifica formatos básicos, inclusive o código de
procedimento da tabela 22. Não inclui o catálogo TUSS completo nem verifica
vigência sem uma referência incorporada. Um código TUSS não fornece preço,
cobertura ou autorização. Esses fatos dependem das regras e do contrato aplicáveis.

O retorno mantém explicitamente:

```json
{
  "xsdValidated": false,
  "catalogValidated": false,
  "contractValidated": false,
  "tissHashState": "PRESENT_UNVERIFIED"
}
```

`VALIDATED_LOCAL` significa apenas que as conferências locais implementadas não
encontraram divergência. Não significa XML integralmente conforme, conta liberada
ou autorização da operadora. O hash TISS do epílogo e assinatura digital não são
verificados nesta versão. SHA-256 de proveniência não substitui esses mecanismos.

## Integração executável

| Arquivo | Responsabilidade |
| --- | --- |
| `aurora-coletor/aurora_tiss.py` | Parser e conferência determinística, função pura e CLI JSON |
| `desktop/ia-master/tiss-tool.cjs` | Plano por sessão, limites, expiração, auditoria e idempotência |
| `desktop/ia-master/tiss-browser.cjs` | Adaptador Chromium/Edge via CDP em loopback |
| `desktop/ia-master/tiss-local.js` | Importação, revisão e controles da tela existente |
| `desktop/ia-master/server.cjs` | Rotas autenticadas `/api/tiss/*` no servidor existente |
| `desktop/ia-master/build.py` | Mesmo pacote IA Master, com hashes dos novos componentes |
| `firebase-migration/functions/src/auroraNativeRoutines.ts` | Registro nativo e política de capacidade |
| `firebase-migration/functions/src/auroraReleaseStatus.ts` | Pendências próprias no Release Cockpit |

O núcleo Firebase continua planejador de operações canônicas. Não passa a aceitar
XML clínico no endpoint genérico nem executa o navegador na nuvem. O registro
nativo usa `NATIVE_GOVERNED`; `registrationOnly=false` identifica o executor
implementado, sem afirmar que o dispositivo já o carregou.

### API local

Todas as rotas abaixo passam pela autenticação, vínculo de organização, origem,
proteção contra DNS rebinding e CSRF já existentes. O corpo não aceita `orgId`,
comando, caminho de arquivo, executável, seletor ou domínio fornecido pelo XML.

| Rota | Método / corpo | Efeito |
| --- | --- | --- |
| `/api/tiss/status` | GET | Capacidade e limites, sem conteúdo de guias |
| `/api/tiss/analyze` | POST `{xml}` | Análise local em memória |
| `/api/tiss/plan` | POST `{analysisId, guideIndex}` | Plano derivado da análise do servidor |
| `/api/tiss/inspect` | POST `{planId}` | Observação da aba autorizada |
| `/api/tiss/fill` | POST `{planId, expectedPlanHash, targetId, expectedUrl}` | Preenchimento sintético limitado |
| `/api/tiss/clear` | POST `{}` | Limpeza das análises e planos da sessão |

Respostas usam `Cache-Control: no-store`. O parser recebe JSON por `stdin`, nunca
XML em argumentos do processo ou arquivo temporário. Ele roda sem shell, com
Python em modo isolado, tempo e saída limitados. A configuração do executável
é administrativa e não pode ser modificada pelo pedido de análise.

Limites: XML até 1 MiB; oito análises e dezesseis planos em memória por processo;
TTL de quinze minutos, com timers que removem referências mesmo em inatividade.
O painel também limpa referências e conteúdo exibido na expiração; verifica
o prazo ao voltar a uma aba suspensa. Logout, limpeza e encerramento do servidor
também removem as referências.
Uma análise iniciada antes da limpeza não pode repovoar o cache depois dela.
Isso não é garantia de apagamento físico da RAM pelo sistema operacional.

O frontend lê UTF-8 com validação de codificação e ISO-8859-1 sem conversão
silenciosa para Windows-1252. O `sourceSha256` usa o **texto XML recebido codificado
em UTF-8**, identificado por `sourceHashBasis=UTF8_XML_TEXT`; não representa
automaticamente os bytes originais de um arquivo ISO-8859-1.

## Configuração e uso

O componente é empacotado pelo fluxo existente, sem ativação de portal automática.
No diretório privado já usado por `AURORA_MASTER_STATE`, a configuração mínima
`tiss-configuration.json` é:

```json
{
  "schemaVersion": "aurora.tiss.config.v1",
  "orgId": "organizacao-autenticada",
  "pythonExecutable": "C:\\caminho-validado\\python.exe"
}
```

O valor deve corresponder ao executável instalado e à identidade efetiva da IA
Master. O caminho acima é um exemplo de formato. Não inferir prestador/CNPJ pelo
nome da organização. Na operação autorizada, usar a instalação e configuração
existentes, conferir seus hashes e reiniciar somente o componente próprio pelo
gerenciador vigente, com retorno e rollback. Este incremento não faz essa
instalação nem reinicia dispositivos.

Na tela **IA Master → Faturamento TISS / SP-SADT**:

1. selecionar o XML autorizado ou usar o exemplo sintético;
2. conferir o lote, as guias, procedimentos, despesas e pendências;
3. para a fixture e portal de ensaio já configurado, preparar os campos;
4. conferir a única aba elegível e acionar o preenchimento de teste;
5. conferir o recibo e o estado efetivo da página.

### Mapeamento do navegador

Configuração adicional exige `environment=SYNTHETIC_HOMOLOGATION`, referência de
revisão administrativa, versão de mapeamento, operadora e identidade do prestador.
O objeto `browser` contém `orgId`, `debuggingOrigin`, `portalOrigin`,
`allowedPathPrefix` e `fieldMap`.

- `debuggingOrigin` aceita somente `http://127.0.0.1:<porta>`.
- `portalOrigin` é uma origem HTTPS exata. Não há descoberta de portais.
- `fieldMap` vincula chave semântica a seletor revisado, por exemplo
  `"procedures.0.procedureCode": "#procedimento-0-codigo"`.
- Cada mapeamento pode definir formato `raw`, `date-br` ou `decimal-comma`.
- Prestador, carteira, guia e total geral devem estar mapeados. Todos os itens
  exigem sequência, execução, tabela, código, quantidade, fator, unitário e total;
  despesas também exigem categoria e unidade. Campos adicionais mapeados precisam
  existir na análise. Linhas ausentes não são criadas automaticamente.
- O código da fixture usa operadora `999999` e prestador `TESTE000001`, ambos
  sintéticos. Esses valores nunca devem ser copiados para uma operação real.

O navegador deve usar perfil de teste isolado, sem contas reais, e depuração
restrita ao loopback. Não abrir a porta na rede, extrair cookies ou copiar a
sessão de outro usuário. O módulo não inicia Chrome/Edge nem altera sua segurança.

O adaptador usa função fixa em contexto isolado e parâmetros literais. Não
executa scripts vindos do XML. Verifica origem, caminho, aba, unicidade, visibilidade,
editabilidade e valores prévios antes da primeira escrita. Depois confere os
valores lidos. Não automatiza login, CAPTCHA ou MFA, nem clica em enviar.

**Eventos `input` e `change` podem acionar autosave do próprio portal.**
`submissionAttemptedByAdapter=false` significa ausência de comando explícito do
adaptador, não ausência comprovada de efeito externo. O recibo mantém
`portalPersistenceVerified=false`. Homologação do portal deve incluir esse aspecto.

## Auditoria, concorrência e retomada

O plano vincula organização, fonte, guia, mapeamento e valores por hash. O pedido
de preenchimento envia a referência e o hash esperado, não novos valores.

O executor usa exclusão mútua dentro do processo e lock exclusivo no diretório
privado existente. Registra `TISS_FILL_INTENT` no `audit.jsonl` existente com
flush antes de chamar o navegador, e registra o resultado antes de liberar a
trava. A auditoria contém apenas hashes, contagens, estados e códigos fixos.
URL completa, XML, carteira, autorização, preços e credenciais não são registrados.

Qualquer tentativa anterior da mesma guia/operadora/prestador/organização bloqueia
repetição automática, inclusive após reinício. Timeout, resposta incompleta ou
queda depois do início do efeito produzem revisão, não sucesso presumido. Lock
abandonado ou auditoria inconsistente também exigem reconciliação. Não remover
travas ou apagar a auditoria para fazer uma tentativa passar.

Nesta versão não existe comando de promoção de uma tentativa incerta para
reenvio. A resolução exige revisão do resultado e incremento governado no mesmo
executor. Flush de arquivo não é uma certificação de tolerância à perda física
de energia de qualquer dispositivo.

Estados do adaptador: `FILLED_DRAFT`, `NOT_FILLED`, `PARTIAL_REVIEW_REQUIRED` e
`UNKNOWN_RESULT_REVIEW_REQUIRED`. Nenhum desses estados equivale a lote recebido,
conta aprovada, glosa resolvida ou pagamento conciliado.

## Evidências de engenharia

O teste sintético possui procedimento de R$ 100,50 e material de R$ 6,50,
totalizando R$ 107,00. Esses números existem somente para verificar o algoritmo.

Fixture `aurora-coletor/fixtures/tiss/sp-sadt-4.03.00.synthetic.xml`:
`aab51bf1f3c7b28dba3de0e35ccf35a5408cf610771dbc35e565bf2b23f81dc8`.

ZIP oficial ANS consultado:
`db8640e1c3b87085892f54f838bfcea9934439ff365798c8428559f88c13d62d`.

A fixture passou em validação independente pelo conjunto XSD oficial 4.03.00.
Isso valida a fixture, não acrescenta um validador XSD ao runtime.

Suítes novas verificam parser, origem/CSRF/sessão, isolamento, limites, memória,
duplicidade, totais, mapeamento, replay, concorrência, intenção anterior ao efeito,
resultado incerto e limpeza durante análise. Testes com Chromium real verificam
preenchimento/leitura e o fluxo completo da UI com parser Python real, incluindo
arquivo ISO-8859-1. Só foram usados dados e páginas sintéticos.

Os testes determinísticos são incorporados ao workflow existente **Validate
Aurora Installers**, com verificação da composição e hashes do mesmo pacote.
Os testes Chromium são opt-in e não acrescentam dependência ao runtime:

```bash
python3 -m unittest discover -s aurora-coletor -p test_aurora_tiss.py -v
node --test desktop/ia-master/tiss-tool.test.cjs desktop/ia-master/tiss-browser.test.cjs
AURORA_TEST_BUILD=/caminho/pacote node --test desktop/ia-master/tiss-http.test.cjs
```

Para os testes Chromium, fornecer `AURORA_TISS_CHROMIUM_TEST=1`,
`AURORA_TISS_CHROMIUM_EXECUTABLE` e, no teste de UI, `AURORA_TEST_BUILD`.
Playwright é ferramenta de teste externa ao pacote e deve estar instalado no
ambiente de testes. Os testes não usam o perfil do usuário.

## Próximo gate e rollback

Antes de operação real: CI do candidato, instalação comprovada no executor,
versão/catalogação TUSS e contrato aplicáveis, validação XSD/hash/assinatura quando
exigida, portal e mapeamento homologados, identidade da conta/prestador verificada,
finalidade e requisitos de privacidade aprovados, governança clínica vigente,
fluxo de retorno/protocolo e reconciliação antes de retry. O módulo não libera
esses gates por configuração livre nem herda uma autorização de outro tenant.

Uma operadora e um endereço de portal concretos ainda precisam ser escolhidos
para o adaptador operacional. O WSDL oficial pode fundamentar integração direta
futura, mantendo o mesmo proprietário dos efeitos e a mesma trilha de auditoria.

Rollback de código: reverter o commit candidato e reconstruir pelo empacotador
existente. Em dispositivo atualizado, usar o predecessor e backup verificados
do atualizador existente. Preservar `audit.jsonl` e qualquer trava/pendência para
reconciliação; reversão não apaga o histórico nem desfaz efeitos de um portal.

Aprendizado reutilizável: XML é dado, TUSS é identificação, preço exige contrato,
total inclui outras despesas, preenchimento não prova envio, protocolo não prova
pagamento e resultado incerto exige reconciliação. Só esse padrão abstrato pode
ser promovido entre organizações; documentos e regras privadas não o acompanham.
