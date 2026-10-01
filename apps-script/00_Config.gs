/**
 * DEPRECATED — configuração legada neutralizada.
 *
 * Motivo:
 * - Este arquivo declarava WMGJ_CONFIG em escopo global.
 * - O Apps Script compartilha escopo global entre arquivos .gs.
 * - A configuração oficial agora fica exclusivamente em src/00_CORE_WMGJ.gs,
 *   por meio de getConfigWMGJ_().
 *
 * Regra operacional:
 * - Não declarar WMGJ_CONFIG, CONFIG ou SPREADSHEET_ID em escopo global.
 * - Usar getConfigWMGJ_() e getPlanilha() do núcleo oficial.
 */
