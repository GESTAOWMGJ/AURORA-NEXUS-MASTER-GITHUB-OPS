# AURORA-RELIABLE-RESULT-001 — resultado confiável com exceções

O motor preserva valores comprovados quando um registro financeiro isolado tem
valor inválido. A mesma política atende projeção, governança, inteligência nativa,
Motor Mestre e apresentação, por organização e competência.

Exemplo sintético: valores validados de 100 e 300, com um registro inválido,
produzem subtotal 400, dois incluídos e um excluído. O total completo permanece
desconhecido. Recebimentos conciliados independentes continuam disponíveis; a
diferença faturado/recebido não é calculada com bases incompletas.

## Contrato

- `reliableResult` é aditivo ao snapshot existente. Valores canônicos completos
  não são substituídos por subtotais. Estados: AVAILABLE, PARTIAL e NO_VERIFIED_VALUE.
- Somente registros validados, da competência, sem marca de teste, sem histórico
  substituído/cancelado e com centavos inteiros válidos entram no subtotal.
- Cada indicador conserva quantidade incluída, excluída e cobertura. A porcentagem
  é de registros elegíveis à agregação; não representa cobertura de todo o Drive.
- Overflow retém o indicador afetado; não publica soma truncada dependente da ordem.
- Governança permite REVIEW apenas com contrato do subconjunto consistente,
  mantendo autenticação e escopo upstream, proveniência, frescor e demais vetos.
- A interface indica “parcial” e as exclusões. Zero conhecido permanece zero;
  ausência de valor comprovado permanece explícita. Nenhuma autorização financeira
  ou movimentação decorre desta leitura.
- Falhas documentais permanecem rastreáveis sem bloquear resultados independentes.
  Alimentação usa fila, checkpoints, retry limitado e idempotência existentes.
  Este patch não cria um coletor nem silencia erros de segurança.

## Aprendizado reutilizável

Desafio: uma inconsistência localizada impedia apresentar um resultado utilizável.
Regra genérica: agregar o subconjunto validado, declarar exclusões e separar
disponibilidade do resultado de completude e decisão humana. Dados privados não
integram o padrão. O registro nativo expõe `reliableResultPolicy`; AGENTS exige
regressão para os próximos patches pertinentes. Não é treinamento de pesos nem
prova de atualização automática de todos os clientes.

## Validação e adoção

As regressões cobrem entrada mista, zero/ausência, overflow, período, histórico,
dados de teste, imutabilidade, determinismo, adulteração de contagens, limites de
segurança, paridade servidor/browser e sintaxe do script renderizado.
Código e testes têm provas separadas de CI, integração, implantação e uso real.
Não há garantia de inexistência de bugs. Rollback: reverter o patch; os campos
canônicos completos e os documentos de origem foram preservados.
