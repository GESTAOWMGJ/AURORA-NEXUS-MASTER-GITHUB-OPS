"""Bounded, in-memory SP-SADT extraction for the existing AURORA motor.

This performs local XSD/structural/arithmetic checks, not TUSS catalog or
contract adjudication, billing approval or proof of acceptance. Only
ENVIO_LOTE_GUIAS / 4.03.00 is supported. Only pinned packaged schemas are read;
no document filesystem I/O or network. The CLI accepts closed JSON on stdin.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal, ROUND_HALF_UP, localcontext
import hashlib
import json
from pathlib import Path
import stat
import re
import sys
import xml.etree.ElementTree as ET

VERSION = "1.0.1"
NAMESPACE = "http://www.ans.gov.br/padroes/tiss/schemas"
STANDARD_VERSION = "4.03.00"
MAX_XML_BYTES = 1024 * 1024
MAX_REQUEST_BYTES = 2 * MAX_XML_BYTES
MAX_NODES = 40000
MAX_DEPTH = 32
MAX_GUIDES = 100
MAX_ITEMS_PER_GUIDE = 1000
_NS = "{" + NAMESPACE + "}"
_XSI_SCHEMA_LOCATION = "{http://www.w3.org/2001/XMLSchema-instance}schemaLocation"
_EXPENSE_CATEGORIES = {
    "01": "valorGasesMedicinais", "02": "valorMedicamentos",
    "03": "valorMateriais", "05": "valorDiarias",
    "07": "valorTaxasAlugueis", "08": "valorOPME",
}


class TissError(ValueError):
    """Only fixed codes/structural paths; never include source field values."""

    def __init__(self, code: str, path: str = "xml"):
        self.code = code
        self.path = path
        super().__init__(code)


class _BoundedTree(ET.TreeBuilder):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.count = 0

    def start(self, tag, attrs):
        self.depth += 1
        self.count += 1
        if self.depth > MAX_DEPTH or self.count > MAX_NODES:
            raise TissError("XML_COMPLEXITY_LIMIT")
        if not tag.startswith(_NS):
            raise TissError("XML_NAMESPACE_REJECTED")
        # schemaLocation is an inert hint. It is never followed/downloaded.
        if any(key != _XSI_SCHEMA_LOCATION or self.depth != 1 for key in attrs):
            raise TissError("XML_ATTRIBUTES_UNSUPPORTED")
        return super().start(tag, attrs)

    def end(self, tag):
        value = super().end(tag)
        self.depth -= 1
        return value

    def doctype(self, *_):
        raise TissError("XML_DTD_FORBIDDEN")

    def pi(self, *_):
        raise TissError("XML_PROCESSING_INSTRUCTION_FORBIDDEN")


# Official ANS Communication 202511 ZIP, retrieved 2026-10-22. The complete
# transitive closure of tissV4_03_00.xsd is pinned here, not chosen by XML.
SCHEMA_HASHES = {
    "tissAssinaturaDigital_v1.01.xsd": "8567690a0eb05b9681fdc575ca7c867f75bf5cb33573175b8d333617ef035221",
    "tissComplexTypesV4_03_00.xsd": "83a24d606620cd3907c5cd574a71bf9c4411a2ec9e0510979f44293fe7c5956a",
    "tissGuiasV4_03_00.xsd": "587f0b6bac24175c50635ede52356cab00ff1ae28b550adc42e3a7f03cf605c7",
    "tissSimpleTypesV4_03_00.xsd": "d854debf58ac2d96194f72db95315ef2d102de57aeaf0388512f242824fdc794",
    "tissV4_03_00.xsd": "d4c421c7e3cf936551b70d6bd794a419867b6daea554d557b4d928363c54044c",
    "xmldsig-core-schema.xsd": "b6388292d746c6cc8f932ce3b6bf7c7fc0bf6cba58ec385b38988887bcf5fdbb"
}
SCHEMA_SET_SHA256 = hashlib.sha256(json.dumps(SCHEMA_HASHES, sort_keys=True,
    separators=(",", ":")).encode("ascii")).hexdigest()
_SCHEMA_DIR = Path(__file__).resolve().parent / "tiss-schemas" / STANDARD_VERSION


def _validate_xsd(root):
    """Validate the exact bounded extraction tree against the pinned ANS closure.

    Re-serialize as UTF-8 so a previously decoded ISO-8859-1 declaration cannot
    reinterpret Unicode field values. No defaults, recovery or document hints.
    Only fixed error codes escape libxml2 (its messages can contain PHI).
    """
    try:
        from lxml import etree as LX
    except ImportError:
        raise TissError("XSD_RUNTIME_UNAVAILABLE") from None
    schemas = {}
    try:
        # No symlink traversal or unbounded reads, including parent directories.
        for directory in (_SCHEMA_DIR, _SCHEMA_DIR.parent):
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError()
        for name, expected in SCHEMA_HASHES.items():
            source = _SCHEMA_DIR / name
            if not stat.S_ISREG(source.lstat().st_mode) or source.stat().st_size > 256 * 1024:
                raise ValueError()
            with source.open("rb") as stream:
                data = stream.read(256 * 1024 + 1)
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError()
            schemas[name] = data
    except (OSError, ValueError):
        raise TissError("XSD_SCHEMA_INTEGRITY_FAILED") from None

    class PinnedResolver(LX.Resolver):
        def resolve(self, url, public_id, context):
            # Never return None: that would permit libxml2's default loader.
            if url not in schemas:
                raise OSError("XSD_RESOURCE_REJECTED")
            return self.resolve_string(schemas[url], context, base_url=url)

    parser = LX.XMLParser(resolve_entities=False, load_dtd=False, no_network=True,
                          huge_tree=False, recover=False, attribute_defaults=False)
    parser.resolvers.add(PinnedResolver())
    try:
        schema = LX.XMLSchema(LX.fromstring(schemas["tissV4_03_00.xsd"], parser,
                                           base_url="tissV4_03_00.xsd"))
    except (LX.LxmlError, OSError, ValueError):
        raise TissError("XSD_SCHEMA_COMPILE_FAILED") from None
    try:
        document = LX.fromstring(ET.tostring(root, encoding="utf-8"), parser)
        valid = schema.validate(document)
    except (LX.LxmlError, OSError, ValueError):
        raise TissError("XSD_DOCUMENT_INVALID") from None
    if not valid:
        raise TissError("XSD_DOCUMENT_INVALID")
    return {"state": "VALIDATED", "standardVersion": STANDARD_VERSION,
            "entrypoint": "tissV4_03_00.xsd", "schemaSetSha256": SCHEMA_SET_SHA256,
            "source": "ANS_COMMUNICATION_202511", "engine": "lxml.etree.XMLSchema",
            "engineVersion": ".".join(map(str, LX.LXML_VERSION[:3]))}


def _one(parent, name, path, *, required=True):
    found = parent.findall(_NS + name) if parent is not None else []
    if len(found) > 1:
        raise TissError("AMBIGUOUS_FIELD", path)
    if not found:
        if required:
            raise TissError("REQUIRED_FIELD_MISSING", path)
        return None
    return found[0]


def _children(parent, allowed, path):
    if parent is None:
        return
    if parent.text and parent.text.strip():
        raise TissError("UNEXPECTED_CONTAINER_TEXT", path)
    for child in parent:
        if child.tag not in {_NS + name for name in allowed}:
            raise TissError("UNSUPPORTED_FIELD", path)
        if child.tail and child.tail.strip():
            raise TissError("UNEXPECTED_CONTAINER_TEXT", path)


def _text(parent, name, path, *, required=True, limit=150, pattern=None):
    node = _one(parent, name, path, required=required)
    if node is None:
        return None
    if len(node):
        raise TissError("SCALAR_FIELD_REQUIRED", path)
    value = (node.text or "").strip()
    if not value or len(value) > limit or any(ord(c) < 32 for c in value):
        raise TissError("INVALID_FIELD", path)
    if pattern is not None and re.fullmatch(pattern, value, re.ASCII) is None:
        raise TissError("INVALID_FIELD", path)
    return value


def _date(parent, name, path, *, required=True):
    value = _text(parent, name, path, required=required, limit=10,
                  pattern=r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
    if value is not None:
        try:
            dt.date.fromisoformat(value)
        except ValueError:
            raise TissError("INVALID_DATE", path) from None
    return value


def _enum(parent, name, path, allowed, *, required=True):
    value = _text(parent, name, path, required=required, limit=20)
    if value is not None and value not in allowed:
        raise TissError("INVALID_ENUM", path)
    return value


def _decimal(parent, name, path, *, places=2, digits=10, required=True, positive=False):
    value = _text(parent, name, path, required=required, limit=30)
    if value is None:
        return None
    if re.fullmatch(r"[0-9]+(?:\.[0-9]{1," + str(places) + r"})?", value, re.ASCII) is None:
        raise TissError("INVALID_DECIMAL", path)
    result = Decimal(value)
    with localcontext() as context:
        context.prec = 40
        normalized = result.normalize().as_tuple()
    significant = len(normalized.digits) + max(normalized.exponent, 0)
    if significant > digits or (positive and result <= 0):
        raise TissError("DECIMAL_RANGE", path)
    return result


def _cents(value):
    with localcontext() as context:
        context.prec = 40
        return None if value is None else int(value * 100)


def _provider(parent, path):
    fields = {"codigoPrestadorNaOperadora": 14, "cnpjContratado": 14, "cpfContratado": 11}
    _children(parent, fields, path)
    values = {name: _text(parent, name, path + "/" + name, required=False, limit=length)
              for name, length in fields.items()}
    if sum(value is not None for value in values.values()) != 1:
        raise TissError("PROVIDER_IDENTITY_CHOICE_REQUIRED", path)
    for name, pattern in (("cnpjContratado", r"[A-Z0-9]{12}[0-9]{2}"), ("cpfContratado", r"[0-9]{11}")):
        if values[name] is not None and re.fullmatch(pattern, values[name], re.ASCII) is None:
            raise TissError("INVALID_PROVIDER_IDENTIFIER", path)
    return {"providerCode": values["codigoPrestadorNaOperadora"],
            "providerCnpj": values["cnpjContratado"], "providerCpf": values["cpfContratado"]}


def _issue(issues, code, path, severity="ERROR"):
    issues.append({"code": code, "path": path, "severity": severity})


def _procedure(node, path, issues, *, expense=False, sequence=None):
    if expense:
        _children(node, {"dataExecucao", "horaInicial", "horaFinal", "codigoTabela", "codigoProcedimento",
                        "quantidadeExecutada", "unidadeMedida", "reducaoAcrescimo", "valorUnitario",
                        "valorTotal", "centroConsumo", "descricaoProcedimento", "registroANVISA",
                        "codigoRefFabricante", "autorizacaoFuncionamento"}, path)
        details = node
        quantity = _decimal(node, "quantidadeExecutada", path + "/quantidadeExecutada", places=4, digits=9, positive=True)
        unit = _text(node, "unidadeMedida", path + "/unidadeMedida", limit=3, pattern=r"[0-9]{3}")
    else:
        _children(node, {"sequencialItem", "dataExecucao", "horaInicial", "horaFinal", "procedimento",
                        "quantidadeExecutada", "viaAcesso", "tecnicaUtilizada", "reducaoAcrescimo",
                        "valorUnitario", "valorTotal", "equipeSadt"}, path)
        sequence = _text(node, "sequencialItem", path + "/sequencialItem", limit=4, pattern=r"[0-9]{1,4}")
        quantity = Decimal(_text(node, "quantidadeExecutada", path + "/quantidadeExecutada", limit=3, pattern=r"[0-9]{1,3}"))
        if quantity <= 0:
            raise TissError("QUANTITY_MUST_BE_POSITIVE", path + "/quantidadeExecutada")
        details = _one(node, "procedimento", path + "/procedimento")
        _children(details, {"codigoTabela", "codigoProcedimento", "descricaoProcedimento"}, path + "/procedimento")
        unit = None
    if int(sequence) == 0:
        raise TissError("SEQUENCE_MUST_BE_POSITIVE", path + "/sequencialItem")
    table = _enum(details, "codigoTabela", path + "/codigoTabela", {"18", "19", "20", "22", "90", "98", "00"})
    code = _text(details, "codigoProcedimento", path + "/codigoProcedimento", limit=10)
    if table == "22" and re.fullmatch(r"[0-9]{8}", code) is None:
        _issue(issues, "TUSS_PROCEDURE_CODE_FORMAT", path + "/codigoProcedimento")
    unit_price = _decimal(node, "valorUnitario", path + "/valorUnitario")
    total = _decimal(node, "valorTotal", path + "/valorTotal")
    factor = _decimal(node, "reducaoAcrescimo", path + "/reducaoAcrescimo", digits=3)
    # No corrective rewrite. A multiplicative arithmetic comparison is only a
    # local signal; contract terms, rounding rules and authorization stay pending.
    with localcontext() as context:
        context.prec = 40
        expected = (quantity * unit_price * factor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if expected != total:
        _issue(issues, "LINE_TOTAL_MISMATCH", path + "/valorTotal")
    return {"sequence": str(int(sequence)), "executionDate": _date(node, "dataExecucao", path + "/dataExecucao"),
            "tableCode": table, "procedureCode": code,
            "description": _text(details, "descricaoProcedimento", path + "/descricaoProcedimento", limit=150),
            "quantity": format(quantity, "f"), "unit": unit, "adjustmentFactor": format(factor, "f"),
            "unitPrice": format(unit_price, ".2f"), "totalPrice": format(total, ".2f"),
            "totalCents": _cents(total), "calculatedTotalCents": _cents(expected)}


def _guide(node, index, org_id, operator, issues):
    path = "guides[" + str(index) + "]"
    _children(node, {"cabecalhoGuia", "dadosAutorizacao", "dadosBeneficiario", "dadosSolicitante",
                    "dadosSolicitacao", "dadosExecutante", "dadosAtendimento", "procedimentosExecutados",
                    "outrasDespesas", "observacao", "valorTotal", "assinaturaDigitalGuia"}, path)
    header = _one(node, "cabecalhoGuia", path + "/cabecalhoGuia")
    _children(header, {"registroANS", "numeroGuiaPrestador", "guiaPrincipal"}, path + "/cabecalhoGuia")
    guide_operator = _text(header, "registroANS", path + "/registroANS", limit=6, pattern=r"[0-9]{6}")
    if guide_operator != operator:
        _issue(issues, "OPERATOR_MISMATCH", path + "/registroANS")
    number = _text(header, "numeroGuiaPrestador", path + "/numeroGuiaPrestador", limit=20)
    authorization = _one(node, "dadosAutorizacao", path + "/dadosAutorizacao", required=False)
    if authorization is not None:
        _children(authorization, {"numeroGuiaOperadora", "dataAutorizacao", "senha", "dataValidadeSenha",
                                  "ausenciaCodValidacao", "codValidacao"}, path + "/dadosAutorizacao")
        _date(authorization, "dataAutorizacao", path + "/dataAutorizacao")
    beneficiary = _one(node, "dadosBeneficiario", path + "/dadosBeneficiario")
    _children(beneficiary, {"numeroCarteira", "atendimentoRN", "tipoIdent", "identificadorBeneficiario"}, path + "/dadosBeneficiario")
    beneficiary_number = _text(beneficiary, "numeroCarteira", path + "/numeroCarteira", limit=20)
    newborn = _text(beneficiary, "atendimentoRN", path + "/atendimentoRN", limit=1, pattern=r"[SN]")
    requester = _one(node, "dadosSolicitante", path + "/dadosSolicitante")
    _children(requester, {"contratadoSolicitante", "nomeContratadoSolicitante", "profissionalSolicitante"}, path + "/dadosSolicitante")
    _provider(_one(requester, "contratadoSolicitante", path + "/contratadoSolicitante"), path + "/contratadoSolicitante")
    _text(requester, "nomeContratadoSolicitante", path + "/nomeContratadoSolicitante", limit=70)
    professional = _one(requester, "profissionalSolicitante", path + "/profissionalSolicitante")
    _children(professional, {"nomeProfissional", "conselhoProfissional", "numeroConselhoProfissional", "UF", "CBOS"}, path + "/profissionalSolicitante")
    for name, limit in (("conselhoProfissional", 2), ("numeroConselhoProfissional", 15), ("UF", 2), ("CBOS", 6)):
        _text(professional, name, path + "/profissionalSolicitante/" + name, limit=limit)
    request = _one(node, "dadosSolicitacao", path + "/dadosSolicitacao")
    _children(request, {"dataSolicitacao", "caraterAtendimento", "indicacaoClinica", "indCobEspecial"}, path + "/dadosSolicitacao")
    _text(request, "caraterAtendimento", path + "/caraterAtendimento", limit=1, pattern=r"[12]")
    execution = _one(node, "dadosExecutante", path + "/dadosExecutante")
    _children(execution, {"contratadoExecutante", "CNES"}, path + "/dadosExecutante")
    provider = _provider(_one(execution, "contratadoExecutante", path + "/contratadoExecutante"), path + "/contratadoExecutante")
    cnes = _text(execution, "CNES", path + "/CNES", limit=7, pattern=r"[0-9]{7}")
    attendance = _one(node, "dadosAtendimento", path + "/dadosAtendimento")
    _children(attendance, {"tipoAtendimento", "indicacaoAcidente", "tipoConsulta", "motivoEncerramento", "regimeAtendimento", "saudeOcupacional"}, path + "/dadosAtendimento")
    for name, allowed in (("tipoAtendimento", {"01", "02", "03", "04", "08", "09", "10", "13", "23"}),
                          ("indicacaoAcidente", {"0", "1", "2", "9"}),
                          ("regimeAtendimento", {"01", "02", "03", "04", "05"})):
        _enum(attendance, name, path + "/dadosAtendimento/" + name, allowed)
    procedure_parent = _one(node, "procedimentosExecutados", path + "/procedimentosExecutados", required=False)
    expense_parent = _one(node, "outrasDespesas", path + "/outrasDespesas", required=False)
    _children(procedure_parent, {"procedimentoExecutado"}, path + "/procedimentosExecutados")
    _children(expense_parent, {"despesa"}, path + "/outrasDespesas")
    procedure_nodes = list(procedure_parent) if procedure_parent is not None else []
    expense_nodes = list(expense_parent) if expense_parent is not None else []
    if len(procedure_nodes) + len(expense_nodes) > MAX_ITEMS_PER_GUIDE:
        raise TissError("GUIDE_ITEM_LIMIT", path)
    if not procedure_nodes and not expense_nodes:
        _issue(issues, "GUIDE_WITHOUT_EXECUTED_ITEMS", path)
    procedures = [_procedure(item, path + "/procedures[" + str(i) + "]", issues) for i, item in enumerate(procedure_nodes)]
    expenses = []
    for i, item in enumerate(expense_nodes):
        expense_path = path + "/expenses[" + str(i) + "]"
        _children(item, {"sequencialItem", "codigoDespesa", "servicosExecutados", "itemVinculado"}, expense_path)
        sequence = _text(item, "sequencialItem", expense_path + "/sequencialItem", limit=4, pattern=r"[0-9]{1,4}")
        category = _text(item, "codigoDespesa", expense_path + "/codigoDespesa", limit=2)
        if category not in _EXPENSE_CATEGORIES:
            raise TissError("UNSUPPORTED_EXPENSE_CATEGORY", expense_path + "/codigoDespesa")
        service = _one(item, "servicosExecutados", expense_path + "/servicosExecutados")
        parsed = _procedure(service, expense_path + "/servicosExecutados", issues, expense=True, sequence=sequence)
        expenses.append({**parsed, "expenseCode": category})
    sequences = [item["sequence"] for item in procedures + expenses]
    if len(sequences) != len(set(sequences)):
        _issue(issues, "DUPLICATE_ITEM_SEQUENCE", path)
    totals_node = _one(node, "valorTotal", path + "/valorTotal")
    total_names = ["valorProcedimentos", *_EXPENSE_CATEGORIES.values()]
    _children(totals_node, {*total_names, "valorTotalGeral"}, path + "/valorTotal")
    declared = {name: _cents(_decimal(totals_node, name, path + "/valorTotal/" + name, required=False)) for name in total_names}
    general = _cents(_decimal(totals_node, "valorTotalGeral", path + "/valorTotal/valorTotalGeral"))
    computed = {name: 0 for name in total_names}
    computed["valorProcedimentos"] = sum(item["totalCents"] for item in procedures)
    for item in expenses:
        computed[_EXPENSE_CATEGORIES[item["expenseCode"]]] += item["totalCents"]
    for name in total_names:
        if declared[name] is None and computed[name] != 0:
            _issue(issues, "CATEGORY_TOTAL_MISSING", path + "/valorTotal/" + name)
        elif declared[name] is not None and declared[name] != computed[name]:
            _issue(issues, "CATEGORY_TOTAL_MISMATCH", path + "/valorTotal/" + name)
    if sum(computed.values()) != general:
        _issue(issues, "GUIDE_TOTAL_MISMATCH", path + "/valorTotal/valorTotalGeral")
    if sum(value for value in declared.values() if value is not None) != general:
        _issue(issues, "DECLARED_TOTAL_MISMATCH", path + "/valorTotal/valorTotalGeral")
    if _one(node, "assinaturaDigitalGuia", path + "/assinaturaDigitalGuia", required=False) is not None:
        _issue(issues, "DIGITAL_SIGNATURE_UNVERIFIED", path + "/assinaturaDigitalGuia", "WARNING")
    duplicate_key = hashlib.sha256(json.dumps([org_id, operator, provider, number], sort_keys=True,
                                             separators=(",", ":")).encode("utf-8")).hexdigest()
    dates = sorted({item["executionDate"] for item in procedures + expenses})
    return {"providerGuideNumber": number,
            "operatorGuideNumber": _text(authorization, "numeroGuiaOperadora", path + "/numeroGuiaOperadora", required=False, limit=20),
            "authorizationNumber": _text(authorization, "senha", path + "/senha", required=False, limit=20),
            "beneficiaryNumber": beneficiary_number, "newbornCare": newborn, **provider, "providerCnes": cnes,
            "requestDate": _date(request, "dataSolicitacao", path + "/dataSolicitacao", required=False),
            "executionDate": dates[0] if len(dates) == 1 else None, "executionDates": dates,
            "procedures": procedures, "otherExpenses": expenses, "duplicateKey": duplicate_key,
            "totals": {"proceduresCents": declared["valorProcedimentos"],
                       "otherExpensesCents": sum(item["totalCents"] for item in expenses),
                       "generalCents": general, "declaredCategoriesCents": declared,
                       "calculatedCategoriesCents": computed}}


def analyze_xml(xml: str, *, org_id: str) -> dict:
    """Extract a supported batch under an already-authenticated organization.

    org_id scopes identifiers; this pure parser does not authenticate callers or
    grant rights. The host motor must supply org_id from its session, not XML.
    """
    if not isinstance(org_id, str) or re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", org_id) is None:
        raise TissError("ORGANIZATION_REQUIRED", "orgId")
    if not isinstance(xml, str) or not xml:
        raise TissError("XML_REQUIRED")
    try:
        encoded = xml.encode("utf-8")
    except UnicodeEncodeError:
        raise TissError("INVALID_XML_ENCODING") from None
    if len(encoded) > MAX_XML_BYTES:
        raise TissError("XML_SIZE_LIMIT")
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", xml, re.IGNORECASE):
        raise TissError("XML_DTD_FORBIDDEN")
    try:
        root = ET.fromstring(xml, parser=ET.XMLParser(target=_BoundedTree()))
    except (ET.ParseError, LookupError, ValueError) as error:
        if isinstance(error, TissError):
            raise
        raise TissError("XML_MALFORMED") from None
    if root.tag != _NS + "mensagemTISS":
        raise TissError("XML_ROOT_UNSUPPORTED")
    _children(root, {"cabecalho", "prestadorParaOperadora", "epilogo"}, "mensagemTISS")
    header = _one(root, "cabecalho", "cabecalho")
    _children(header, {"identificacaoTransacao", "falhaNegocio", "origem", "destino", "Padrao", "loginSenhaPrestador"}, "cabecalho")
    if _one(header, "loginSenhaPrestador", "cabecalho/loginSenhaPrestador", required=False) is not None:
        # Billing XML may contain a provider password. It must not enter this tool.
        raise TissError("XML_EMBEDDED_CREDENTIALS_REJECTED", "cabecalho/loginSenhaPrestador")
    version = _text(header, "Padrao", "cabecalho/Padrao", limit=8)
    if version != STANDARD_VERSION:
        raise TissError("TISS_VERSION_UNSUPPORTED", "cabecalho/Padrao")
    transaction = _one(header, "identificacaoTransacao", "cabecalho/identificacaoTransacao")
    _children(transaction, {"tipoTransacao", "sequencialTransacao", "dataRegistroTransacao", "horaRegistroTransacao"}, "cabecalho/identificacaoTransacao")
    message_type = _text(transaction, "tipoTransacao", "cabecalho/tipoTransacao", limit=40)
    if message_type != "ENVIO_LOTE_GUIAS":
        raise TissError("TISS_MESSAGE_UNSUPPORTED", "cabecalho/tipoTransacao")
    transaction_id = _text(transaction, "sequencialTransacao", "cabecalho/sequencialTransacao", limit=12)
    _date(transaction, "dataRegistroTransacao", "cabecalho/dataRegistroTransacao")
    _text(transaction, "horaRegistroTransacao", "cabecalho/horaRegistroTransacao", limit=8,
          pattern=r"(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]")
    origin = _one(header, "origem", "cabecalho/origem")
    _children(origin, {"identificacaoPrestador"}, "cabecalho/origem")
    _provider(_one(origin, "identificacaoPrestador", "cabecalho/origem/identificacaoPrestador"), "cabecalho/origem/identificacaoPrestador")
    destination = _one(header, "destino", "cabecalho/destino")
    _children(destination, {"registroANS"}, "cabecalho/destino")
    operator = _text(destination, "registroANS", "cabecalho/destino/registroANS", limit=6, pattern=r"[0-9]{6}")
    direction = _one(root, "prestadorParaOperadora", "prestadorParaOperadora")
    _children(direction, {"loteGuias"}, "prestadorParaOperadora")
    batch = _one(direction, "loteGuias", "loteGuias")
    _children(batch, {"numeroLote", "guiasTISS"}, "loteGuias")
    batch_number = _text(batch, "numeroLote", "loteGuias/numeroLote", limit=12)
    guide_parent = _one(batch, "guiasTISS", "loteGuias/guiasTISS")
    _children(guide_parent, {"guiaSP-SADT"}, "loteGuias/guiasTISS")
    if not 1 <= len(guide_parent) <= MAX_GUIDES:
        raise TissError("BATCH_GUIDE_LIMIT", "loteGuias/guiasTISS")
    epilogue = _one(root, "epilogo", "epilogo")
    _children(epilogue, {"hash"}, "epilogo")
    _text(epilogue, "hash", "epilogo/hash", limit=32, pattern=r"[a-fA-F0-9]{32}")
    issues = []
    guides = [_guide(node, i, org_id, operator, issues) for i, node in enumerate(guide_parent)]
    keys = [guide["duplicateKey"] for guide in guides]
    if len(keys) != len(set(keys)):
        _issue(issues, "DUPLICATE_GUIDE_IN_BATCH", "guides")
    xsd = _validate_xsd(root)
    for code in ("TUSS_CATALOG_VALIDATION_PENDING", "CONTRACT_VALIDATION_PENDING", "TISS_HASH_UNVERIFIED"):
        _issue(issues, code, "batch", "INFO")
    return {"schemaVersion": "aurora.tiss.analysis.v1", "version": VERSION, "orgId": org_id,
            "sourceSha256": hashlib.sha256(encoded).hexdigest(), "sourceHashBasis": "UTF8_XML_TEXT",
            "standardVersion": version, "messageType": message_type, "transactionId": transaction_id,
            "batchNumber": batch_number, "operatorRegistration": operator, "guides": guides,
            "validation": {"status": "REVIEW_REQUIRED" if any(issue["severity"] in ("ERROR", "WARNING") for issue in issues) else "VALIDATED_LOCAL",
                           "xsdValidated": True, "xsd": xsd,
                           "catalogValidated": False, "contractValidated": False,
                           "billingApproved": False,
                           "tissHashState": "PRESENT_UNVERIFIED", "issues": issues},
            "summary": {"guideCount": len(guides), "procedureCount": sum(len(guide["procedures"]) for guide in guides),
                        "otherExpenseCount": sum(len(guide["otherExpenses"]) for guide in guides),
                        "totalCents": sum(guide["totals"]["generalCents"] for guide in guides)},
            "receiptState": "NOT_SUBMITTED", "paymentState": "NOT_VERIFIED"}


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise TissError("AMBIGUOUS_JSON_FIELD", "request")
        result[key] = value
    return result


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise TissError("REQUEST_SIZE_LIMIT")
        request = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_json_object)
        if not isinstance(request, dict) or set(request) != {"xml", "orgId"}:
            raise TissError("INVALID_REQUEST")
        result = analyze_xml(request["xml"], org_id=request["orgId"])
    except TissError as error:
        print(json.dumps({"error": {"code": error.code, "path": error.path}}, separators=(",", ":")))
        return 2
    except (UnicodeError, json.JSONDecodeError, TypeError, RecursionError):
        print('{"error":{"code":"INVALID_REQUEST","path":"request"}}')
        return 2
    except Exception:
        # Do not expose parser internals, source bytes or identifiers on stderr.
        print('{"error":{"code":"TISS_ANALYSIS_FAILED","path":"request"}}')
        return 1
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
