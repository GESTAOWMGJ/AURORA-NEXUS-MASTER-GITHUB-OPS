/**
 * DEPRECATED — webhook legado neutralizado.
 *
 * Motivo:
 * - Este arquivo declarava outro doPost(e), causando conflito no Apps Script.
 * - O webhook oficial agora fica exclusivamente em src/00_CORE_WMGJ.gs.
 *
 * Regra operacional:
 * - Não criar outro doPost neste projeto.
 * - Todo comando deve entrar por executarComandoWMGJ(payload).
 */
