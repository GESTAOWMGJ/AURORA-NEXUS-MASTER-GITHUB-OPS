# AURORA NEXUS — Interface Consolidada e Patcher Orgânico

Data: 2026-09-29

## Escopo

Consolidar os prompts operacionais de 2026-09-29 na última versão da interface do AURORA NEXUS, incluindo:

- uma Client Operation Skill por cliente;
- robô Firebase de comunicação e saneamento documental;
- Gmail/Domain Indexer LGPD;
- painel Dinheiro pelo Ralo;
- ferramenta Pensar como o Serviço;
- modo teste 0–60 dias;
- diagnóstico como benefício e saneamento completo como produto;
- patcher orgânico executado no início de cada plataforma.

## Princípio de produto

```text
Diagnóstico é benefício.
Saneamento completo é produto.
```

O teste entrega valor porque mostra, com lastro, onde a operação está rasgando receita. A contratação entrega método, automação, comunicação, governança e saneamento contínuo.

## Arquitetura visual consolidada

A interface deve deixar de ser apenas um painel de fila e passar a ser o cockpit de decisão do gestor:

```text
fontes autorizadas → backend Firebase → saneamento/confrontamento → painel executivo → decisão
```

O gestor não precisa ler e-mail, abrir Drive, procurar planilha ou depender de Notion. Essas ferramentas são backend operacional. A decisão fica no web app/PWA/desktop/mobile client.

## Blocos obrigatórios de interface

### 1. Header de governança

Mostrar:

- cliente;
- `orgId`;
- `clientSkillId`;
- ambiente;
- modo: teste ou contratado;
- usuário e papel;
- sessão validada;
- MFA/App Check;
- status do patcher orgânico.

### 2. Dinheiro pelo Ralo

Mostrar cifras por categoria:

```text
RECEITA_EM_RISCO
DINHEIRO_PARADO
RECEITA_RECUPERAVEL
PERDA_EVITAVEL
PERDA_PROVAVEL
PERDA_CONFIRMADA
```

Cada valor deve ter selo:

```text
COMPROVADO
ESTIMADO
EM_RISCO
RECUPERAVEL_PROVAVEL
PENDENTE_DE_EVIDENCIA
DIVERGENTE_ATE_VALIDACAO
PERDA_PROVAVEL
PERDA_CONFIRMADA
```

### 3. Relógio da Perda

Priorizar valor por prazo e risco:

```text
valor alto + prazo curto + evidência incompleta = prioridade máxima
```

### 4. Pensar como o Serviço

AURORA deve formar insight técnico sobre a operação real:

```text
documentos → e-mails → glosas → prazos → contratos → faturamento → repasses → atrasos → retrabalho → dinheiro parado
```

Saída esperada:

- insight técnico;
- insight financeiro;
- gargalo provável;
- hipótese operacional;
- ação recomendada;
- ação reservada ao modo contratado.

### 5. Fila de saneamento documental

Toda pendência precisa ter:

- categoria;
- valor;
- fonte;
- responsável;
- prazo;
- status;
- próxima ação;
- evidência;
- trilha de auditoria.

### 6. Dificuldade do cliente no teste

O teste deve medir a dificuldade de resolver sem o AURORA completo:

- tentativas manuais;
- responsáveis acionados;
- dias até resposta;
- dias até evidência válida;
- itens reabertos;
- itens vencidos;
- itens sem dono;
- valor resolvido sozinho;
- valor ainda travado.

### 7. Robô de comunicação e saneamento

No modo contratado, o robô deve automatizar comunicação institucional, escalonamento e cobrança documental.

No modo teste, pode mostrar o que teria sido feito, sem entregar templates, playbook ou estratégia completa.

## Patcher orgânico por inicialização

Toda plataforma deve executar rotina de atualização no boot:

```text
inicialização
↓
validar sessão, orgId, role, App Check e ambiente
↓
consultar manifesto server-side do cliente
↓
comparar versão base x versão cliente
↓
simular patch se houver mudança sensível
↓
aplicar apenas patch autorizado
↓
registrar auditoria
↓
manter rollback disponível
```

### Plataformas cobertas

- Web app;
- PWA;
- desktop macOS;
- desktop Windows;
- iOS;
- Android;
- wrappers instaláveis.

### Regras obrigatórias

- Nenhum token técnico no cliente.
- Nenhum segredo no web app, mobile ou desktop.
- Ação sensível apenas via backend.
- Patch limitado por `orgId`, papel e ambiente.
- LGPD e escopo documental preservados.
- Fontes nunca são movidas, apagadas ou sobrescritas.
- Patch sensível exige revisão humana quando configurado.
- Todo patch tem manifesto, evidência, hash e rollback.

## O que o patcher pode atualizar

- layout e cards habilitados;
- regras visuais do painel;
- textos de orientação;
- módulos permitidos por cliente;
- critérios de priorização;
- templates aprovados no modo contratado;
- filas e rótulos;
- parâmetros de alertas;
- listas de fontes autorizadas já aprovadas.

## O que o patcher não pode atualizar sozinho

- segredo;
- token;
- regra financeira crítica;
- fonte documental não autorizada;
- dado de produção;
- contrato;
- valor final de pagamento;
- baixa de glosa;
- aceite jurídico;
- regra que contorne login, MFA, App Check ou revisão humana.

## Modo teste 0–60 dias

O cliente recebe:

- visibilidade financeira;
- cifra auditável;
- evidência mínima;
- prazo crítico;
- responsável provável;
- grau de confiabilidade;
- medição do atrito manual.

O cliente não recebe gratuitamente:

- automação integral;
- playbook completo;
- templates completos;
- estratégia integral de defesa de glosa;
- diagnóstico institucional profundo;
- priorização avançada de reversibilidade.

## Modo contratado

Ativa saneamento completo conforme contrato:

- comunicação institucional;
- cobrança documental;
- escalonamento;
- filas por responsável;
- governança de prazos;
- defesa de glosas reversíveis;
- recuperação de receita;
- relatório executivo;
- melhoria orgânica contínua.

## Frases de produto

```text
O teste mostra a ferida. A contratação entrega o tratamento.
```

```text
O AURORA NEXUS mostra em reais quanto a operação está perdendo sem controle — e transforma essa visibilidade em saneamento automatizado, recuperação de receita e governança contínua.
```

## Status deste patch

Este patch é de especificação e contrato de interface. Não faz deploy, não cria usuário real, não ativa segredo, não muda produção e não publica domínio.
