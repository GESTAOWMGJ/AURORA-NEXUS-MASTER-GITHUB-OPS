/**
 * WMGJ — Organizador Seguro do Drive Operacional
 * Versão: v1.0.0-organizador-drive-operacional
 *
 * Princípio: não apagar definitivamente. Mover para quarentena/revisão com log.
 * Alvo: reduzir ambiguidade, duplicidade visual e material legado/alheio ao fluxo operacional.
 */

var WMGJ_ORGANIZADOR_DRIVE_VERSAO = 'v1.0.0-organizador-drive-operacional';

function diagnosticarDriveOperacionalWMGJ() {
  return organizarDriveOperacionalWMGJ({ dryRun: true, limiteEntrada: 200 });
}

function organizarDriveOperacionalWMGJ_Seguro() {
  return organizarDriveOperacionalWMGJ({ dryRun: false, limiteEntrada: 300 });
}

function organizarDriveOperacionalWMGJ(opcoes) {
  opcoes = opcoes || {};
  var dryRun = opcoes.dryRun !== false;
  var cfg = getConfigWMGJ_();
  var raiz = DriveApp.getFolderById(cfg.PASTA_RAIZ_ID);
  var entrada = DriveApp.getFolderById(cfg.PASTA_ENTRADA_ID);

  var inicio = new Date();
  var resultado = {
    ok: true,
    versao: WMGJ_ORGANIZADOR_DRIVE_VERSAO,
    etapa: 'organizarDriveOperacionalWMGJ',
    modo: dryRun ? 'DIAGNOSTICO_SEM_MOVER' : 'EXECUCAO_SEGURA_COM_QUARENTENA',
    pastaRaizId: cfg.PASTA_RAIZ_ID,
    pastaEntradaId: cfg.PASTA_ENTRADA_ID,
    inicio: inicio.toISOString(),
    fim: null,
    movidos: [],
    preservados: [],
    alertas: [],
    erros: []
  };

  try {
    var pastas = prepararEstruturaOrganizacaoDriveWMGJ_(raiz, dryRun, resultado);
    organizarItensSoltosNaRaizWMGJ_(raiz, pastas, dryRun, resultado);
    organizarEntradaDocumentosWMGJ_(entrada, pastas, dryRun, resultado, Number(opcoes.limiteEntrada || 300));
    resultado.fim = new Date().toISOString();
    resultado.duracaoSegundos = Math.round((new Date(resultado.fim).getTime() - inicio.getTime()) / 1000);
    registrarLogOrganizadorDriveWMGJ_(resultado.ok ? 'OK' : 'ALERTA', dryRun ? 'diagnosticarDriveOperacionalWMGJ' : 'organizarDriveOperacionalWMGJ_Seguro', resultado);
    registrarStatusOrganizadorDriveWMGJ_(resultado);
    return resultado;
  } catch (erro) {
    resultado.ok = false;
    resultado.erros.push(erro && erro.message ? erro.message : String(erro));
    resultado.fim = new Date().toISOString();
    registrarLogOrganizadorDriveWMGJ_('ERRO', 'organizarDriveOperacionalWMGJ', resultado);
    registrarStatusOrganizadorDriveWMGJ_(resultado);
    return resultado;
  }
}

function prepararEstruturaOrganizacaoDriveWMGJ_(raiz, dryRun, resultado) {
  var governanca = obterOuCriarSubpastaDriveWMGJ_(raiz, '00_GOVERNANCA', dryRun, resultado);
  var produtividade = obterOuCriarSubpastaDriveWMGJ_(raiz, '03_PRODUTIVIDADE', dryRun, resultado);
  var quarentena = obterOuCriarSubpastaDriveWMGJ_(raiz, '99_QUARENTENA_REVISAO_WMGJ', dryRun, resultado);

  return {
    raiz: raiz,
    governanca: governanca,
    produtividade: produtividade,
    quarentena: quarentena,
    legado: obterOuCriarSubpastaDriveWMGJ_(quarentena || raiz, '01_LEGADO_REVISAR', dryRun, resultado),
    duplicidades: obterOuCriarSubpastaDriveWMGJ_(quarentena || raiz, '02_DUPLICIDADES_REVISAR', dryRun, resultado),
    testes: obterOuCriarSubpastaDriveWMGJ_(quarentena || raiz, '03_TESTES_E_ARTEFATOS', dryRun, resultado),
    alheios: obterOuCriarSubpastaDriveWMGJ_(quarentena || raiz, '04_ALHEIO_A_OPERACAO_REVISAR', dryRun, resultado),
    implantacaoLegado: obterOuCriarSubpastaDriveWMGJ_(quarentena || raiz, '05_IMPLANTACAO_LEGADO_REVISAR', dryRun, resultado),
    atasGovernanca: obterOuCriarSubpastaDriveWMGJ_(governanca || raiz, 'ATAS_REUNIAO_SOCIOS', dryRun, resultado),
    escalaLegado: obterOuCriarSubpastaDriveWMGJ_(produtividade || raiz, 'ESCALA_LEGADO_REVISAR', dryRun, resultado)
  };
}

function organizarItensSoltosNaRaizWMGJ_(raiz, pastas, dryRun, resultado) {
  var essenciais = {
    '00_GOVERNANCA': true,
    '01_ENTRADA_DOCUMENTOS': true,
    '02_FINANCEIRO': true,
    '03_PRODUTIVIDADE': true,
    '04_RELATORIOS': true,
    '05_GLOSAS': true,
    '06_CONTRATOS': true,
    '07_BACKUP': true,
    '99_QUARENTENA_REVISAO_WMGJ': true
  };

  var folders = raiz.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    var nome = folder.getName();
    if (essenciais[nome]) {
      resultado.preservados.push({ tipo: 'folder', nome: nome, motivo: 'PASTA_OPERACIONAL_ESSENCIAL' });
      continue;
    }

    if (nome === 'ATAS - REUNIAO SOCIOS' || nome === 'ATAS - REUNIÃO SÓCIOS') {
      moverPastaDriveWMGJ_(raiz, folder, pastas.atasGovernanca, dryRun, resultado, 'GOVERNANCA_ATAS_SOCIOS');
    } else if (nome === 'ESCALA') {
      moverPastaDriveWMGJ_(raiz, folder, pastas.escalaLegado, dryRun, resultado, 'ESCALA_LEGADO_FORA_DO_NUCLEO');
    } else if (nome === 'TREINAMENTO') {
      moverPastaDriveWMGJ_(raiz, folder, pastas.legado, dryRun, resultado, 'TREINAMENTO_LEGADO_FORA_DO_NUCLEO');
    } else if (nome === 'DOCS WMGJ') {
      moverPastaDriveWMGJ_(raiz, folder, pastas.legado, dryRun, resultado, 'DOCS_GERAIS_POTENCIAL_DUPLICIDADE');
    } else {
      moverPastaDriveWMGJ_(raiz, folder, pastas.alheios, dryRun, resultado, 'PASTA_NAO_ESSENCIAL_NA_RAIZ');
    }
  }

  var files = raiz.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var nomeArquivo = file.getName();
    if (/implanta[cç][aã]o|automatizada|shortcut/i.test(nomeArquivo)) {
      moverArquivoDriveWMGJ_(raiz, file, pastas.implantacaoLegado, dryRun, resultado, 'ATALHO_IMPLANTACAO_LEGADO');
    } else {
      moverArquivoDriveWMGJ_(raiz, file, pastas.alheios, dryRun, resultado, 'ARQUIVO_SOLTO_NA_RAIZ');
    }
  }
}

function organizarEntradaDocumentosWMGJ_(entrada, pastas, dryRun, resultado, limite) {
  var files = entrada.getFiles();
  var vistosPorAssinatura = {};
  var processados = 0;

  while (files.hasNext() && processados < limite) {
    processados++;
    var file = files.next();
    var nome = file.getName();
    var assinatura = normalizarAssinaturaArquivoDriveWMGJ_(nome);

    if (/^TESTE_|TESTE_PIPELINE|DEBUG|TEMP|tmp/i.test(nome)) {
      moverArquivoDriveWMGJ_(entrada, file, pastas.testes, dryRun, resultado, 'ARTEFATO_TESTE_NA_ENTRADA');
      continue;
    }

    if (!/^GMAIL__/i.test(nome) && /(Bradesco|Extrato|extrato|boleto|nota fiscal|nfse|nfs-e|xml|pdf)/i.test(nome)) {
      moverArquivoDriveWMGJ_(entrada, file, pastas.duplicidades, dryRun, resultado, 'ARQUIVO_BRUTO_SEM_PADRAO_GMAIL_POTENCIAL_DUPLICIDADE');
      continue;
    }

    if (vistosPorAssinatura[assinatura]) {
      moverArquivoDriveWMGJ_(entrada, file, pastas.duplicidades, dryRun, resultado, 'DUPLICIDADE_POR_NOME_NORMALIZADO');
      continue;
    }

    vistosPorAssinatura[assinatura] = true;
    resultado.preservados.push({ tipo: 'file', nome: nome, motivo: 'ENTRADA_PADRONIZADA_OU_UNICA' });
  }

  if (files.hasNext()) {
    resultado.alertas.push('Limite de varredura atingido em 01_ENTRADA_DOCUMENTOS: ' + limite + ' arquivos.');
  }
}

function obterOuCriarSubpastaDriveWMGJ_(pai, nome, dryRun, resultado) {
  if (!pai) return null;
  var existentes = pai.getFoldersByName(nome);
  if (existentes.hasNext()) return existentes.next();

  if (dryRun) {
    resultado.alertas.push('DRY_RUN: criaria pasta ' + nome + ' dentro de ' + pai.getName());
    return null;
  }

  var criada = pai.createFolder(nome);
  resultado.movidos.push({ tipo: 'folder_create', nome: nome, destino: pai.getName(), motivo: 'ESTRUTURA_ORGANIZACAO' });
  return criada;
}

function moverPastaDriveWMGJ_(origem, folder, destino, dryRun, resultado, motivo) {
  var item = { tipo: 'folder', nome: folder.getName(), origem: origem.getName(), destino: destino ? destino.getName() : 'DRY_RUN_DESTINO', motivo: motivo };
  if (dryRun) {
    item.acao = 'SIMULARIA_MOVER';
    resultado.movidos.push(item);
    return;
  }
  if (!destino) {
    resultado.alertas.push('Destino ausente para pasta: ' + folder.getName());
    return;
  }
  destino.addFolder(folder);
  origem.removeFolder(folder);
  item.acao = 'MOVIDO';
  resultado.movidos.push(item);
}

function moverArquivoDriveWMGJ_(origem, file, destino, dryRun, resultado, motivo) {
  var item = { tipo: 'file', nome: file.getName(), origem: origem.getName(), destino: destino ? destino.getName() : 'DRY_RUN_DESTINO', motivo: motivo };
  if (dryRun) {
    item.acao = 'SIMULARIA_MOVER';
    resultado.movidos.push(item);
    return;
  }
  if (!destino) {
    resultado.alertas.push('Destino ausente para arquivo: ' + file.getName());
    return;
  }
  destino.addFile(file);
  origem.removeFile(file);
  item.acao = 'MOVIDO';
  resultado.movidos.push(item);
}

function normalizarAssinaturaArquivoDriveWMGJ_(nome) {
  return String(nome || '')
    .toLowerCase()
    .replace(/^gmail__\d{8}_\d{6}__[^_]+__[^_]+__[^_]+__/, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}

function registrarStatusOrganizadorDriveWMGJ_(payload) {
  if (typeof registrarStatusAutomacaoWMGJ_ === 'function') registrarStatusAutomacaoWMGJ_(payload);
}

function registrarLogOrganizadorDriveWMGJ_(status, comando, payload) {
  if (typeof registrarLogWMGJ_ === 'function') {
    registrarLogWMGJ_(status, comando, 'OrganizadorDriveOperacional', JSON.stringify(payload));
    return;
  }
  Logger.log([status, comando, JSON.stringify(payload)].join(' | '));
}
