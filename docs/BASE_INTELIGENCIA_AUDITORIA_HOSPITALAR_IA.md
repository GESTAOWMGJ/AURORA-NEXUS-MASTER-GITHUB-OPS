# Base de Inteligência - Auditoria Hospitalar com IA

Status: base estratégica versionada para uso futuro em projeto separado de auditoria hospitalar.
Projeto atual de laboratório: WMGJ Operação, ambulatório de cardiologia.
Escopo desta base: aprendizado estrutural, governança, modelo de produto e arquitetura operacional. Não é protocolo clínico, não substitui auditor médico, enfermeiro auditor, jurídico, compliance, faturamento ou regulação aplicável.

## 1. Tese estratégica

O WMGJ Operação deve permanecer como laboratório controlado de automação documental, financeira e operacional. O futuro produto deve nascer como plataforma de auditoria remota assistida por IA para hospitais, clínicas e operadoras, com foco inicial em:

1. auditoria de contas médicas;
2. faturamento hospitalar;
3. glosas e recursos;
4. OPME;
5. conferência documental;
6. rastreabilidade de evidências;
7. dashboards executivos;
8. consultoria remota para hospitais no Brasil e Paraná.

A proposta correta não é vender “IA que decide sozinha”. Isso é pedir para o caos usar crachá. A proposta vendável é: IA que pré-audita, organiza evidências, aponta inconsistências, calcula risco de glosa, sugere justificativas e envia casos críticos para revisão humana.

## 2. Fontes internas consultadas no Drive

Materiais identificados como base interna relevante:

- manuais e modelos de auditoria disponíveis no Drive;
- material sobre glosas, consultas e procedimentos;
- material de balizadores de OPME;
- material de gestão/curso FGV ou gestão executiva disponível no Drive;
- memória operacional WMGJ já versionada;
- pipeline WMGJ V3: Drive -> Fila -> Processamento -> Memória-base -> Log;
- documentação WMGJ sobre Gemini/OCR, JSON validado, fila e memória-base.

Esses materiais devem ser tratados como base documental de referência, com leitura assistida e extração estruturada. Não devem ser copiados integralmente para prompts nem usados sem checagem humana, especialmente se contiverem dados pessoais, dados sensíveis, contratos, valores, pacientes ou documentos protegidos.

## 3. Referenciais externos que passam a orientar o modelo

Esta base deve ser compatível com:

- NIST AI Risk Management Framework: governança, mapeamento, medição e gestão de risco em sistemas de IA;
- ISO/IEC 42001: sistema de gestão de IA com políticas, processos, rastreabilidade e melhoria contínua;
- OMS sobre ética e governança de IA em saúde: segurança, responsabilidade, transparência e supervisão humana;
- FDA/GMLP como referência metodológica para ciclo de vida de modelos em saúde, mesmo quando o produto não for dispositivo médico;
- FUTURE-AI: princípios de confiabilidade em IA na saúde, especialmente rastreabilidade, robustez, explicabilidade e usabilidade;
- LGPD: dados de saúde são sensíveis e exigem base legal, finalidade, minimização, controle de acesso, registro e segurança;
- ANS/TISS/TUSS/Rol: padronização de troca de informação, terminologias, procedimentos e faturamento na saúde suplementar;
- normas, contratos e manuais internos de cada hospital/operadora.

Regra estrutural: se houver conflito entre IA, contrato, norma, prontuário e auditor humano, a IA perde. Robôs não assinam responsabilidade técnica, por mais que humanos insistam em terceirizar juízo.

## 4. Modelo operacional de auditoria autônoma assistida

Camadas do futuro produto:

### 4.1 Ingestão documental

Entradas:

- XML, PDF, imagem, planilha, CSV, e-mail e anexos;
- guias TISS;
- contas hospitalares;
- notas fiscais;
- prescrições, evoluções, autorizações, laudos e materiais de OPME;
- tabelas contratadas, pacotes, tabelas próprias, Brasindice/Simpro ou equivalentes quando licenciados;
- regras internas de faturamento e glosa.

### 4.2 Normalização

Cada documento precisa virar um registro padronizado:

- ID_ORIGEM;
- HASH_DOCUMENTO;
- TIPO_DOCUMENTO;
- COMPETENCIA;
- PRESTADOR;
- CONVENIO;
- PACIENTE anonimizado ou tokenizado quando possível;
- CONTA;
- ITEM;
- CODIGO_TUSS ou código local;
- QUANTIDADE;
- VALOR_UNITARIO;
- VALOR_TOTAL;
- EVIDENCIA_ORIGEM;
- STATUS_AUDITORIA;
- RISCO_GLOSA;
- RESPONSAVEL_HUMANO;
- VERSAO_REGRA;
- VERSAO_PROMPT;
- VERSAO_MODELO;
- DATA_PROCESSAMENTO.

### 4.3 Motor de regras

O motor de regras deve validar:

- duplicidade de conta, item, documento e cobrança;
- existência de autorização;
- coerência entre guia, prontuário, procedimento e cobrança;
- contrato e tabela aplicável;
- quantidade versus período assistencial;
- incompatibilidade entre procedimento, material, diária, taxa e OPME;
- ausência de evidência documental;
- divergência entre faturado, autorizado, realizado e pago;
- histórico de glosas por convênio, hospital, setor, médico, item e competência.

### 4.4 IA documental

Funções permitidas:

- classificar documentos;
- extrair campos;
- resumir evidências;
- comparar documentos;
- apontar divergências;
- sugerir justificativas de recurso;
- priorizar contas por risco;
- gerar checklists;
- montar dossiês de auditoria.

Funções bloqueadas sem revisão humana:

- negar cobertura;
- aprovar cobrança final;
- substituir parecer médico;
- alterar conta hospitalar em produção sem trilha;
- enviar recurso oficial sem validação;
- tomar decisão clínica.

### 4.5 Auditoria humana no fluxo

Toda saída deve cair em um destes estados:

- APROVADO_PELO_SISTEMA_BAIXO_RISCO;
- REVISAR_HUMANO;
- BLOQUEAR_POR_INCONSISTENCIA;
- FALTA_DOCUMENTO;
- POSSIVEL_GLOSA;
- RECURSO_RECOMENDADO;
- ERRO_DE_EXTRAÇÃO;
- ERRO_DE_REGRA;
- PENDENTE_CONTRATO;
- PENDENTE_OPME.

A revisão humana deve registrar aceite, ajuste ou rejeição da recomendação da IA.

## 5. Modelo específico para contas médicas e faturamento

Fluxo recomendado:

1. Captura da conta hospitalar.
2. Conferência de identificação, competência, convênio, contrato e plano.
3. Leitura de guias, autorizações e anexos.
4. Normalização de itens por código, descrição, quantidade e valor.
5. Validação de pertinência documental.
6. Validação contratual e tabela.
7. Validação TISS/TUSS quando aplicável.
8. Cálculo de divergências.
9. Classificação do risco de glosa.
10. Geração de dossiê com evidências.
11. Revisão humana.
12. Exportação de relatório para hospital, consultoria ou recurso.

Indicadores-chave:

- valor auditado;
- valor potencialmente recuperável;
- valor com risco de glosa;
- valor glosado;
- taxa de reversão;
- tempo médio por conta;
- principais motivos de glosa;
- itens sem evidência;
- OPME com maior risco;
- convênios com maior divergência;
- economia por auditor remoto.

## 6. Modelo específico para OPME

Checklist mínimo para OPME:

- autorização prévia;
- indicação clínica documentada;
- compatibilidade com procedimento;
- descrição técnica;
- fornecedor;
- nota fiscal;
- lote, série ou rastreabilidade quando aplicável;
- registro regulatório quando aplicável;
- quantidade utilizada;
- quantidade autorizada;
- valor contratado;
- valor cobrado;
- termo/cirurgia/laudo/evolução que comprove uso;
- divergência entre material solicitado, autorizado, utilizado e cobrado.

Saída esperada da IA:

- OPME_OK;
- OPME_SEM_AUTORIZACAO;
- OPME_SEM_EVIDENCIA_DE_USO;
- OPME_QUANTIDADE_DIVERGENTE;
- OPME_VALOR_DIVERGENTE;
- OPME_ITEM_NAO_CONTRATADO;
- OPME_EXIGE_AUDITOR_HUMANO.

## 7. Governança de IA versionada

Toda auditoria deve registrar:

- versão do modelo;
- versão do prompt;
- versão do schema JSON;
- versão das regras;
- versão do manual operacional;
- fonte documental usada;
- hash dos documentos;
- usuário que revisou;
- data/hora;
- justificativa;
- decisão final;
- exportação gerada.

Nenhum resultado deve ser sobrescrito sem histórico. Correção sem histórico é só adulteração com autoestima.

## 8. Arquitetura futura do produto

### MVP 1 - Laboratório WMGJ

- Google Drive como entrada;
- Google Sheets como memória operacional;
- Apps Script como orquestrador;
- Gemini/OCR para extração;
- JSON validado;
- dashboard básico;
- revisão humana.

### MVP 2 - Auditoria hospitalar remota

- banco de dados real;
- backend com API;
- autenticação por perfil;
- trilha de auditoria;
- ingestão TISS/XML/PDF;
- motor de regras;
- painel de contas;
- fila de revisão;
- geração de dossiê e recurso.

### MVP 3 - Produto comercial

- multi-hospital;
- multi-convênio;
- versionamento por cliente;
- conectores com ERP/hospitalar quando autorizado;
- relatórios executivos;
- indicadores financeiros;
- precificação por conta auditada, valor recuperado ou assinatura;
- módulo de consultoria remota.

## 9. Posição comercial

Oferta futura:

“Plataforma de auditoria remota assistida por IA para redução de glosas, recuperação de receita e governança de faturamento hospitalar.”

Clientes-alvo:

- hospitais de pequeno e médio porte;
- clínicas com alto volume;
- consultorias de faturamento;
- operadoras regionais;
- equipes internas de auditoria;
- hospitais no Paraná e expansão Brasil.

Diferencial:

- documentação auditável;
- IA versionada;
- dossiê de evidências;
- revisão humana;
- implantação remota;
- foco em contas médicas, faturamento e OPME;
- aprendizado a partir do laboratório WMGJ.

## 10. Próximos artefatos a criar

1. schema `audit_account.schema.json`;
2. schema `opme_audit.schema.json`;
3. manual `MANUAL_AUDITORIA_CONTAS_MEDICAS.md`;
4. manual `MANUAL_AUDITORIA_OPME.md`;
5. matriz de glosas;
6. matriz de risco por convênio;
7. prompt versionado de extração;
8. prompt versionado de recurso de glosa;
9. dashboard de contas auditadas;
10. checklist LGPD e segurança;
11. modelo comercial para hospitais;
12. plano de piloto com 100 contas históricas anonimizadas.

## 11. Regra de ouro

O projeto futuro só deve ser chamado de auditoria autônoma se “autônoma” significar execução operacional controlada, e não decisão médica ou financeira sem supervisão. O nome tecnicamente correto para venda responsável é: auditoria remota assistida por IA, versionada, rastreável e supervisionada.
