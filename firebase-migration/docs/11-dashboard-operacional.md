# Dashboard operacional orientado por evidência

## Trabalho analítico

Monitoramento assíncrono de fila, revisão, auditoria e conciliação. O objetivo do primeiro olhar é responder:

> A operação pode prosseguir, quão atuais/completos são os dados e qual pendência exige ação humana primeiro?

## Artefatos

- faixa de confiança com transporte, frescor, completude e severidade separados;
- cards com valores explícitos e `—` quando não aferidos;
- barras horizontais DOM/CSS para composição da fila;
- tabela/lista de alertas com evidências;
- fontes e última atualização;
- resumo textual como fallback de qualquer representação visual.

Não existe “índice de integridade” calculado por `processados/total`. Integridade depende de cobertura de evidência, gates de migração e reconciliação.

## Contrato e projeção

O frontend consulta o FastAPI, que lê `organizations/{orgId}/dashboardSnapshots/{id}`. Ele não faz fan-out pelas coleções brutas. O snapshot é sanitizado e tipado pelo schema `dashboard-snapshot.schema.json`. Nesta primeira versão, o agregado é de toda a organização e só é entregue a memberships com `allFacilities=true`; recortes por unidade deverão usar snapshots e rotas próprias.

Estados independentes:

| Dimensão | Valores |
|---|---|
| Transporte do cliente | `ONLINE`, `RECONNECTING`, `OFFLINE` |
| Frescor | `FRESH`, `DELAYED`, `STALE`, `UNKNOWN` |
| Completude | `COMPLETE`, `PARTIAL`, `EMPTY`, `INVALID` |
| Severidade | `NOMINAL`, `ATTENTION`, `BLOCKED`, `UNKNOWN` |

Ausência não vira zero. Um snapshot pode estar simultaneamente offline, stale, parcial e com atenção.

## Atualização e falhas

- polling de 60 segundos na homologação;
- último snapshot confiável mantido somente em memória;
- nenhum cache persistente de Firestore em dispositivo compartilhado;
- filtros `org` e `competence` ficam na URL;
- reconexão não apaga tela nem seleção;
- dados atrasados mostram idade e `asOf`;
- ação mutável não existe nesta interface inicial.

## Mobile e acessibilidade

- mobile portrait é superfície primária;
- confiança e alertas antes dos controles;
- alvos de toque de no mínimo 44 px;
- valores essenciais sem hover;
- texto + símbolo/cor para estados;
- foco visível, skip link, `aria-live` com baixa verbosidade;
- redução de movimento e alto contraste;
- nenhuma grade extensa antes da evidência principal.

Renderer: DOM/CSS, no máximo uma barra composta e uma lista de alertas visíveis. Fallback: texto/tabela. A escolha evita bundle de gráficos, melhora impressão e reduz custo de manutenção.
