# AURORA NEXUS — Registro das Operações de Tratamento (RoPA) — Modelo Operacional

**Código:** AURORA-SEC-002-ROPA  
**Versão:** 1.0.0-draft  
**Base:** LGPD — inventário operacional para validação pelo controlador/encarregado/jurídico.

## 1. Regra de uso

Este registro não escolhe unilateralmente a base legal do cliente. Para dados processados por conta de um hospital, clínica, operadora ou outro cliente, o AURORA atua conforme as instruções documentadas e a qualificação contratual definida no DPA. Campos marcados `CONTROLADOR_DEVE_DECLARAR` bloqueiam produção até preenchimento.

## 2. Papéis

- **Controlador:** organização que define finalidade e elementos essenciais do tratamento do seu negócio.
- **Operador:** AURORA/JF NETO SM quando trata dados por instrução documentada do controlador.
- **Controlador independente:** aplicável apenas às operações próprias da plataforma, como segurança da conta, faturamento contratual próprio e obrigações legais próprias, quando juridicamente caracterizado.
- **Suboperador:** fornecedor utilizado para executar tratamento em nome do operador, conforme contrato e inventário aprovado.

## 3. Atividades de tratamento

| ID | Atividade | Titulares | Dados | Sensível | Finalidade | Base legal | Papel AURORA | Retenção | Compartilhamento | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | autenticação e gestão de conta | usuários/gestores | nome, e-mail, UID, MFA, logs | não | controle de acesso e segurança | CONTROLADOR_DEVE_DECLARAR / execução contratual própria quando aplicável | operador/controlador conforme contexto | política de identidade | Firebase/Google Cloud | PARTIAL |
| R02 | membership, roles e permissões | usuários | UID, orgId, role, unidade | não | segregação e autorização | CONTROLADOR_DEVE_DECLARAR | operador | vínculo + trilha após revogação conforme política | Google Cloud | PARTIAL |
| R03 | ingestão documental autorizada | pacientes, profissionais, fornecedores, clientes | metadados e conteúdo autorizado | pode conter | auditoria/saneamento/gestão | CONTROLADOR_DEVE_DECLARAR | operador | por categoria documental | Google Cloud + conectores autorizados | BLOCKED_FOR_CLINICAL |
| R04 | faturamento, glosas e conciliação | profissionais, clientes, pacientes quando constarem em documento | dados financeiros, fiscais, produção | pode conter | auditoria de receita e conciliação | CONTROLADOR_DEVE_DECLARAR | operador | regra fiscal/contratual declarada | Google Cloud | PARTIAL |
| R05 | evidência assistencial clínica | pacientes | saúde, diagnóstico, procedimento, identificadores | sim | finalidade assistencial/auditoria declarada pelo controlador | CONTROLADOR_DEVE_DECLARAR | operador | CONTROLADOR_DEVE_DECLARAR | somente subprocessadores aprovados | BLOCKED |
| R06 | comunicação institucional | usuários, profissionais, contatos autorizados | nome, e-mail, contexto mínimo | não/pode derivar | cobrança de pendência, aviso, workflow | CONTROLADOR_DEVE_DECLARAR | operador | trilha conforme política | Gmail/provedor autorizado | SPECIFIED |
| R07 | audit trail e segurança | usuários e atores técnicos | UID, IP quando disponível, ação, horário, hashes, resultado | não | segurança, responsabilização, investigação | obrigação/interesse legítimo/execução contratual conforme análise | controlador/operador conforme evento | mínimo necessário; incidentes LGPD conforme RCIS | Google Cloud/GitHub | PARTIAL |
| R08 | suporte e atendimento técnico | usuários | contato, descrição, logs sanitizados | não por padrão | suporte | execução contratual | controlador independente ou operador | ciclo de suporte + retenção definida | ferramentas aprovadas | PARTIAL |
| R09 | telemetria operacional | usuários/sistema | evento técnico, versão, erro sanitizado | não | confiabilidade e segurança | análise jurídica necessária | controlador/operador | minimizada | Google Cloud | PARTIAL |
| R10 | IA opcional para síntese/classificação | titulares presentes no material autorizado | conteúdo minimizado/desidentificado | bloqueado para clínico identificável | suporte analítico | CONTROLADOR_DEVE_DECLARAR | operador | conforme contrato/provedor | provedor de IA aprovado | BLOCKED_FOR_CLINICAL |
| R11 | backup, PITR e restore | mesmos titulares da base protegida | cópia criptografada | acompanha origem | continuidade/recuperação | mesma finalidade + segurança | operador | janela técnica + retenção de backup | Google Cloud | SPECIFIED |
| R12 | faturamento comercial do SaaS | representantes dos clientes | contato, contrato, cobrança | não | relação comercial própria | execução contratual/obrigação legal conforme caso | controlador independente | fiscal/contratual | contabilidade/financeiro | SPECIFIED |

## 4. Campos obrigatórios antes de produção por cliente

Para cada tenant devem ser preenchidos e aprovados:

- finalidade específica;
- controlador e contatos;
- encarregado/canal de privacidade quando aplicável;
- base legal por atividade;
- categorias de titulares;
- categorias de dados;
- dados pessoais sensíveis;
- fontes autorizadas;
- destinatários e subprocessadores;
- transferência internacional quando houver;
- retenção e descarte;
- procedimento de direitos do titular;
- medida de segurança aplicável;
- RIPD/DPIA quando necessário;
- contrato/DPA e instruções documentadas.

## 5. Minimização e proibições

- CPF, nome, e-mail ou diagnóstico não devem ser usados como ID técnico quando um identificador opaco puder cumprir a finalidade.
- Logs não recebem prontuário bruto, segredo, token ou DEK.
- Conteúdo de Drive/Gmail fora da pasta/label/conta autorizada não deve ser indexado.
- Dados clínicos identificáveis não podem entrar em IA externa ou persistência operacional sem gate explícito.
- Dados de um tenant não podem ser reutilizados para outro tenant ou para treinamento coletivo por inferência.

## 6. Direitos dos titulares

O controlador deve definir canal e processo para confirmação, acesso, correção, anonimização/bloqueio/eliminação quando cabível, portabilidade quando aplicável, informação sobre compartilhamento e demais direitos previstos na LGPD. O AURORA deve fornecer mecanismos de busca controlada, exportação e execução da instrução do controlador sem apagar evidência sujeita a retenção legal ou legal hold.

## 7. Incidentes

Todo incidente envolvendo dados pessoais deve ser registrado, classificado e tratado pelo IRP. Quando puder acarretar risco ou dano relevante, a decisão de comunicação cabe ao controlador conforme a LGPD e o Regulamento de Comunicação de Incidente de Segurança da ANPD.

## 8. Transferência e subprocessadores

Nenhum novo subprocessador que receba dado pessoal deve ser ativado sem inventário, finalidade, localização, contrato, medidas de segurança e autorização/fluxo previsto no DPA. Transferência internacional deve ser avaliada conforme o mecanismo jurídico aplicável.

## 9. Estado atual

`CLINICAL_SENSITIVE` permanece bloqueado. Este RoPA é `SPECIFIED` até ser preenchido por tenant e validado pelo controlador/encarregado/jurídico.
