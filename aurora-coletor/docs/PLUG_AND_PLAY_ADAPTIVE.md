# AURORA NEXUS — implantação assistida e evolução adaptativa

Atualização de engenharia: 28/09/2026. Extensão do coletor existente, subordinada ao sistema-mãe AURORA NEXUS; não cria outra fonte oficial nem substitui WMGJ Operação.

## Entregue nesta etapa

`install.py` inclui `aurora_onboarding.py`, configuração própria de escopo, `discover.sh` e exemplo de LaunchAgent. O coletor original continua restrito aos formatos administrativos já homologados; o novo catálogo **não é transmitido ao endpoint de ingestão**.

A descoberta local identifica candidatos PDF, Word, planilhas, CSV/JSON/XML, texto e imagens por **metadados**, sem abrir o conteúdo. Registra organização, raiz autorizada, caminho relativo, tamanho, modificação, identificador, impressão de metadados, versão, captura e cobertura. O índice contém informação privada e permanece local, com diretório 0700 e arquivo 0600; não deve ser publicado no GitHub, em anexos de suporte ou em logs.

A classificação por nome é uma pista não validada, não uma leitura fiscal, contratual ou clínica. Modificação do arquivo não é competência. `DISCOVERED_NOT_INGESTED` não comprova processamento, validação, conciliação ou recebimento. Impressão de metadados não é hash do conteúdo nem assinatura digital.

A rotina distingue novo, alterado, inalterado, não observado e cobertura desconhecida. Ausência só é registrada como “não observado” quando a enumeração daquele escopo foi completa; nunca como exclusão. Limites de profundidade/quantidade e falhas de acesso ficam explícitos. O programa não move, apaga ou modifica fontes, não lê credenciais, não segue symlinks/hardlinks e não abre diretórios pessoais, clínicos ou de sistema excluídos. Raízes amplas como disco, pasta pessoal, Desktop, Documents e Downloads são recusadas; uma subpasta institucional explicitamente aprovada pode ser usada. Adaptadores de nuvem devem ser autorizados separadamente, sem forçar sincronização de arquivos.

## Instalação facilitada

O mesmo instalador exige os parâmetros já existentes da identidade técnica e da ingestão em homologação. A descoberta é entregue **desativada** até a instituição fornecer escopo e autorização. Para habilitá-la, a instalação recebe:

```text
--authorize-discovery
--discovery-root /caminho/absoluto/da/subpasta-institucional
--discovery-actor-ref ID-TECNICO-DO-RESPONSAVEL
--discovery-authorization-ref ID-DO-TERMO-DE-ESCOPO
--discovery-expires-at DATA-ISO-8601-COM-FUSO
```

`--discovery-root` é repetível. Sem ele, usa-se a pasta de entrada já selecionada, desde que aprovada e sem sobreposição com o estado do aplicativo. A autorização documental local não equivale a autenticação/assinatura do administrador no servidor; o aceite autenticado do onboarding web ainda precisa ser integrado.

`discover.sh` executa um ciclo local. `discover.sh --watch` repete a leitura a cada 15 minutos por padrão, com limites de 10 mil entradas e oito níveis. A autorização e seu vencimento são reavaliados a cada ciclo; revogação/vencimento bloqueiam o próximo ciclo. O exemplo de LaunchAgent não é carregado automaticamente. Nenhum comando altera permissões do macOS, desativa segurança, bloqueia a tela ou exige sudo.

A correção do instalador também trata espaços, apóstrofos e `&` nos caminhos do macOS: argumentos shell escapados e plists gerados por `plistlib`. Usa o interpretador Python efetivamente empregado na instalação.

## Aprendizado operacional e criação de ferramentas

A implementação inicial constrói um perfil determinístico por cliente a partir das categorias documentais observadas. Com pelo menos três documentos distintos de uma categoria, compõe uma ferramenta declarativa específica para inventário por mês de modificação. Releituras do mesmo catálogo não criam ferramentas duplicadas.

Cada definição contém organização, identificador estável, evidência quantitativa, limites, vocabulário permitido, impressão de integridade e status `GENERATED_AWAITING_HUMAN_REVIEW`. Um teste semântico com dados sintéticos precede a emissão. Não há ativação automática. `execute_draft` permite prévia local explicitamente aprovada e rejeita mistura de clientes, integridade divergente e operações fora do vocabulário de leitura. Não executa Python, shell, SQL ou instruções contidas em documentos.

Essa é uma **base funcional limitada para criação de ferramentas declarativas**, não um gerador irrestrito de software e não treinamento automático de modelo. Ainda não aprende motivos de retrabalho, decisões validadas, regras de contrato ou fluxos clínicos; isso exige os eventos, contratos de dados e avaliações descritos abaixo. Os rascunhos atuais são recalculados a partir do catálogo vigente, sem registro permanente de versões de ferramentas aprovadas.

## Evolução prevista — requisitos, não implantação declarada

O ciclo completo deve conectar observações reais autorizadas → necessidade recorrente → especificação → ferramenta candidata → teste isolado → revisão/alçada → piloto → monitoramento → promoção ou reversão. A memória é segregada por organização e registra fonte, finalidade, autorização, versão, responsável, confiança e validade. Dados de um cliente não treinam nem abastecem outro automaticamente.

A fábrica de capacidades deverá gerar, além de relatórios declarativos, propostas de validadores, cruzamentos, indicadores e conectores ausentes. Código novo entra em branch isolada com testes, análise de dependências, limites de recursos, contrato de entrada/saída e rollback. O executor não recebe autoridade para ampliar a própria permissão, escrever no sistema-fonte, alterar contratos, encerrar glosas, autorizar pagamentos ou implantar mudanças críticas por conta própria. Documentos recuperados são dados não confiáveis, nunca instruções de controle.

Exemplo-alvo: recorrência de escala sem evidência de produção pode motivar um confrontador escala × produção × regra contratual. Sua criação exige dados homologados e evidência de que a necessidade existe; o scanner de nomes não comprova essa divergência. A criação e o teste podem ser automáticos; alteração de regra financeira e fechamento de achado permanecem sujeitos a alçada humana.

## Pendências de integração e critérios de aceite

Ainda necessários: seletor de fontes e aceite autenticado no web app; adaptadores autorizados Drive/Gmail; parsers documentais em isolamento; revisão do catálogo e ponte sanitizada para o backend; registro persistente de ferramentas e feedback humano; empacotamento/atualização assinada do app macOS existente; teste nativo macOS e teste ponta a ponta autenticado em homologação. Não distribuir este incremento como `.app`/DMG assinado nem afirmar que está instalado no cliente.

A passagem para operação exige também os gates do PR #38/issue #32: ambiente de homologação aprovado, identidade de deploy, segredos, usuários/memberships, proteção do banco, backup/restore e smoke tests. `wmgj-ops` permanece inalterado. Testes unitários e código no repositório não são evidência de deploy, ingestão real, resultado financeiro ou aplicativo instalado.

## Testes reproduzíveis

```bash
python -m unittest discover -s aurora-coletor/tests -p 'test_onboarding.py' -v
```

A suíte usa apenas dados sintéticos e diretórios temporários. Cobre consentimento, expiração, escopo, isolamento, links, leitura apenas de metadados, limites, versões, cobertura, permissões, bloqueio concorrente, geração de ferramentas, rejeição de operações e integração do instalador. O workflow `Validate Aurora Onboarding` não possui etapa de deploy nem usa segredos.
