/**
 * DEPRECATED — utilitários legados neutralizados.
 *
 * Motivo:
 * - Este arquivo declarava registrarLogWMGJ() e testarExecucaoWMGJ(),
 *   duplicando funções oficiais do núcleo.
 * - Também dependia de WMGJ_CONFIG global, que foi removido.
 *
 * Regra operacional:
 * - Não redeclarar registrarLogWMGJ(), testarExecucaoWMGJ(), getPlanilha()
 *   ou qualquer função já existente em src/00_CORE_WMGJ.gs.
 * - Utilitários novos devem ter nomes únicos ou ficar no núcleo oficial.
 */
