# AURORA-CRED-MED-001 — Credenciamento médico e banco de oportunidades WMGJ

**Versão:** 1.0.0-candidate · **Data:** 29/10/2026  
**Organização responsável pelo pré-cadastro:** WMGJ Serviços Médicos e Gestão em Saúde Ltda — identificação societária e aviso de privacidade sujeitos à conferência jurídica antes da ativação.  
**Marca de apresentação:** Dr. João de Freitas Neto / AURORA NEXUS.  
**Estado:** incremento de software candidato; não declara publicação operacional.

## Objetivo
Página responsiva em /wmgj/medicos para médicos parceiros informarem cadastro mínimo, CRM, RQE, competências, disponibilidade e certificados. Gestão autenticada em /wmgj/medicos/gestao emite convites e acompanha perfis recebidos. Vínculo comercial, escalas e contratos futuros exigem instrumento próprio, após verificação técnica e jurídica.

Não se confunde com AURORA-PROFESSIONAL-ONBOARDING-001, que provisiona usuários do sistema. O médico candidato não recebe conta, sessão administrativa, privilégios ou acesso ao acervo AURORA. Reutilizam motor de governança, sem banco paralelo.

## Fluxo e contratos
1. Operador WMGJ com membership ativo, escopo integral, perfil de gestão e MFA emite link individual. POST autenticado + CSRF cria token de 256 bits, armazena somente hash e expira após 7 dias. O token fica no fragmento URL, não em query, headers ou logs operacionais. Enviar por canal privado.
2. Médico abre link sem login Aurora. Etapas: identificação/CRM; especialidade/competências/disponibilidade; anexos e ciência. CRM, RQE, diplomas e certificados são declaratórios até validação externa.
3. SUBMIT valida esquema fechado (sem CPF, prontuário, endereço completo, dados bancários ou saúde pessoal), origem, token, organização habilitada, termos e fingerprint idempotente. Gera ficha privada PENDING_DOCUMENTS_AND_CRM_REVIEW e auditoria. Replay idêntico devolve mesmo protocolo; divergência não substitui cadastro.
4. UPLOAD aceita um arquivo por requisição, PDF, PNG ou JPG, até 4 MiB. Verifica assinatura de arquivo, MIME, SHA-256, grava em bucket GCS privado por ID opaco sob medical-partners/wmgj/. Usa reserva transacional, escrita sem sobrescrita, conciliação por metadados e recibo Firestore. Falha mantém UPLOAD_PENDING e retoma mesma identidade, sem simular recebimento.
5. Arquivo recebido fica RECEIVED_PENDING_SECURITY_REVIEW. Não gera download público, circulação documental ou aprovação automática. Antivírus e revisão humana são obrigatórios antes de compartilhar.
6. Agente nativo consolida pendências por profissional: CRM/RQE, documentação, certificado, curso, experiência e disponibilidade. ELIGIBLE_FOR_OPPORTUNITY só decorre de revisão com evidências de CRM vigente, especialidade/RQE quando exigido, documentos e treinamentos específicos da vaga. Contratação continua separada.

## Arquitetura e independência
- Firebase Hosting já existente, Functions Node 22 e Firestore no mesmo tenant.
- Coleções filhas de organizations/wmgj; nenhuma nova organização ou conta.
- Registro nativo AURORA-CRED-MED-001 no M09, estado NATIVE_GOVERNED, sem executor duplicado ou agendamento paralelo.
- Acesso administrativo exige sessão atual, MFA, organização WMGJ e CSRF. Candidato só interage por convite pessoal.
- IA externa não necessária. Regras, validação e auditoria determinísticas; a inteligência orgânica recebe apenas padrões genéricos com evidência, nunca dados pessoais entre clientes.

## Treinamentos — não universais
Registra certificados com entidade emissora, validade e evidência. UTI, emergência, exames, cardiologia, auditoria e ambulatório possuem exigências distintas. ACLS, BLS, ATLS e outros treinamentos só são exigidos conforme requisitos da instituição/oportunidade e normas aplicáveis. Revalidar certificados antes da alocação.

## Minuta de manifestação de interesse
O cadastro é voluntário e não vinculante, sem exclusividade, garantia de vaga ou plantão, escala, remuneração, obrigação de aceitar propostas ou vínculo trabalhista presumido. Contrato futuro deve definir contratante, objeto, local, período, valores, responsabilidades e base de tratamento de dados. Timbre institucional Dr. João não transforma plataforma em contratante.

## Privacidade e segurança — gates de produção
Antes de habilitar organizations/wmgj.medicalPartnersEnabled, comprovar:
- Aviso de privacidade com razão social/CNPJ, canal de titular, finalidades, bases legais, retenção e descarte, destinatários, controles, eventual transferência e revisão jurídica/encarregado.
- AURORA_MEDICAL_PARTNERS_BUCKET configurado como wmgj-{hml|prod}-jfn-{YYYYMMDD}-medical-partners, privado, Uniform Bucket-Level Access, Public Access Prevention, IAM de privilégio mínimo, sem bucket de build de Functions.
- Teste real de upload, leitura restrita, idempotência, simultaneidade, parcialidade, descarte, incidentes, antivirus e custódia de evidências.
- Testes de convite ausente/vencido/adulterado/repetido, tenant não autorizado, CSRF, ausência de MFA, sessão revogada, bucket indisponível; emulador e HML aprovados antes de produção.
- Revisão final do modelo jurídico. Aceite de pré-cadastro não equivale a assinatura contratual.

**Vedado** armazenar documentos de candidatos no GitHub, repositório público, logs, corpus de IA, páginas de marketing, conta pessoal ou tenant de terceiros. Nenhum link público de objeto é emitido.

## Estados e acompanhamento
| Estado | Comprovação | Próxima ação |
|---|---|---|
| INVITED | Link individual emitido | Aguardar preenchimento |
| SUBMITTED | Perfil recebido, protocolo emitido | Conferir documentos |
| UPLOAD_PENDING | Reserva sem confirmação de armazenamento | Retomar mesmo hash |
| RECEIVED_PENDING_SECURITY_REVIEW | Objeto privado e hash confirmado | Antivírus e revisão |
| PENDING_REVIEW | Requisitos profissionais incompletos | Validar CRM/RQE/treinamento |
| ELIGIBLE_FOR_OPPORTUNITY | Evidência humana validada | Associar à vaga específica |
| RESTRICTED | Divergência/irregularidade relevante | Suspender indicação |

Responsáveis: gestão cadastral WMGJ, revisor profissional habilitado, jurídico de contratação e controlador de dados conforme RoPA.

## Evidências e status
Arquivos: auroraMedicalPartnerPolicy.ts, auroraMedicalPartnerView.ts, auroraMedicalPartnerRuntime.ts e aurora-medical-partners.test.ts no Firebase Functions. HML/produção requerem SHA, CI, bucket, tenant flag, deploy, URL funcional, submissão sintética e readback. **PR e testes não autorizam coleta real.**

Indicadores: cadastros parciais/completos, anexos efetivamente recebidos, tempo de revisão, vencimentos, elegibilidade por especialidade e UF, conversões em oportunidades, pendências. Nunca contar envio como regularidade ou contratação.

## Entrega de documentos públicos e vídeo institucional — 29/10/2026

A biblioteca pública de pré-cadastro usa somente três artefatos revisados, sem dados reais de profissionais: ficha PDF, termo preliminar PDF e vídeo explicativo MP4 H.264 original, sem áudio. Arquivos reais, não links para downloads temporários, são versionados em `firebase-migration/hosting/aurora-nexus/arquivos/wmgj/`; hashes e tamanhos imutáveis constam do `manifest.json`. As duas rotinas de geração são versionadas em `firebase-migration/scripts/generate-public-credmed-pdfs.py` e `generate-public-credmed-video.py`, com dependências de autoria isoladas e sem carregá-las no runtime cloud. A página de cadastro disponibiliza links HTML download diretos. PDF serve `application/pdf` e MP4 serve `video/mp4` com `Content-Disposition: attachment`; a verificação externa exige GET/HEAD com hashes e HTTP 206 para a faixa de vídeo.

A função `auroraNexusMedicalPartners` deve constar da lista explícita de funções nos pipelines de deploy HML e produção, além do roteamento Hosting; rota que retorna login genérico ou HTTP 200 sem conteúdo de cadastro não constitui entrega. O smoke `verify-credmed-public-release.mjs` é read-only e confere título, campos, links, integridade SHA-256 e negação do painel administrativo anônimo. Em HML fica incorporado ao pipeline protegido depois do deploy. Nunca modificar o publicador canônico, remover MFA ou utilizar deploy fora do workflow para contornar bloqueios.

Registro de decisão do titular: autorização explícita de distribuição, publicação e auditoria de código em 29/10/2026. A liberação de coleta de documentos pessoais mantém `medicalPartnersEnabled` e `medicalPartnersPrivacyApproved` condicionados a bucket privado, IAM mínimo, política de privacidade, retenção, varredura antivírus e readback real, sem simular conclusão. A função não está autorizada a criar usuários administrativos nem a fornecer documentos sem revisão. Registro privado sanitizado: [Notion AURORA-CRED-MED-001](https://app.notion.com/p/4085f55e7051813d8f34f5d307c32471).

A renovação estrita da janela de publicação HML de arquivos públicos e testes sintéticos não prorroga autorização de coleta Drive, altera prazos de credenciais, concede IAM, autoriza dados clínicos ou promove produção. A expiração histórica de permissões específicas permanece.

## Auditoria HTTP real e ajuste do contrato de transporte — 29/10/2026

A execução HML [#40917926686](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40917926686) **implantou** Cloud Functions, Hosting, regras e índices do SHA `566f2b65b9bad9dc6ffbbe92152b1e6c61c72fba`, mas sua verificação pós-deploy falhou antes da assinatura canônica. O teste comprovou o formulário público e a negação do painel de gestão anônimo. A causa do teste foi requerer `Content-Length` em `HEAD` apesar de a hospedagem usar `Transfer-Encoding: chunked`. A resposta ao pedido `Range: bytes=0-31` veio como HTTP 200 com **todos os bytes** do vídeo, em vez de HTTP 206 parcial.

Leitura real por Windows Xeon, tanto em `https://auroranexus.com.br` quanto em `https://wmgj-hml-jfn-20260927.web.app`: formulário correto HTTP 200; gestão anônima HTTP 403; dois PDFs e o MP4 original servidos HTTP 200 com `Content-Type` adequado e `Content-Disposition: attachment`. Os três GETs têm exatamente os tamanhos e SHA-256 do manifesto. O vídeo completo é H.264 com `moov` antes de `mdat`; HTTP 200 integral garante download, mas **não comprova capacidade de seeking HTTP 206**. Não anunciar reprodução com seek parcial onde o provedor não confirmou.

O verificador agora aceita `HEAD` sem tamanho anunciado **somente porque** exige GET completo e hash; se tamanho anunciado divergir, falha. Para vídeos, aceita HTTP 206 somente com prefixo e `Content-Range` exatos, ou HTTP 200 somente quando entrega **o vídeo integral** com tamanho, MIME, disposição e hash coincidentes. Aceitar 200 truncado, substituir objeto ou desconsiderar um erro de upload continua proibido. Regressões dirigidas cobrem as duas modalidades e rejeitam mídia adulterada. A publicação do certificado Ed25519 e o Guardian horário permanecem pendentes até CI, merge e deploy protegido desta correção; o deploy da função e os downloads existentes não autorizam dados pessoais, pois o tenant continua desabilitado para a coleta.

O follow-up de validação de transporte HTTP foi delimitado à PR #354, mantendo a autorização de pré-cadastro HML em `publicMediaHmlAuthorization.authorizedTransportSmokeFollowUp` (somente teste de ativos públicos e publicação assinada do fluxo existente). Autoriza somente essa candidata, dentro da mesma janela de publicação e sob validação final por CI e aprovação real do ambiente. Não estende prazos históricos de Drive/R029, não autoriza produção nem dado pessoal, não concede acesso nem desliga guardas. O publisher recusa PR não listada, janela expirada e alteração da política. Os testes sintéticos cobrem PR 349, follow-up 354 e PR 355 não autorizada.
