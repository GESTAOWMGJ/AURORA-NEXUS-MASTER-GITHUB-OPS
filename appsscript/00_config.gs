/**
 * DEPRECATED — configuração legada neutralizada.
 *
 * Motivo:
 * - Este arquivo declarava WMGJ_CONFIG em escopo global.
 * - A configuração oficial agora fica exclusivamente em src/00_CORE_WMGJ.gs,
 *   por meio de getConfigWMGJ_().
 *
 * Regra operacional:
 * - Não declarar const SPREADSHEET_ID, CONFIG ou WMGJ_CONFIG em escopo global.
 * - Usar getConfigWMGJ_() e getPlanilha() do núcleo oficial.
 */
