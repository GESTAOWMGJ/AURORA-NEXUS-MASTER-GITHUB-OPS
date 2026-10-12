# AURORA — aprendizado motor e isolamento empresarial, 07/10/2026

Incremento subordinado ao organismo existente. Base auditada: `bebb0a0b62baa47b2057dbf773c87b6ca8e7e3da`.
A autorização humana para resolver pendências e a diretriz de inteligência privada por empresa foram preservadas.

## Mudança e escopo

- Guard em `learningCycle/publicState` rejeita memória, sinais ou propostas de outra organização antes da projeção. Não renomeia o checkpoint.
- A versão de aprendizado orgânico passa de 1.2.0 para 1.2.1. Como participa do fingerprint, planos anteriores precisam revisão na nova versão; não reaproveitar aprovação antiga como validação atual.
- O adaptador `desktop/ia-master/motor-learning.cjs` usa a IA Mestre loopback já instalada, persiste prompt/resposta/fluxo de engenharia sanitizados no estado privado da organização e emite recibo HMAC. Repetição da mesma chave/input reutiliza uma entrada; input divergente, estado estrangeiro e proprietário concorrente são rejeitados.
- O corpus comum recebeu somente KH-021, método genérico, sem dados de clientes. Memórias e propostas privadas não são promovidas automaticamente.
- A habilidade pessoal AURORA Aprendizado Motor foi instalada e validada, incluindo teste independente de uso com duas empresas. Não representa um segundo motor, scheduler ou treinamento de pesos.

## Evidência no Xeon

Execução realizada no Windows Xeon, usando o componente IA Mestre 1.0.1 já existente e sua chave configurada, sem expor credencial.

| Prova | Resultado |
|---|---|
| Regressões orgânicas antes do guard | 20/26; seis casos falhavam |
| Regressões orgânicas após o guard | 26/26 |
| Build Functions | Aprovado |
| Regressões do adaptador motor | 11/11, incluindo estado estrangeiro relabelado, adulteração, segredo e concorrência |
| Corpus anterior | 1.0.0, 20 registros, SHA256 `52c930d3595c828fab0328e7800013082e33742e43ae28aa446c6f0b2931e25b` |
| Corpus carregado após incorporação | 1.0.1, 21 registros, zero rejeitados, SHA256 `fd08d7d043be42b0bf51554e7b7fc4a800938587761b66d3068fc5fb34e3cb69` |
| Repetição da incorporação KH-021 | `duplicate:true`, corpus/hash/contagem preservados |
| Adaptador executado | SHA256 `1420f40bda95e489b0a01a7277dc3d6225a0e31beff102d5cac83f2a28c158ca` |
| Primeiro ciclo | 08/10/2026 02:32:45.894Z, equivalente a 07/10 23:32:45 BRT; recibo local HMAC verificado |
| Repetição da chave do primeiro ciclo | Mesmo registro e recibo; `duplicate:true`, sem segunda inferência |
| Segundo desafio posterior | 08/10/2026 02:33:41.988Z; outro registro, mesmo corpus e KH-021 recuperado |
| Readback | 02:36:29Z: exatamente dois arquivos persistidos para dois desafios; localModelCalls 1 → 3, externalAiCalls/externalTokens 0 |

Os horários dos registros são do dispositivo. Registros reais de prompt/resposta permanecem no estado privado do Xeon.

Recibo resumido do primeiro ciclo:
- recordId: `df4c1bc6bd70f442dcb5480e023f13c2c44404df3c9ab033fd69cf2d0e014c26`
- learningSha256: `282c7af053bd3c1a65f36b515d04cc3f05aae20d916b67cf7463b421c9545a8c`
- autenticação HMAC: `7b35d41f4f5a9b43b87d3f90cd73007f20b0690ee8958b4bb428ea616b0644d5`
- state: `PROPOSED`, applied:false, cloudSyncVerified:false.

## Limites de conclusão e próximos gates

A suíte global Windows executou 489 testes: 473 passaram e 16 falharam. Os diagnósticos mostram aliases ausentes de Python3, Bash/Ruby indisponíveis no PATH e padrões LF recebendo checkout CRLF. A aprovação global depende do gate Linux existente no SHA desta candidata; não é inferida das regressões dirigidas.

Há comprovação de dois ciclos locais solicitados e do reaproveitamento idempotente, não de captura automática de outras sessões do ChatGPT, sincronização cloud, treinamento de pesos ou serviço ininterrupto de ingestão. A API direta ainda audita hashes; captura detalhada exige o adaptador autorizado. O lock local não comprova fencing distribuído.

O vínculo autenticado orgId ↔ CNPJ e todos os índices/caches/adaptações de uma nova empresa exigem onboarding e provas próprias. O patch não provisiona empresas nem promove dados de clientes. A guarda orgânica é defesa adicional sobre o serviço existente; não há evidência de vazamento externo explorado.

Para o aceite distribuído de ingestão permanece necessário backend versionado, uma entidade/versão imutável/efeito persistido e rejeição do proprietário anterior após handoff. O domínio público também requer cutover e sessão autenticada próprios.

Rollback: reverter a candidata para o código anterior, desativar o adaptador sem apagar registros e restaurar o backup do corpus anterior validando seu hash. Não alterar IAM, credenciais, banco operacional ou instalação de clientes.
