# JFN-AUD-FAT-001 — contrato de evolução da integração

## O que o portal já consome

O snapshot existente entrega faturamento, recebimento, pendência financeira, diferença de conciliação declarada, contagens de auditoria, processamento e estado das fontes. Os dados são lidos do backend canônico após autenticação, App Check e autorização por instituição. O gateway descarta campos não permitidos e não calcula glosas a partir de ausência de caixa.

## O que permanece fora da integração real desta versão

Leitura de registros individualizados; anexos originais; correlação contrato → produção → apresentação → aprovação/glosa → NF → recebível → caixa → repasse; devolutivas administrativas; questionamento e resposta integrais; escrita de achados; validação/assinatura; fechamento persistido; recuperação de receita; migração histórica. O frontend exibe essa limitação, em vez de representar toda a cadeia como conectada.

## Próximo contrato de backend — proposta, não endpoint publicado

Criar módulo não destrutivo, versionado e segregado por organização, com os campos:

- Identidade: orgId, facilityId, reconciliationId, revision, schemaVersion, rulesetVersion, sourceVersion.
- Temporalidade: competência assistencial, competência de faturamento, competência fiscal, emissão da NF, vencimento, recebimento e repasse, cada um independente; início da operação somente quando documentado.
- Evidência: referência opaca ao documento, hash, origem, responsável, vigência contratual, data de captura e validação. Não retornar nomes/CPF/dados clínicos para o painel executivo.
- Montantes: centavos inteiros ou decimal validado na fronteira; valores esperados, apresentados, aprovados, glosados, faturados, recebidos e repassados distintos. Ausência = null, nunca zero.
- Achado: questionamento original, resposta administrativa integral em repositório protegido, versão, evidência aceita, responsável, prazo, parcela explicada e residual ainda aberto.
- Decisão: estado do achado separado do estado gerencial da competência; idempotencyKey e expectedRevision em toda escrita; autor, log e aprovação humana quando exigida.

Não deduzir glosa, duplicidade ou marcação R=* sem regra validada. Segregar TESTE não autoriza descartar outros registros. Fechamento gerencial com ressalvas pode ocorrer sem encerrar os achados; controles independentes podem continuar impeditivos. Não acoplar fechamento a pagamentos ou notas.

Separar oportunidade identificada, valor reconhecido, recuperação recebida e receita protegida demonstrável. Não somar duas etapas do mesmo benefício.

## Sequência de liberação

1. Contrato e fixtures sintéticos validados entre backend e frontend.
2. Testes unitários, concorrência, revisão, idempotência, autorização e isolamento institucional.
3. Homologação com snapshots sanitizados, sem sincronização de dados reais nesta etapa.
4. Aprovação de domínio, retenção, acessos, observabilidade, segurança e rollback.
5. Migração incremental autorizada, reconciliação por competência e comparação paralela antes da troca de fonte.

O pacote atual não instala observadores, robôs, gatilhos, pipelines de cobrança nem ferramentas de decisão clínica.
