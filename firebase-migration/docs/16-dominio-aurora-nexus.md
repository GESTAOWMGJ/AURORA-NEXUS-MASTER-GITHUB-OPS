# AURORA NEXUS — Política de domínio e DNS

**Data:** 25/09/2026  
**Produto:** AURORA NEXUS® | JFN-AUD-GOV-001  
**Projeto Firebase atual:** `wmgj-ops`  
**URL técnica atual de fallback/homologação:** `https://wmgj-ops.web.app/portal`  
**Domínio canônico proposto:** `auroranexus.com.br`

## Decisão operacional

O AURORA NEXUS deve ser tratado como produto B2B separado do domínio clínico/consultório `drjoaodefreitas.com.br`.

Enquanto o domínio próprio não estiver registrado, verificado e com SSL emitido, o ambiente técnico permanece acessível apenas pelo domínio Firebase atual. A virada de tráfego para domínio próprio só pode ocorrer depois de validação de DNS, autenticação, App Check, logs, LGPD, controle de acesso por organização e revisão humana operacional.

## Mapa de domínios

| Host | Uso | Ambiente | Observação |
| --- | --- | --- | --- |
| `auroranexus.com.br` | Landing institucional B2B | Produção futura | Página pública, sem dados operacionais. |
| `app.auroranexus.com.br` | Login e dashboard principal | Produção futura | Firebase Hosting/App Hosting; acesso por Firebase Auth. |
| `wmgj.auroranexus.com.br` | Piloto WMGJ Operação | Homologação controlada / produção futura | Isolamento por `orgId=wmgj`. |
| `api.auroranexus.com.br` | Control plane/BFF/FastAPI | Homologação controlada / produção futura | Backend servidor-only; sem chave exposta no front. |
| `docs.auroranexus.com.br` | Documentação e onboarding | Futuro | Somente material sanitizado. |
| `status.auroranexus.com.br` | Health/status operacional | Futuro | Sem dados sensíveis. |

## Regras inegociáveis

1. Não publicar chaves, secrets, tokens, HMAC, service accounts ou credenciais no repositório.
2. Não misturar Portal do Paciente JFN com AURORA NEXUS B2B.
3. Não mover dados clínicos identificáveis para domínio público.
4. Manter `wmgj-ops.web.app` como fallback técnico até o cutover ser validado.
5. Toda rota operacional deve exigir autenticação, App Check quando aplicável, `orgId`, trilha de auditoria e bloqueio de decisão crítica sem revisão humana.
6. A configuração DNS deve ser auditável: data, responsável, print/registro do provedor, valores TXT/CNAME/A aplicados e status de SSL.

## Sequência de ativação DNS/Firebase

### 1. Registro

Registrar preferencialmente `auroranexus.com.br`. Caso indisponível, avaliar variações apenas após checagem jurídica/INPI e coerência de marca.

### 2. Firebase Hosting

No console do Firebase, adicionar primeiro:

```text
app.auroranexus.com.br
wmgj.auroranexus.com.br
```

Depois adicionar `auroranexus.com.br` e `www.auroranexus.com.br` para a página institucional.

### 3. Verificação de propriedade

Adicionar no provedor DNS o registro TXT informado pelo Firebase. Esse TXT deve permanecer ativo para comprovação de propriedade e renovação de certificado.

### 4. Apontamento

Aplicar os registros DNS gerados pelo Firebase para cada host. Não inventar IP fixo: usar somente os valores emitidos pelo assistente do Firebase/Google Cloud.

Para `api.auroranexus.com.br`, apontar para Cloud Run/FastAPI ou para o endpoint oficial definido na camada de infraestrutura. O backend deve permanecer servidor-only.

### 5. Autenticação

Adicionar como domínios autorizados do Firebase Auth:

```text
auroranexus.com.br
app.auroranexus.com.br
wmgj.auroranexus.com.br
```

Manter `localhost` apenas para desenvolvimento local controlado.

### 6. Variáveis de ambiente públicas

Front-end:

```text
NEXT_PUBLIC_APP_NAME=AURORA NEXUS
NEXT_PUBLIC_CANONICAL_DOMAIN=https://app.auroranexus.com.br
NEXT_PUBLIC_PUBLIC_SITE=https://auroranexus.com.br
NEXT_PUBLIC_DEFAULT_ORG=wmgj
```

Backend/FastAPI:

```text
AURORA_ALLOWED_ORIGINS=https://app.auroranexus.com.br,https://wmgj.auroranexus.com.br
AURORA_PUBLIC_SITE=https://auroranexus.com.br
AURORA_DEFAULT_ORG=wmgj
```

### 7. Checklist antes do cutover

- DNS TXT validado no Firebase.
- SSL emitido para todos os hosts.
- Login testado em janela anônima.
- CORS restrito aos hosts Aurora Nexus.
- App Check revisado.
- Logs e trilha de auditoria funcionando.
- `orgId=wmgj` validado.
- Nenhum dado sensível exposto em landing pública.
- Fallback `wmgj-ops.web.app` documentado.
- Evidência arquivada no Drive institucional.

## Prompt operacional para Gemini/Firebase

```text
Atualizar o projeto AURORA NEXUS® | JFN-AUD-GOV-001 para operar com domínio próprio.

Domínio canônico: auroranexus.com.br.
Hosts prioritários: app.auroranexus.com.br, wmgj.auroranexus.com.br, api.auroranexus.com.br.
Manter fallback técnico: https://wmgj-ops.web.app/portal.
Separar totalmente o produto B2B AURORA NEXUS do domínio clínico drjoaodefreitas.com.br.
Não expor secrets no front-end, no repositório ou no DNS.
Exigir Firebase Auth, App Check quando aplicável, orgId=wmgj, trilha de auditoria e revisão humana para decisões críticas.
Gerar checklist de DNS, SSL, Auth domains, CORS, redirects, logs e rollback antes de qualquer cutover.
```

## Rollback

Em caso de erro de login, SSL, DNS, CORS, App Check ou rota operacional, manter o domínio Firebase atual como fallback e remover o domínio próprio do tráfego de produção até correção documentada.
