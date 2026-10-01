// WMGJ ROBÔ PJ V5.2.0 — HOTFIX DE IDEMPOTÊNCIA
// Fonte integral validada: artefato WMGJ_ROBO_PJ_V5_2_UNICO.gs do pacote operacional.
// Este arquivo de repositório documenta o hotfix; a implantação no projeto Apps Script deve usar o artefato integral versionado.

function wmgjPJ_v52_diagnosticoDuplicacao() {
  return {
    version: '5.2.0',
    causaRaiz: 'persistencia fisica baseada em timestamp; reprocessamento podia criar novo arquivo mesmo com conteudo identico',
    correcao: [
      'nome fisico deterministico SHA256_<hash integral>_<nome original>',
      'consulta da pasta antes de criar arquivo',
      'reuso do mesmo Drive file ID quando o hash ja existe',
      'quarentena idempotente',
      'auditoria diaria de artefatos ERRO/FALHA/PROMPT/DEBUG/DUPLICADO/QUARENTENA',
      'nenhuma exclusao automatica de evidencia primaria'
    ],
    criteriosAceite: [
      'reprocessar o mesmo anexo nao aumenta a quantidade de arquivos',
      'falha de manifesto nao cria nova copia fisica',
      'alerta repetido sem mudanca permanece suprimido',
      'achados de saude operacional sao registrados sem exclusao automatica'
    ]
  };
}

/*
PATCH INTEGRAL APLICADO NA FONTE V5.2.0:
1. WMGJ_PJ.VERSION: 5.1.0 -> 5.2.0.
2. WmgjPJDrive.saveAttachment(): substitui timestamp por nome deterministico SHA-256 e getFilesByName antes de createFile.
3. WmgjPJDrive.saveQuarantineBlob(): mesma regra idempotente.
4. WmgjPJDrive.auditOperationalHealth(): auditoria de arquivos suspeitos e possiveis duplicidades.
5. wmgjPJ_executar_(): executa auditOperationalHealth em todo job diario e registra o resultado na trilha de auditoria.
6. Teste de versao e sintaxe adicionados.
*/
