# Nuvem do cliente e primeira instalação — 13/10/2026

Baseline: `067aecf14d0b0119b204bf2ec6e7cd892aed9586`. Mesmo produto,
M01/M08/M10 e rotina `AURORA-INSTALL-INTEGRATION-001`; não cria outro motor.

## Requisito e incremento

O titular autorizou primeira instalação plug and play com os conectores e chaves
necessários à operação e continuidade da ingestão até o fim do escopo do cliente.
O agente 1.0.0 consultava repetidamente a primeira página dos provedores. O 1.0.1
continua Drive/Gmail por pageToken, Microsoft Mail por nextLink estritamente
vinculado à mesma pasta, e IMAP por UIDVALIDITY/UID em leitura somente.

No estado protegido já existente, cursores só avançam após recibos de processamento
de todos os documentos estruturados da página. A página em curso tem fingerprint
estável: mudança exige reconciliação, sem descartar pendência. Queda depois do commit
remoto retoma a mesma chave canônica. Uma nova travessia após EOF descobre alterações
e reutiliza recibos, sem duplicar documentos. Lotes respeitam limites de recurso;
o mesmo watch continua após a primeira instalação, sem outro scheduler.

`cloudEnumerationComplete` confirma somente travessia do escopo delimitado.
`cloudSnapshotVerified` também exige recibos processados e ausência de extrações
pendentes. `fullSynchronizationVerified` permanece false: listagem/um documento não
comprovam cobertura de toda a empresa, formato não suportado ou estado financeiro.
PDF/XLS/XML e outros formatos continuam pendentes de extração pelo fluxo existente.
Microsoft com paginação de anexos bloqueia avanço, sem omissão silenciosa.

## Provisionamento necessário por cliente

1. Identidade autenticada e vínculo empresarial vigente no destino aprovado.
2. Fontes explícitas: pasta Drive, label Gmail, pasta Microsoft ou pasta IMAP.
3. Credencial AURORA com `documents.ingest`, emitida pela API administrativa
   existente com sessão, MFA e alçada. Nunca reutilizar chave de outro cliente.
4. Consentimento e tokens OAuth oficiais dos provedores configurados. IMAP exige
   OAuth2/TLS; o agente não coleta senha do provedor nem contorna consentimento.
5. Segredos em DPAPI/Keychain no componente protegido, fora do navegador/argv/log.
6. Instalação autorizada com `--startup --start-now`; tenant validado antes de
   qualquer leitura da origem; teste real do conector, recibo e versão/hash processados.

Adaptadores presentes e empacotados não significam que essas etapas ocorreram.
Renovação OAuth automatizada, extração de todos os formatos e testes reais dos
provedores permanecem dependências abertas. Não há criação de identidade/chave de
terceiros apenas pelo código nem transmissão sem credencial própria válida.

## Evidências separadas desta sessão

- PR #244 integrado em `067aecf1`; P2 de recibo de domínio resolvido.
- Cliente Mac existente identificado, backup integral com hashes conferido,
  identidade e recursos preservados; launcher atualizado para
  `2026.10.13-beta.1` e `https://auroranexus.com.br/portal`.
  Diagnóstico nativo passou e o sistema aceitou a abertura do aplicativo.
- Probe no Mac: portal 200 com formulário de senha, bootstrap anônimo
  401/AUTH_REQUIRED, projeto HML esperado conferido. Isso não prova login do titular.
- Fonte WMGJ: metadados da planilha mestre e pasta operacional conferidos;
  59 abas identificadas. Amostra de cabeçalhos do índice Gmail diverge entre
  layouts; amostra de memória contém fallback de metadados. O backfill atual não
  mapeia todas as abas. Nenhum desses registros foi promovido a fato financeiro.
- Xeon: comando de status aceito pelo TRIGGERcmd sem recibo de execução.
  Inventário Desktop Commander mostra Windows offline. Nenhuma ingestão completa
  ou implantação do agente foi comprovada nesse dispositivo nesta sessão.

## Publicação pelo fluxo existente

O deploy/publisher run `38435627327` teve os três jobs relidos com sucesso;
o recibo versionado em `0fca3cb2ff95f74bd60724dde83655e7a0991181` confirma
activeRelease ACTIVE em `a89d431c` e certificado
`a71a53a3cfa56005b30b793defe73be188d9a4a079f199974b390826ba7d58f5`.
O request HML deste incremento usa esse predecessor explícito e a baseline
ancestral aprovada. O dispatcher existente resolve CI e PR no SHA novo e o
publisher exige compare-and-swap; promoção concorrente bloqueia, sem sobrescrita.
A execução e eventual aprovação do environment continuam sendo provas próprias.
Não repete ingestão maio/2026, restore, rotação HMAC ou reconciliação já realizada.

## Validação, motor e retomada

Testes sintéticos executam o transporte e os recibos reais com respostas simuladas:
paginação, isolamento, prova pendente, formatos não extraídos, alteração de página,
repetição idempotente e crash real de processo antes/depois do commit remoto.
CI, por SHA, pertence ao PR deste incremento. `cloudIntakePolicy` incorpora a regra
abstrata ao registro nativo existente e à projeção; código não significa adoção no
runtime cloud/Xeon, nem treinamento de pesos ou ingestão WMGJ concluída.

Retomar pelo executor existente quando acessível: conferir versão/hash e identidade,
ler configuração e status sem exibir segredos, reconciliar filas/cursores, validar
consentimentos, executar o watch e conferir cobertura/recibos até EOF e extrações.
Cobertura total fica PENDING até manifestos das fontes e comparação de contagens,
hashes, pendências e documentos recuperáveis. Dados clínicos sensíveis mantêm seus
gates próprios; não entram no fluxo administrativo para contornar essa dependência.

Rollback: versão anterior do agente preserva intake/recibos; tabelas de progresso
novas podem permanecer sem uso. Restaurar o launcher pelo backup privado conferido,
apenas se os arquivos ainda corresponderem ao recibo da atualização; não apagar
fontes, credenciais, dados ou recursos cloud. Não iniciar executores equivalentes.
