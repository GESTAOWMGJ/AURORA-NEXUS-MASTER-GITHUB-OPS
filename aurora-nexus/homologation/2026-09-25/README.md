# AURORA NEXUS — cadastro e homologação, 25/09/2026

**Cadastro documental consolidado. Homologação integral em validação.**

Produto AURORA NEXUS; interface Visão; método JFN-AUD-GOV-001 e submódulo
M03.1 JFN-AUD-FAT-001. A base operacional vigente é Aurora Nexus 2.2.0.
Este registro não altera a versão registral histórica nem constitui registro oficial.

## Cadastro observado

| Item | Evidência e escopo |
| --- | --- |
| Portal institucional | https://wmgj-ops.web.app/portal |
| Versão pública | 1.5.4, observada no navegador e nas respostas HTTP |
| Projeto | wmgj-ops; ambiente com portal publicado, não sandbox vazio |
| Base recuperada do GitHub | product/aurora-nexus-registro-20260918, commit 006f086e84ddeb337bbc6e6195ca093f50829c10 |
| Correspondência fonte–implantação | Não demonstrada para o código 1.5.4 nesta sessão |
| Kernel histórico PR #14 | Draft aberto, conflitante, head 7f99dd481b4f7960279f9fa53683a91c0f443e8c |
| Novo registro | Branch ops/aurora-cadastro-homologacao-20260925; somente evidência e verificação pública |

O PR #14 não deve ser implantado por sobreposição no projeto operacional.
Nenhum runtime, projeto Firebase, regra de acesso, segredo, gatilho, documento-fonte
ou dado financeiro foi modificado por este registro. Nenhum merge ou deploy realizado.

## Verificações executadas nesta sessão

Em 25/09/2026 às 06h40min31s, America/Sao_Paulo, **5/5 cenários públicos passaram**:

| Cenário | Resultado |
| --- | --- |
| GET / | 200; marca e versão 1.5.4; private/no-store |
| GET /portal | 200; marca e versão 1.5.4; private/no-store |
| GET /api/portal/session sem credenciais | 401; JSON; sem recibos; no-store |
| GET /api/portal/batches sem credenciais | 401; JSON; sem recibos; no-store |
| GET /api/portal/session com Origin não autorizado | 403; JSON; sem recibos; no-store |

Resultado bruto sanitizado: `public-smoke.json`. O teste guarda hashes das respostas,
não corpos, cookies, tokens ou credenciais. Os caminhos das APIs foram identificados
no bundle público referenciado pela página. Foram usadas exclusivamente requisições GET.

Reexecução, a partir da raiz do repositório:

```sh
python aurora-nexus/homologation/2026-09-25/verify_public.py --output /tmp/aurora-public-smoke.json
```

Também passaram **60/60 testes locais** de `portal-auditoria/tests/*.test.mjs`,
executados com Node 24.19.0 no commit base `006f086`. Incluem escopo institucional,
ausência versus zero, centavos, evidências, revisão humana e recusas do gateway.
O projeto declara Node 22; esta execução local em Node 24 não substitui seu gate de CI.
Os testes pertencem à base recuperada, não à fonte exata da 1.5.4 publicada. Não somar
os dois conjuntos como validação de uma única versão ponta a ponta.

## Limites e conclusão

**Aprovado neste corte:** disponibilidade pública, identidade visual/versão declarada,
ausência de cache nos cinco cenários e recusas anônima/de origem testadas.
Isso não é auditoria completa de segurança nem homologação de operações financeiras.

**Pendências para homologação integral:**

1. Recuperar fonte exata da 1.5.4 e vincular commit, manifesto, build e revisão implantada.
2. Executar login institucional com MFA e verificar vínculo de organização/unidade.
3. Em escopo sintético segregado e autorizado, comprovar envio, recibo, readback,
   deduplicação, falha parcial e recusas entre organizações/unidades.
4. Comprovar restauração e rollback do escopo instalado.
5. Aprovar política contratual de SLA com responsável e referência documental.
6. Validar separadamente integração OpenAI, modelo/contrato, credencial de serviço,
   orçamento e conjunto sintético antes de declarar chamadas reais homologadas.

Os testes anteriores de emulador e ingestão registrados no dossiê operacional
permanecem evidência histórica; não foram repetidos neste corte. O console Firebase
retornou erro de conexão 502 nesta sessão, apesar da resposta 200 do portal. Não há
credenciais Firebase/ADC ou OpenAI configuradas neste ambiente de execução.
O comando remoto de status do Mac teve envio aceito; não retornou resultado de execução.

## OpenAI e conectores

O código recuperado usa Responses API com saída estruturada, `store=False`,
tratamento de recusa/incompletude e verificação de referências de evidência.
Inspeção de código não prova integração ativa; `store=False` não equivale a Zero Data
Retention. Referências oficiais consultadas em 25/09/2026:

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/your-data

Notion registra cadastro, decisões e evidências; Airtable conserva metadados de
implantação e pendências. Não há sincronização automática declarada com o Firestore.
Nenhuma credencial ou documento operacional privado integra este pacote público.

## Comparação com o legado

Preservar os sistemas atuais. Nenhum corpus foi enviado ao legado nem houve cutover.
Efetividade financeira permanece inconclusiva sem corpus comum, gabarito humano,
versões identificadas e mensuração pareada do fluxo completo, incluindo revisão e retrabalho.
