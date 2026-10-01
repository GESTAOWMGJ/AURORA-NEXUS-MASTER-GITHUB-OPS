# Base de Inteligência Operacional WMGJ

## Status

Esta é a base operacional canônica do projeto WMGJ para automação Apps Script e evolução futura para aplicativo desktop/mobile.

Esta base deve ser tratada como referência de decisão técnica, não como rascunho conversacional.

## Regra central

O Apps Script publicado deve ter uma única fonte operacional dentro de `src/`.

Arquivos fora de `src/` são legado, referência histórica ou material não publicado. Eles não devem ser copiados para o projeto Apps Script.

## Padrão operacional atual

1. O deploy oficial ocorre via GitHub Actions.
2. O workflow copia apenas:
   - `appsscript.json`
   - `src/*.gs`
3. Antes do deploy, a auditoria `tools/audit-appscript.js` deve bloquear:
   - funções globais duplicadas em `src/`;
   - variáveis globais duplicadas reais;
   - ID literal da planilha mestre espalhado em múltiplos arquivos;
   - tentativa de publicar pastas legadas como `apps-script/` ou `appsscript/`.
4. Wrappers legados podem existir apenas para compatibilidade com gatilhos antigos.
5. A lógica real deve permanecer em funções versionadas ou internas.
6. Funções auxiliares internas devem usar sufixo `_` quando não forem entradas públicas.
7. Funções de teste não devem colidir com funções públicas operacionais.
8. A memória-base só deve receber documentos `PROCESSADO`.
9. A fila deve concentrar estados transitórios como `PENDENTE`, `PROCESSANDO`, `ERRO_REPROCESSAR`, `REVISAR_HUMANO` e `DUPLICADO`.
10. Falha individual de arquivo não pode derrubar o lote inteiro.

## Correção estrutural registrada

Foram identificadas três duplicidades reais de função entre `01_PIPELINE_CONFIABILIDADE_WMGJ.gs` e `03_TESTES_PIPELINE_WMGJ.gs`:

- `testePipelineArquivosReaisWMGJ`
- `testeValidarJsonIAWMGJ`
- `testeDeduplicacaoMemoriaWMGJ`

Decisão tomada:

- manter as entradas operacionais estáveis no núcleo oficial;
- renomear as rotinas específicas do arquivo de teste com sufixo `_CONTROLADO`;
- manter `testeSuiteConfiabilidadePipelineWMGJ` como entrada pública de suíte controlada;
- refinar a auditoria para diferenciar variável local de variável global real.

## Princípio anti-corrupção operacional

Comandos futuros não devem desfazer esta base sem passar por uma alteração explícita, versionada e auditável.

Qualquer mudança que tente:

- reintroduzir função global duplicada;
- publicar código fora de `src/`;
- copiar pastas legadas para o Apps Script;
- espalhar ID fixo de planilha fora da configuração central;
- remover a auditoria do workflow;

é considerada regressão operacional.

## Fonte única de verdade

A ordem de confiança é:

1. Código em `src/` validado pela auditoria.
2. Workflow `.github/workflows/deploy-appscript.yml`.
3. Documentação em `docs/`.
4. Arquivos legados apenas como histórico, nunca como fonte de deploy.

## Direção futura: aplicativo

A automação atual deve evoluir para uma aplicação com dashboard interativo, mantendo o Apps Script como motor operacional enquanto a interface cresce de forma independente.

Arquitetura recomendada:

- Interface: React + TypeScript.
- Desktop Windows/macOS: Tauri.
- Mobile iOS/macOS futuro: camada web/app com API intermediária.
- Backend inicial: Apps Script Web App ou API intermediária Node.
- Estado operacional: JSON padronizado vindo das abas de controle, status, fila e memória-base.

## Módulos futuros do app

- Dashboard operacional.
- Status da automação.
- Fila de documentos.
- Memória-base.
- Auditoria de duplicidades.
- Logs de execução.
- Ações humanas controladas: reprocessar, revisar, aprovar, ignorar, diagnosticar.

## Contrato mínimo de dados do dashboard — v1 estável

`app-foundation/contracts/operational-status.schema.json` permanece o contrato legado compatível e não recebe os novos estados/campos.

```json
{
  "status": "OK|ATENCAO|ERRO",
  "ultimaExecucao": "ISO_DATE",
  "pipeline": {
    "pendentes": 0,
    "processando": 0,
    "processados": 0,
    "duplicados": 0,
    "erros": 0,
    "revisaoHumana": 0
  },
  "auditoria": {
    "ok": true,
    "erros": [],
    "avisos": []
  },
  "acoesDisponiveis": [
    "diagnosticar",
    "processarFila",
    "reprocessarErros",
    "auditarCodigo"
  ]
}
```

## Contrato AURORA NEXUS v2

A evolução da interface usa `app-foundation/contracts/operational-status.v2.schema.json`, com `schemaVersion: 2`. O v2 pode representar `CRITICO` e `BLOQUEANTE`, `Client Operation Skill`, perda financeira com confiabilidade por cifra, atrito do teste e estado orgânico governado.

`mode` representa somente `trial|contracted`; `environment` representa somente `hml|production`. O estado orgânico permanece `READ_ONLY`, `activationAllowed=false` e sujeito a revisão humana.

O manifesto server-side canônico fica em `firebase-migration/schemas/organic-patcher.schema.json`. Ele não substitui o checkpoint/runtime AURORA-ORG-001 nem autoriza autoaplicação.

## Regra de evolução

Toda nova interface deve consumir um contrato de dados explícito e versionado. Mudança incompatível exige nova versão; o mesmo `$id` não deve ganhar semântica incompatível silenciosamente. A interface não deve depender diretamente de nomes soltos de abas, colunas ou funções Apps Script sem uma camada de adaptação.
