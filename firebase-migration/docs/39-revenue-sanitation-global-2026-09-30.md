# AURORA NEXUS — Saneamento Global de Pontas Soltas da Receita

**Capability:** AURORA-REV-SAN-001  
**Versão-base:** 2.4.0  
**Data:** 2026-09-30  
**Modo:** HOMOLOGATION / SHADOW

## Objetivo

Transformar o padrão observado em auditoria de faturamento, glosas, recebíveis e conciliação em uma capacidade nativa e reutilizável do AURORA NEXUS.

Uma **ponta solta** é qualquer exceção ainda não resolvida que possa alterar, atrasar, reduzir, duplicar, impedir ou distorcer algum ponto da cadeia:

```text
regra/contrato vigente
→ produção elegível
→ faturável
→ faturado
→ glosa/divergência
→ nota fiscal
→ recebível
→ crédito bancário
→ repasses/tributos
→ fechamento
```

A exceção permanece aberta até haver evidência verificável suficiente para atualizar o estado e, quando aplicável, conciliar o efeito financeiro.

## Princípios invariantes

1. **Ausência de evidência não é zero e não é resolução.**
2. **Faturado não é recebido.**
3. **Glosa informada não é glosa aceita.**
4. **Silêncio do terceiro não encerra a pendência.**
5. **Envio de cobrança não comprova recebimento nem resolução.**
6. **Exceções potencialmente sobrepostas não são somadas como perda ou recuperação.**
7. **Duplicidade e conflito de versão exigem exemplar canônico, sem apagar histórico.**
8. **Todo encerramento exige evidência e validação humana.**
9. **Fonte original é preservada; o AURORA cria vínculos, estados e trilha de auditoria.**
10. **LGPD por minimização: a fila executiva não deve carregar identificadores clínicos desnecessários.**

## Estados nativos da cadeia

- `PREVISTO`: expectativa ou projeção ainda não elegível para faturamento.
- `FATURAVEL`: produção elegível e suportada por regra vigente, ainda não faturada.
- `FATURADO`: documento fiscal/faturamento emitido, sem inferência automática de caixa.
- `RECEBIVEL`: obrigação financeira documentalmente sustentada e ainda não conciliada.
- `RECEBIDO`: crédito identificado, ainda sujeito à conciliação completa quando necessário.
- `RECUPERAVEL`: valor contestado ou pendente com hipótese defensável de recuperação.
- `DIVERGENTE`: conflito de fonte, versão, regra, valor, competência ou evidência.
- `ENCERRADO_COM_EVIDENCIA`: resolução documentada, validada e com efeito financeiro refletido.

## Famílias de exceção v1

### BILLED_NOT_RECEIVED

Nota/faturamento emitido sem crédito bancário conciliado.

**Saneamento mínimo:**
- competência;
- documento fiscal;
- prazo contratual;
- crédito bancário;
- retenções;
- glosa/retenção;
- memória de cálculo;
- vínculo de conciliação.

### BILLING_EVIDENCE_GAP

Há indício de faturamento ou valor, mas faltam elegibilidade, memória de cálculo, regra ou documento fiscal suficiente.

### GLOSS_UNSUPPORTED_OR_UNRESOLVED

Glosa/cancelamento sem encerramento documentado.

**Exigir, quando aplicável:**
- item individual;
- valor;
- motivo;
- fundamento contratual, administrativo ou assistencial;
- evidência;
- responsável/área;
- prazo e possibilidade de contestação;
- decisão humana;
- efeito financeiro final.

### RECONCILIATION_OPEN

Diferença entre fontes financeiras, fiscais, produtivas ou contratuais ainda não explicada.

### FOLLOWUP_SLA_BREACH

Pendência já acionada que ultrapassou prazo conhecido. O vencimento aumenta prioridade, mas não autoriza automaticamente comunicação externa ou baixa financeira.

### FOLLOWUP_OPEN

Pendência ativa dentro do prazo ou sem prazo documental. Deve permanecer rastreada até prova de resolução.

### AUDIT_FINDING_OPEN

Achado de auditoria sem causa-raiz, plano, evidência pós-ação ou impacto reconciliado.

### EVIDENCE_GAP

Documento ou evidência necessária ausente, bloqueada, falha ou em quarentena.

### DUPLICATE_OR_VERSION_CONFLICT

Mais de uma versão/documento/registro pode representar o mesmo fato econômico ou operacional. Definir exemplar canônico e bloquear dupla contagem.

## Algoritmo operacional

```text
INGESTÃO
↓
normalizar competência, entidade, valor, fonte e versão
↓
CONFRONTAMENTO
↓
localizar divergência, lacuna, duplicidade, prazo ou ausência de vínculo
↓
CLASSIFICAÇÃO
↓
estágio da receita + família de exceção + materialidade + SLA + responsável
↓
SANEAMENTO
↓
obter evidência / gerar defesa técnica / solicitar memória / conciliar / corrigir vínculo
↓
REVISÃO HUMANA
↓
resolver, manter aberta, reclassificar ou escalar
↓
ENCERRADO_COM_EVIDENCIA
```

## Priorização

Priorizar por combinação de:

```text
materialidade financeira
+ prazo/aging
+ risco de perda de direito
+ cobertura de evidência
+ recorrência
+ impacto sistêmico
+ ausência de responsável
```

Não produzir um total global de “perda” somando exceções que possam pertencer ao mesmo valor, mesma nota ou mesmo evento.

## Defesa e recuperação de receita

A ferramenta pode:

- estruturar confronto técnico;
- apontar fundamento/documento faltante;
- gerar minuta de contestação ou defesa;
- preparar checklist probatório;
- sugerir próxima ação e escalonamento;
- manter histórico de respostas e versões;
- medir aging e cobertura;
- estimar exposição com premissas explícitas.

A ferramenta **não pode automaticamente**:

- aceitar glosa;
- baixar recebível;
- enviar cobrança externa sem autorização/fluxo aprovado;
- executar pagamento;
- alterar documento-fonte;
- autorizar distribuição;
- transformar estimativa em receita recebida.

## LGPD e segregação

- dados por `orgId`;
- acesso autenticado e por papel;
- mínimo necessário na interface;
- identificadores de paciente fora de alertas executivos sempre que não forem indispensáveis;
- evidências sensíveis acessadas somente em drill-down autorizado;
- fonte preservada, com proveniência e trilha;
- nenhuma credencial, token ou segredo em payload de cliente.

## Indicadores do saneamento

- pontas soltas abertas;
- pontas vencidas;
- itens sem responsável;
- itens com lacuna documental;
- aging mediano por família;
- taxa de encerramento com evidência;
- taxa de reabertura;
- tempo até primeira resposta;
- tempo até evidência suficiente;
- valor efetivamente conciliado após saneamento;
- receita recuperada **somente quando recebida e atribuível sem dupla contagem**.

## Base regulatória/metodológica consultada

### Saúde suplementar — ANS / TISS

O Padrão TISS vigente em março de 2026 mantém componentes organizacional, conteúdo/estrutura, representação de conceitos/TUSS, segurança/privacidade e comunicação.

A orientação institucional da ANS para faturamento e pagamento entre operadoras e prestadores reforça que contrato deve disciplinar prazos/procedimentos de faturamento e pagamento, rotina de auditoria, hipóteses de glosa, contestação, resposta e pagamento após eventual revogação, além de acesso às justificativas de glosa.

Referências:
- https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-marco-2026
- https://www.gov.br/ans/pt-br/assuntos/prestadores/fator-de-qualidade-1/obrigatoriedade-do-contrato-escrito-1/faturamento-e-pagamento-dos-servicos-prestados

### Auditoria SUS — DenaSUS/SNA

O saneamento segue lógica de auditoria baseada em demanda, evidência, método, controle de qualidade e proposta de encaminhamento, preservando independência entre achado, análise e decisão.

Referências:
- https://www.gov.br/saude/pt-br/composicao/denasus/publicacoes
- https://www.gov.br/saude/pt-br/composicao/denasus/sna

### Proteção de dados — LGPD/ANPD

A capacidade deve operar por segregação, finalidade, minimização, segurança, rastreabilidade e controle de acesso, com atenção reforçada a dados pessoais sensíveis de saúde.

Referências:
- https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes
- https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-de-seguranca-para-agentes-de-tratamento-de-pequeno-porte

## Caso de referência para aprendizagem operacional

O padrão foi generalizado a partir de situações recorrentes de auditoria real, incluindo:

- produção bruta versus produção elegível;
- registros TESTE;
- duplicidades/repetições;
- registros fora de escala;
- regra operacional sem legenda/documento oficial;
- nota emitida abaixo de referência produtiva;
- glosa/cancelamento sem memória individualizada;
- conflito entre versões de planilhas;
- potencial dupla exclusão;
- nota emitida sem crédito conciliado;
- follow-up sem resposta;
- competência seguinte recebida antes de encerrar a anterior.

O caso de referência é **exemplo de padrão**, não regra específica de cliente. Valores, pessoas, pacientes e parâmetros contratuais privados não fazem parte da capacidade global.

## Critério de promoção

A capacidade permanece em SHADOW até:

1. testes unitários passarem;
2. projeção existente permanecer compatível;
3. não haver dupla contagem;
4. exemplos sintéticos reproduzirem as famílias de exceção;
5. LGPD e segregação serem revisadas;
6. duas competências paralelas serem comparadas sem divergência material;
7. revisão humana autorizar promoção.

Nenhum deploy, merge ou ativação produtiva é decorrência automática desta especificação.
