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

Ainda necessários para distribuição comercial completa: seletor visual/aceite autenticado das fontes no web app; conectores vendor-specific quando MV/TASY exigirem APIs proprietárias em vez de pasta/exportação ou push canônico; empacotamento/atualização assinada do app macOS existente; teste nativo macOS; teste ponta a ponta autenticado com uma instalação cliente real. O registro `DRIVE_FOLDER`, o endpoint canônico de integração, a ponte Firebase sanitizada e o acompanhamento documental contínuo estão implementados em código, mas não constituem deploy ou instalação comprovados.

A passagem para operação exige também os gates do PR #38/issue #32: ambiente de homologação aprovado, identidade de deploy, segredos, usuários/memberships, proteção do banco, backup/restore e smoke tests. `wmgj-ops` permanece inalterado. Testes unitários e código no repositório não são evidência de deploy, ingestão real, resultado financeiro ou aplicativo instalado.

## Testes reproduzíveis

```bash
python -m unittest discover -s aurora-coletor/tests -p 'test_onboarding.py' -v
```

A suíte usa apenas dados sintéticos e diretórios temporários. Cobre consentimento, expiração, escopo, isolamento, links, leitura apenas de metadados, limites, versões, cobertura, permissões, bloqueio concorrente, geração de ferramentas, rejeição de operações e integração do instalador. O workflow `Validate Aurora Onboarding` não possui etapa de deploy nem usa segredos.


## Atualização 1.2 — plano nativo Firebase e vigilância documental

A instalação atual possui registro de fontes documentais por organização e suporta dois caminhos complementares:

1. `DRIVE_FOLDER`: pasta explicitamente autorizada que recebe documentos/exportações de Drive, MV, TASY ou outro ERP. Cada fonte recebe `sourceId`, `system`, `folderId`, SLA e estado ativo.
2. `AURORA_INTEGRATION_API`: endpoint `/api/integration/documents` para MV/TASY/ERP que consigam fazer push server-to-server usando chave Aurora com escopo `documents.ingest`.

O segundo caminho aceita somente contrato estruturado fechado. Não aceita narrativa, arquivo bruto, paciente, prontuário, diagnóstico ou campos arbitrários. O identificador externo é imediatamente reduzido a hash técnico para persistência.

Depois da ingestão aceita, a origem deixa de ser dependência da inteligência nativa. O estado operacional é materializado em Firestore com `canonicalSnapshotVersion`, `canonicalSnapshotHash`, `nativeReady`, `sourceIndependent`, origem, SLA, fluxo e fragilidade. A inferência nativa exige `dashboardSnapshots/current` e `sourceAccessDuringInference=false`.

Classificação documental segue native-first. `AURORA_EXTERNAL_AI_FALLBACK_ENABLED` nasce desativado; Gemini/OpenAI ou outro provedor externo só pode ser chamado para documento não resolvido pelo classificador nativo e quando o fallback tiver sido explicitamente habilitado.

O watchdog Firebase cria uma pendência governada e idempotente quando encontra:
- fragilidade documental;
- SLA documental vencido;
- bloqueio/gargalo de workflow.

A ação é direcionada ao `sourceDocument` canônico e não altera o ERP. A resolução material exige evidência e usuário autorizado. Quando uma ação gerada pelo watchdog é resolvida, o sistema tenta registrar automaticamente o caso no AURORA-ORG-001. Evidência `RESTRICTED` só é elegível para esse aprendizado quando for snapshot sanitizado, `nativeReady`, `sourceIndependent`, com hash canônico e sem necessidade de nova busca na origem.

O fluxo é, portanto:

```text
MV / TASY / ERP / Drive
→ captura autorizada
→ Firebase canônico
→ Native Intelligence
→ watchdog de fragilidade/SLA/fluxo
→ resolução validada
→ observação orgânica
→ proposta limitada
→ revisão humana
→ medição / manutenção / rollback
```

Nenhum desses componentes autoriza mutação autônoma do MV/TASY, encerramento financeiro, mudança contratual ou decisão clínica.
