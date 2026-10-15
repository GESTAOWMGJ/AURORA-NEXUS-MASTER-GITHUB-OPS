# Ingestão documental HML — escopo aprovado em 15/10/2026

Baseline de fonte: `c7c234cae263a4c2cb4fa854a5fa26a4ab0b3509`.
Produto: `1.1.0-beta.2`; componente afetado: publicação do backend HML.

O teste real isolado da baseline extraiu Google Docs, Sheets, texto e PDF/OCR,
mas os quatro envios foram recusados com `KEY_SCOPE_VIOLATION`. Extração não
comprovou persistência, replay nem ingestão global.

O titular respondeu **“Autorizar escopo documental em HML”** à proposta de
acrescentar somente `sourceDocument` a uma credencial ativa e restrita à WMGJ no
keyring HML. A decisão cobre a versão protegida 4, preservando os valores secretos,
as demais entradas e a validade, seguida de republicação e dos quatro testes
sintéticos. Vence em `2026-10-16T03:00:00Z`, conforme a janela HML/R029 vigente.
Não autoriza IAM novo, rotação do token do Site, alteração de login ou ativação
da pasta real. Evidências privadas do operador ficam fora do repositório público.

O verificador de deploy aceita a versão 3 somente na leitura anterior à
implantação; a leitura posterior exige a versão imutável 4. Publicações seguintes
podem conservar 4 → 4. `latest`, outras versões, outro secret, mudança de conta,
IAM ou rota continuam bloqueados. O verificador lê somente metadados e não
afirma conferir os bytes do segredo ou o processamento de documentos.

Testes cobrem 3 → 4, 4 → 4, rejeição de downgrade/versão arbitrária, e impedimento
de emitir prova de sucesso quando o runtime posterior ainda usa a versão 3.
Deploy, teste real de quatro formatos, recibo, replay e limpeza continuam gates
distintos; os resultados serão registrados com o SHA/run efetivamente executado.

Em falha, conservar a baseline e os recibos anteriores. Não destruir versões de
segredo nem reativar automaticamente a versão 3; eventual reversão de escopo exige
decisão explícita e publicação verificada. A referência oficial anterior permanece
disponível para recuperação sem apagar histórico ou documentos.
