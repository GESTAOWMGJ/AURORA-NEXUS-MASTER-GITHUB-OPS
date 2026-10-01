# Segurança, LGPD e dados de saúde

## Classificação

- `PUBLIC`: material público institucional.
- `INTERNAL`: runtime e operação sem dado pessoal sensível.
- `RESTRICTED`: financeiro, contratos, dados profissionais e documentos fiscais.
- `CLINICAL_SENSITIVE`: prontuário, paciente, diagnóstico, autorização clínica e evidência assistencial identificável.

## Regras

1. Não usar nome, CPF, CNPJ, e-mail, paciente ou diagnóstico como ID de documento.
2. Guardar o mínimo necessário e vincular a evidência original por referência controlada.
3. Dados clínicos ficam em coleção própria, com papéis mais restritos.
4. Admin SDK usa IAM de privilégio mínimo; clientes usam Auth + Security Rules.
5. Logs não armazenam texto clínico, segredo, token ou arquivo bruto.
6. Toda exportação e compartilhamento precisam de finalidade, responsável e trilha.
7. Definir retenção por categoria e obrigação legal/contratual; não apagar por conveniência técnica.
8. Preparar plano de resposta a incidente e registro de operações de tratamento.
9. Exigir App Check nas rotas FastAPI autenticadas e MFA para decisões humanas.
10. Negar projeção sem `facilityId` a membros limitados; agregado organizacional exige `allFacilities=true`.
11. A ingestão genérica rejeita `CLINICAL_SENSITIVE`, aprovação/rejeição e fechamento crítico.
12. Ativar TTL em `requestNonces.expiresAt` antes da homologação do endpoint HMAC.

## Papéis iniciais

- `platform_admin`
- `org_admin`
- `director`
- `auditor`
- `medical_auditor`
- `finance`
- `operator`
- `viewer`

Atribuição e revogação de papéis devem ocorrer apenas pelo backend administrativo.
