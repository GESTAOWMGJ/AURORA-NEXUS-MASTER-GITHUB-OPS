# Saneamento documental e escalas — contrato abstrato

Data: 19/10/2026. Baseline: 967d32a493b9930d77cac1030642c6fca28bb1f3.
M01/M03.1/M05/M10, mesma rotina AURORA-REV-SAN-001, com vigilância documental e fechamento já existentes.

## Problema e padrão

Visões de fechamento podem conservar valores/observações antigos embora nota e banco já representem o mesmo fato. A correção deve atualizar as projeções e manter histórico, sem reconhecer receita novamente. Competência econômica, emissão fiscal e caixa são datas distintas. Diferença produtiva não é glosa aceita; NF e PIX não são custos adicionais do mesmo serviço. Tributos e repasses exigem comprovação e vínculo próprios; caixa residual não comprova resultado líquido.

Para escala, distinguir previsto recebido, vigente validado e executado validado. A aprovação precisa vincular responsável, versão, período e escopo; envio do arquivo não comprova execução, duração ou preço. Competência decorre do conteúdo, não só do nome do arquivo. Mês em curso exige versão vigente até o corte. Lacuna de documento e lacuna de validação geram pedidos diferentes.

O responsável e seu contato pertencem à configuração privada de cada organização. Contato verificado e autorização explícita vigente permitem ao executor já autorizado solicitar formalmente o complemento, dentro daquele escopo. A autorização de um tenant nunca concede poderes a outro. Nenhum nome, endereço, documento, mensagem, valor real ou contrato do caso foi incorporado a esta capacidade.

## Contrato do efeito externo

Reutilizar fila, lock/lease e registro de pendências existentes. Chave compartilhada por auditoria/rotina/fechamento: organização + competência + tipo de lacuna + responsável. Ler respostas e anexos antes de enviar; reservar o efeito de forma atômica, registrar tentativa e recibo/messageId, depois reconciliar por releitura. Resultado indeterminado exige buscar o envio antes de tentar novamente. Pedidos do mesmo destinatário podem ser consolidados sem duplicar os achados.

Não repetir a cada passagem. Prazo solicitado é distinto de obrigação contratual. Resposta parcial mantém somente o residual; envio ou silêncio não encerram a pendência. Erro de acesso é cobertura desconhecida, nunca ausência de documento. Preservar bloqueios legítimos e retentativas limitadas.

## Estado e limites do incremento declarativo de 19/10

`documentSanitationPolicy` representa o contrato no resumo nativo, na projeção e na inteligência existentes. É registro declarativo: `SPECIFIED_PENDING_EXECUTOR_VALIDATION`. Não cria executor, agendamento, privilégio, envio de e-mail, mutação de fonte ou treinamento de pesos. O estado da rotina governada e os gates financeiros existentes permanecem.

A validação deste incremento é de representação e segregação, com projeção sintética. Não demonstra execução de envio, concorrência de e-mails reais, adoção no dispositivo ou deploy. Integração de um executor requer testes de autorização/revogação, concorrência, envio incerto, deduplicação entre rotinas e recibo no ambiente autorizado. Recuperação da política pelo motor instalado requer evidência própria.

Rollback: reverter o incremento de política/registro, preservando as pendências, envios e fontes privadas. Não altera release pointer nem instaladores.

A política complementar versionada está em `firebase-migration/policy/document-sanitation-schedules-v1.json`. A baseline sanitizada histórica 2.3.0 e seus hashes permanecem intactos. A primeira tentativa de CI apontou a alteração indevida dessa baseline; este incremento foi separado sem enfraquecer o verificador.

## Integração candidata de 20/10/2026

O registro nativo v2 agora aponta para o executor na fila e no ciclo Apps Script existentes. A política v1 permanece histórica e imutável. Código implementado não equivale a instalação, publicação ou autorização de envio. Configuração privada, histórico legado, testes, homologação e rollback: [AURORA_DOCUMENT_SANITATION_EXECUTOR.md](AURORA_DOCUMENT_SANITATION_EXECUTOR.md).
