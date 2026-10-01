# MODUS OPERANDI ATUAL — WMGJ

**Versão operacional:** 2026-07-13  
**Aplicação:** documentos, Gmail, Drive, Apps Script, Gemini, banco operacional, relatórios e governança.

## 1. Princípio central

A operação WMGJ deve funcionar como uma cadeia auditável:

```text
Documento-fonte
→ captura controlada
→ fila
→ extração/OCR
→ classificação
→ validação
→ memória-base
→ base temática
→ conciliação
→ dashboard
→ relatório
→ decisão humana quando exigida
```

Nenhuma camada posterior deve inventar, sobrescrever ou ocultar a evidência da camada anterior.

## 2. Hierarquia das fontes de verdade

1. **Documento original** no Gmail/Drive.
2. **Planilha mestre** para dados estruturados e trilha operacional.
3. **GitHub oficial** para código e documentação.
4. **Apps Script implantado** para execução real.
5. **Relatórios** como síntese, nunca como substitutos da base.

Em caso de divergência:

- documento original prevalece sobre resumo;
- base validada prevalece sobre inferência;
- execução comprovada prevalece sobre código apenas versionado;
- contabilidade e documentos fiscais prevalecem sobre estimativas gerenciais.

## 3. Entrada documental

### Canais

- Gmail institucional;
- Google Drive;
- upload manual;
- webhook autenticado.

### Regras

- processar somente itens novos;
- registrar `messageId`, `threadId`, `fileId`, nome, MIME type e data;
- salvar anexos no Drive antes do processamento;
- preservar documento-fonte;
- calcular hash;
- bloquear duplicidade por identidade + hash;
- não excluir definitivamente documentos operacionais sem revisão.

## 4. Fila de processamento

Aba oficial:

```text
15_FILA_PROCESSAMENTO
```

Status permitidos:

```text
PENDENTE
PROCESSANDO
PROCESSADO
ERRO
ERRO_REPROCESSAR
DUPLICADO
REVISAR_HUMANO
```

Regras:

- `PENDENTE` não é documento processado;
- item em processamento deve registrar tentativa e última ação;
- erro individual não derruba o lote;
- reprocessamento deve ser explícito;
- item não pode permanecer indefinidamente em `PROCESSANDO`;
- watchdog deve liberar ou sinalizar travas vencidas.

## 5. Extração e OCR

Ordem recomendada:

1. texto nativo quando disponível;
2. parser específico para XML, CSV ou planilha;
3. OCR via Drive API/serviço habilitado;
4. Gemini para interpretação semântica;
5. revisão humana quando ilegível ou de baixa confiança.

Sempre registrar:

- método de extração;
- tamanho do texto;
- amostra controlada;
- versão do extrator;
- status;
- erro sanitizado.

## 6. Classificação Gemini

Modelo operacional validado:

```text
gemini-3.5-flash
```

Regras:

- chave em `GEMINI_API_KEY` nas Script Properties;
- modelo em `GEMINI_MODEL`;
- nunca armazenar chave em código, GitHub, planilha ou log;
- exigir JSON válido;
- validar categoria, confiança e campos mínimos;
- registrar `origem_classificacao = gemini` somente em resposta real aprovada;
- usar `fallback_local` em indisponibilidade;
- erro 503 não invalida chave nem modelo;
- fallback não deve ser confundido com classificação Gemini.

Categorias documentais:

```text
financeiro
produtividade
contrato
glosa
relatorio
cadastro
outro
```

## 7. Memória-base

Aba oficial:

```text
14_MEMORIA_BASE_DOCUMENTOS
```

Somente registrar após processamento e validação.

Campos mínimos:

- data de registro;
- origem;
- ID de origem;
- nome do arquivo;
- MIME type;
- hash;
- competência;
- categoria;
- status;
- resumo validado;
- versão do classificador/extrator quando disponível.

A memória-base deve permitir rastrear o dado estruturado até o documento original.

## 8. Escrita nas bases temáticas

Antes de escrever em financeiro, produtividade, NFS-e, escala ou conciliação:

1. validar documento;
2. validar competência;
3. validar valor e formato;
4. verificar duplicidade;
5. confirmar aba e cabeçalhos;
6. preservar trilha de origem;
7. registrar log.

Não escrever valor financeiro a partir de resumo livre sem documento ou regra validada.

## 9. Conciliação mensal

Cruzar obrigatoriamente:

```text
Produção
× regra comercial
↔ NFS-e
↔ recebimento bancário
↔ escala/períodos
↔ repasses médicos
↔ tributos
↔ despesas
↔ saldo final
```

Separar sempre:

- competência assistencial;
- competência fiscal;
- data de emissão;
- data de recebimento;
- regime de caixa;
- competência contábil.

## 10. Repasses médicos

Regra vigente quando aplicável:

```text
1 período de 6 horas = R$ 1.000,00
```

Não converter automaticamente:

```text
1 dia com atendimento = 1 período
```

A dupla checagem deve confrontar:

- escala oficial;
- relatórios de atendimento;
- períodos estimados;
- repasse previsto;
- pagamento bruto;
- devoluções/abatimentos;
- saldo ou excesso;
- natureza societária ou contratual.

Divergência mantém competência `ABERTA_CONTROLADA` ou `BLOQUEADA`.

## 11. Relatório preliminar

Pode ser emitido quando houver:

- produção;
- NFS-e ou previsão claramente identificada;
- escala/custo médico estimado com evidência;
- ISS e premissas explícitas.

Deve conter a marcação:

```text
PRELIMINAR — SUJEITO A CONCILIAÇÃO BANCÁRIA, CONTÁBIL E DOCUMENTAL
```

## 12. Relatório final

Somente liberar quando houver:

- NFS-e validada;
- recebimento conciliado;
- escala/períodos confirmados;
- repasses conciliados;
- tributos e despesas classificados;
- documentos faltantes resolvidos;
- pendências críticas encerradas;
- validação contábil/societária quando aplicável.

Status recomendado:

```text
FECHADO_OPERACIONALMENTE
FECHADO_CONTABILMENTE
NAO_DISTRIBUTIVO
DISTRIBUTIVO_APROVADO
```

Nunca usar saldo bancário isolado para marcar resultado como distribuível.

## 13. Relatórios executivos

Todo PDF mensal/geral deve conter:

1. capa institucional;
2. competência e data-base;
3. versão do documento;
4. sumário executivo;
5. KPIs;
6. resultado atual;
7. resumo mensal;
8. acumulado;
9. produção por médico;
10. conciliação NFS-e x banco x produção;
11. dupla checagem de repasses;
12. tributos e despesas;
13. pendências e riscos;
14. decisão recomendada;
15. status preliminar/final e distributivo/não distributivo;
16. anexos/evidências.

## 14. Contratos médicos e societários

- contrato PJ individual aplica-se a médicos externos não sócios;
- sócios seguem instrumento societário, deliberações, pró-labore, distribuição ou regras próprias;
- minutas permanecem bloqueadas para assinatura até revisão jurídica e contábil;
- nenhum documento contratual deve afirmar eliminação absoluta de risco trabalhista;
- serviços pretéritos devem ser regularizados por competência, período, pagamento e documento fiscal.

## 15. Logs e pendências

### Log

```text
10_LOG_AUTOMACAO
```

Registrar:

- data/hora;
- status;
- comando/rotina;
- origem;
- mensagem sanitizada;
- evidência resumida.

### Pendências

```text
11_PENDENCIAS_SANEAMENTO
```

Registrar:

- tipo;
- competência;
- descrição;
- impacto;
- prioridade;
- status;
- ação recomendada;
- responsável;
- prazo/SLA.

## 16. CI/CD e implantação

Fonte de deploy:

```text
src/*.gs
appsscript.json
.github/workflows/deploy-appscript.yml
```

Regras:

- GitHub `main` não prova que o Apps Script está atualizado;
- deploy exige execução real do GitHub Actions;
- `clasp push --force` deve concluir;
- verificação pós-deploy deve localizar versão e função sentinela;
- `CLASPRC_JSON` fica somente em GitHub Secrets;
- versão implantada deve ser confirmada no runtime;
- falha de deploy não altera a validade do código versionado, mas impede afirmar alinhamento operacional.

## 17. Segurança e travas humanas

Não executar automaticamente sem aprovação definida:

- pagamentos;
- PIX;
- emissão/cancelamento fiscal;
- assinatura de contrato;
- envio ao DocuSign;
- distribuição de lucros;
- alteração societária;
- exclusão definitiva de documentos.

## 18. Critério de saúde operacional

Sistema saudável quando:

```text
Fila sem itens presos
Erros isolados e registrados
Sem duplicidade falsa
Memória-base rastreável
Gemini validado ou fallback explícito
Logs atualizados
Pendências priorizadas
Dashboard coerente
Relatório conciliável
Deploy comprovado
```

## 19. Rotina de retomada

Ao reiniciar o trabalho:

1. ler `docs/CHECKPOINT_ATUAL_WMGJ_OPERACAO.md`;
2. conferir `13_CONTROLE_PIPELINE`;
3. verificar últimas linhas de `10_LOG_AUTOMACAO`;
4. verificar pendências críticas;
5. confirmar versão do Apps Script;
6. executar somente a próxima pendência prioritária;
7. registrar novo checkpoint.

## 20. Regra final

> Preservar a V3 estável, evoluir por camadas, validar antes de gravar, conciliar antes de concluir e comprovar antes de declarar concluído.
