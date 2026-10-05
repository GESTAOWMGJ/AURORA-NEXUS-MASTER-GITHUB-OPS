# Transporte Windows para o Firebase canônico

`aurora_cloud_sync.py` implementa envio explícito, unidirecional, de um registro
JSON estruturado para a API existente `/api/integration/documents`. Funciona com
Python 3.12+ e biblioteca padrão no Windows e Linux. Não é espelhamento de banco,
sincronização bidirecional, extrator de PDFs ou serviço automático.

## Contrato e proteção

- Validação local sem rede é o padrão; `--send` permite transmissão.
- Entrada explícita de até 16 KiB, esquema fechado do backend, sem narrativa livre.
- Identificador documental opaco: não usar nome de paciente, CPF, CNS ou prontuário.
- HTTPS com certificado validado; redirecionamentos nunca recebem a credencial.
- Chave em `AURORA_INTEGRATION_TOKEN`, nunca em argumento, JSON de entrada ou recibo.
- A chave deve ser provisionada pelo administrador com MFA no mecanismo existente
  e conter `integration.read` e `documents.ingest`. Este módulo não emite chaves.
- Ping autenticado confere a organização antes do POST; o servidor repete a autorização.
- Idempotência vincula destino, organização e conteúdo normalizado. Retentativa
  manual repete a mesma chave, inclusive após timeout ou rotação da credencial.
- Recibo confere ID canônico esperado, estado aceito/duplicado e flags documentais.
  O hash no recibo é calculado localmente; não é uma releitura independente do Firestore.
- Conflito, versão regressiva, credencial recusada ou recibo divergente nunca são sucesso.
- Não altera fonte, flags do gateway, SQLite, tarefas agendadas ou executores legados.

## Uso

Usar a origem HTTPS e a organização aprovadas. O arquivo deve conter os 14 campos
de `IntegrationDocumentPayload` em `auroraIntegrationDocument.ts`; datas precisam
de fuso, valores financeiros são centavos inteiros e ausência permanece `null`.
O documento não se torna `nativeReady` quando faltam fatos obrigatórios.

```text
python aurora_cloud_sync.py --input exportacao-estruturada.json --origin https://ORIGEM-AUTORIZADA --org ORGANIZACAO
```

Após credencial provisionada no ambiente do processo e gates de ingestão aprovados:

```text
python aurora_cloud_sync.py --input exportacao-estruturada.json --origin https://ORIGEM-AUTORIZADA --org ORGANIZACAO --send
```

O recibo JSON vai para stdout sem chave, nome de arquivo ou valores financeiros.
Código de saída 0 com `VALIDATED_NOT_SENT` comprova apenas validação local;
`ACCEPTED` ou `DUPLICATE` com `cloudReceiptVerified=true` comprova recibo dessa
requisição HTTPS. Código 2 indica bloqueio/falha, inclusive falha transitória;
`RETRYABLE_*` permite nova tentativa controlada, sem repetir em loop automático.

## Integração com o gateway existente

O gateway pode chamar este transporte somente depois de produzir uma exportação
estruturada autorizada, sem dados clínicos identificáveis, e possuir identidade
provisionada. Não apontar o módulo diretamente para `gateway.sqlite3`: o bootstrap
local não define ainda um contrato de saída de registros de negócio. Sem esse
contrato, sem chave ou sem recibo, manter a sincronização operacional como pendente.

A ativação real exige amostra autorizada, recibo reconciliado, deduplicação remota,
backup/restore e registro de versão. Testes sintéticos não liberam produção ou PHI.

## Testes

```text
python -m unittest discover -s aurora-coletor/tests -p test_cloud_sync.py -v
```

O workflow de onboarding executa a suíte em Ubuntu e Windows, sem rede e sem
credenciais. Preservar a mesma árvore testada para promoção; manter Mac e aplicação
desktop original intactos.
