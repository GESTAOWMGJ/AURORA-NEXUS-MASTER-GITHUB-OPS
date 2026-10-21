"""Synthetic parser regressions; no portal, real claim or payment is exercised."""
import copy
from decimal import localcontext
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
import xml.etree.ElementTree as ET

from aurora_tiss import analyze_xml, TissError, MAX_XML_BYTES, NAMESPACE

FIXTURE = Path(__file__).parent / "fixtures/tiss/sp-sadt-4.03.00.synthetic.xml"
XML = FIXTURE.read_text(encoding="utf-8")
NS = "{" + NAMESPACE + "}"


def mutated(path, value=None, *, remove=False, duplicate=False):
    root = ET.fromstring(XML)
    pieces = path.split("/")
    parent = root
    for piece in pieces[:-1]:
        parent = parent.find(NS + piece)
    node = parent.find(NS + pieces[-1])
    if remove:
        parent.remove(node)
    elif duplicate:
        parent.append(copy.deepcopy(node))
    else:
        node.text = value
    return ET.tostring(root, encoding="unicode")


GUIDE = "prestadorParaOperadora/loteGuias/guiasTISS/guiaSP-SADT"
PROC = GUIDE + "/procedimentosExecutados/procedimentoExecutado"
EXPENSE = GUIDE + "/outrasDespesas/despesa"


class TissParserTests(unittest.TestCase):
    def analyze(self, xml=XML, org="synthetic-org"):
        return analyze_xml(xml, org_id=org)

    def rejected(self, xml, code):
        with self.assertRaises(TissError) as raised:
            self.analyze(xml)
        self.assertEqual(raised.exception.code, code)
        self.assertNotIn("CARTEIRA", str(raised.exception))

    def issue_codes(self, xml):
        return {issue["code"] for issue in self.analyze(xml)["validation"]["issues"]}

    def test_extracts_official_paths_and_keeps_money_exact(self):
        result = self.analyze()
        self.assertEqual(result["standardVersion"], "4.03.00")
        self.assertEqual(result["summary"], {"guideCount": 1, "procedureCount": 1, "otherExpenseCount": 1, "totalCents": 10700})
        guide = result["guides"][0]
        self.assertEqual(guide["providerGuideNumber"], "GUIA-SINTETICA-1")
        self.assertEqual(guide["operatorGuideNumber"], "OPERADORA-TESTE-1")
        self.assertEqual(guide["authorizationNumber"], "SENHA-GUIA-TESTE")
        self.assertEqual(guide["beneficiaryNumber"], "CARTEIRA-SINTETICA")
        self.assertEqual(guide["procedures"][0]["unitPrice"], "50.25")
        self.assertEqual(guide["totals"]["proceduresCents"], 10050)
        self.assertEqual(guide["totals"]["otherExpensesCents"], 650)
        self.assertEqual(result["validation"]["status"], "VALIDATED_LOCAL")
        self.assertFalse(result["validation"]["xsdValidated"])
        self.assertFalse(result["validation"]["catalogValidated"])
        self.assertFalse(result["validation"]["contractValidated"])
        self.assertEqual(result["validation"]["tissHashState"], "PRESENT_UNVERIFIED")
        self.assertEqual(result["receiptState"], "NOT_SUBMITTED")
        self.assertEqual(result["paymentState"], "NOT_VERIFIED")

    def test_hash_basis_is_utf8_text_and_org_scopes_duplicate_identity(self):
        first = self.analyze()
        second = self.analyze(org="another-org")
        self.assertEqual(first["sourceSha256"], hashlib.sha256(XML.encode("utf-8")).hexdigest())
        self.assertEqual(first["sourceSha256"], second["sourceSha256"])
        self.assertNotEqual(first["guides"][0]["duplicateKey"], second["guides"][0]["duplicateKey"])
        self.assertEqual(first, self.analyze())

    def test_arithmetic_is_independent_of_callers_decimal_context(self):
        baseline = self.analyze()
        with localcontext() as context:
            context.prec = 2
            self.assertEqual(self.analyze(), baseline)

    def test_namespace_prefix_is_not_hardcoded(self):
        self.assertEqual(self.analyze(XML.replace("ans:", "t:").replace("xmlns:ans", "xmlns:t"))["summary"]["totalCents"], 10700)
        default = XML.replace("ans:", "").replace("xmlns:ans", "xmlns")
        self.assertEqual(self.analyze(default)["summary"]["totalCents"], 10700)

    def test_dtd_entities_external_pi_xinclude_rejected(self):
        self.rejected(XML.replace("<ans:mensagemTISS", '<!DOCTYPE mensagemTISS [<!ENTITY secret SYSTEM "file:///etc/passwd">]><ans:mensagemTISS', 1), "XML_DTD_FORBIDDEN")
        self.rejected(XML.replace("<ans:cabecalho>", '<?xml-stylesheet href="https://invalid.example/"?><ans:cabecalho>', 1), "XML_PROCESSING_INSTRUCTION_FORBIDDEN")
        self.rejected(XML.replace("<ans:cabecalho>", '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd"/><ans:cabecalho>', 1), "XML_NAMESPACE_REJECTED")

    def test_size_depth_and_xml_wellformedness_are_bounded(self):
        self.rejected(" " * (MAX_XML_BYTES + 1), "XML_SIZE_LIMIT")
        deep = ('<a xmlns="' + NAMESPACE + '">') * 33 + "</a>" * 33
        self.rejected(deep, "XML_COMPLEXITY_LIMIT")
        self.rejected(XML[:-30], "XML_MALFORMED")

    def test_wrong_mixed_or_missing_namespace_rejected(self):
        self.rejected(XML.replace(NAMESPACE, "https://invalid.example/tiss"), "XML_NAMESPACE_REJECTED")
        self.rejected(XML.replace("<ans:numeroCarteira>", "<numeroCarteira>").replace("</ans:numeroCarteira>", "</numeroCarteira>"), "XML_NAMESPACE_REJECTED")

    def test_schema_location_hint_is_never_fetched(self):
        xml = XML.replace('<ans:mensagemTISS ', '<ans:mensagemTISS xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://invalid.example/file.xsd" ', 1)
        self.assertEqual(self.analyze(xml)["summary"]["guideCount"], 1)
        self.rejected(XML.replace("<ans:cabecalho>", '<ans:cabecalho xml:base="https://invalid.example/">'), "XML_ATTRIBUTES_UNSUPPORTED")

    def test_unknown_version_message_or_guide_type_rejected(self):
        self.rejected(mutated("cabecalho/Padrao", "4.02.00"), "TISS_VERSION_UNSUPPORTED")
        self.rejected(mutated("cabecalho/identificacaoTransacao/tipoTransacao", "RECEBIMENTO_LOTE"), "TISS_MESSAGE_UNSUPPORTED")
        self.rejected(XML.replace("guiaSP-SADT", "guiaConsulta"), "UNSUPPORTED_FIELD")

    def test_duplicate_fields_are_not_first_match_wins(self):
        self.rejected(mutated("cabecalho/Padrao", duplicate=True), "AMBIGUOUS_FIELD")
        self.rejected(mutated(GUIDE + "/dadosBeneficiario/numeroCarteira", duplicate=True), "AMBIGUOUS_FIELD")
        self.rejected(mutated(PROC + "/valorUnitario", duplicate=True), "AMBIGUOUS_FIELD")

    def test_unknown_and_old_beneficiary_fields_rejected(self):
        xml = XML.replace("</ans:dadosBeneficiario>", "<ans:nomeBeneficiario>SYNTHETIC</ans:nomeBeneficiario></ans:dadosBeneficiario>")
        self.rejected(xml, "UNSUPPORTED_FIELD")

    def test_missing_required_field_and_provider_choice_rejected(self):
        self.rejected(mutated(GUIDE + "/dadosBeneficiario/numeroCarteira", remove=True), "REQUIRED_FIELD_MISSING")
        xml = XML.replace("</ans:contratadoExecutante>", "<ans:cnpjContratado>00000000000000</ans:cnpjContratado></ans:contratadoExecutante>")
        self.rejected(xml, "PROVIDER_IDENTITY_CHOICE_REQUIRED")

    def test_alphanumeric_cnpj_supported_by_4_03_00(self):
        root = ET.fromstring(XML)
        node = root.find("/".join(NS + p for p in (GUIDE + "/dadosExecutante/contratadoExecutante/codigoPrestadorNaOperadora").split("/")))
        node.tag = NS + "cnpjContratado"
        node.text = "AB12CD34EF5600"
        self.assertEqual(self.analyze(ET.tostring(root, encoding="unicode"))["guides"][0]["providerCnpj"], "AB12CD34EF5600")
        node.text = "ab12CD34EF5600"
        self.rejected(ET.tostring(root, encoding="unicode"), "INVALID_PROVIDER_IDENTIFIER")

    def test_removed_attendance_and_unknown_table_codes_rejected(self):
        self.rejected(mutated(GUIDE + "/dadosAtendimento/tipoAtendimento", "05"), "INVALID_ENUM")
        self.rejected(mutated(PROC + "/procedimento/codigoTabela", "01"), "INVALID_ENUM")

    def test_embedded_portal_credentials_rejected_not_returned(self):
        xml = XML.replace("</ans:cabecalho>", "<ans:loginSenhaPrestador><ans:loginPrestador>SECRET-SYNTHETIC</ans:loginPrestador><ans:senhaPrestador>SECRET-SYNTHETIC</ans:senhaPrestador></ans:loginSenhaPrestador></ans:cabecalho>")
        self.rejected(xml, "XML_EMBEDDED_CREDENTIALS_REJECTED")

    def test_malformed_and_negative_numeric_fields_rejected(self):
        for value in ("-1.00", "1e3", "NaN", "50,25", "50.251"):
            with self.subTest(value=value):
                self.rejected(mutated(PROC + "/valorUnitario", value), "INVALID_DECIMAL")
        self.rejected(mutated(PROC + "/valorUnitario", "9999999999.99"), "DECIMAL_RANGE")
        self.rejected(mutated(PROC + "/quantidadeExecutada", "2.5"), "INVALID_FIELD")
        self.rejected(mutated(PROC + "/quantidadeExecutada", "0"), "QUANTITY_MUST_BE_POSITIVE")

    def test_guide_and_procedure_amount_mismatches_remain_review(self):
        xml = mutated(PROC + "/valorTotal", "100.51")
        result = self.analyze(xml)
        self.assertEqual(result["validation"]["status"], "REVIEW_REQUIRED")
        self.assertIn("LINE_TOTAL_MISMATCH", self.issue_codes(xml))
        self.assertIn("CATEGORY_TOTAL_MISMATCH", self.issue_codes(xml))
        self.assertEqual(result["guides"][0]["procedures"][0]["totalPrice"], "100.51")
        self.assertEqual(result["guides"][0]["totals"]["generalCents"], 10700)

    def test_declared_total_does_not_hide_unreconciled_expense_category(self):
        self.assertIn("CATEGORY_TOTAL_MISMATCH", self.issue_codes(mutated(GUIDE + "/valorTotal/valorMateriais", "7.50")))
        self.assertIn("CATEGORY_TOTAL_MISSING", self.issue_codes(mutated(GUIDE + "/valorTotal/valorMateriais", remove=True)))
        self.assertIn("GUIDE_TOTAL_MISMATCH", self.issue_codes(mutated(GUIDE + "/valorTotal/valorTotalGeral", "100.50")))

    def test_fractional_other_expenses_and_non_supported_category(self):
        xml = mutated(EXPENSE + "/servicosExecutados/quantidadeExecutada", "2.0001")
        self.assertEqual(self.analyze(xml)["guides"][0]["otherExpenses"][0]["quantity"], "2.0001")
        self.rejected(mutated(EXPENSE + "/codigoDespesa", "04"), "UNSUPPORTED_EXPENSE_CATEGORY")

    def test_duplicate_guide_item_and_wrong_operator_are_signaled(self):
        self.assertIn("DUPLICATE_GUIDE_IN_BATCH", self.issue_codes(mutated(GUIDE, duplicate=True)))
        self.assertIn("DUPLICATE_ITEM_SEQUENCE", self.issue_codes(mutated(EXPENSE + "/sequencialItem", "1")))
        self.assertIn("OPERATOR_MISMATCH", self.issue_codes(mutated(GUIDE + "/cabecalhoGuia/registroANS", "888888")))

    def test_invalid_dates_are_rejected_without_echo(self):
        self.rejected(mutated(PROC + "/dataExecucao", "2026-02-30"), "INVALID_DATE")
        self.rejected(mutated(PROC + "/dataExecucao", "21/10/2026"), "INVALID_FIELD")

    def test_empty_batch_and_more_than_100_guides_rejected(self):
        self.rejected(mutated(GUIDE, remove=True), "BATCH_GUIDE_LIMIT")
        root = ET.fromstring(XML)
        parent = root.find(NS + "prestadorParaOperadora").find(NS + "loteGuias").find(NS + "guiasTISS")
        original = parent[0]
        for _ in range(100):
            parent.append(copy.deepcopy(original))
        self.rejected(ET.tostring(root, encoding="unicode"), "BATCH_GUIDE_LIMIT")

    def test_no_items_remains_review_not_zero_revenue(self):
        root = ET.fromstring(XML)
        guide = root.find("/".join(NS + p for p in GUIDE.split("/")))
        guide.remove(guide.find(NS + "procedimentosExecutados"))
        guide.remove(guide.find(NS + "outrasDespesas"))
        result = self.analyze(ET.tostring(root, encoding="unicode"))
        self.assertEqual(result["validation"]["status"], "REVIEW_REQUIRED")
        self.assertIn("GUIDE_WITHOUT_EXECUTED_ITEMS", {i["code"] for i in result["validation"]["issues"]})
        self.assertEqual(result["summary"]["totalCents"], 10700)

    def test_zero_prices_are_preserved_for_contractual_review(self):
        xml = XML.replace("50.25", "0.00").replace("100.50", "0.00").replace("107.00", "6.50")
        result = self.analyze(xml)
        self.assertEqual(result["guides"][0]["procedures"][0]["totalCents"], 0)
        self.assertEqual(result["validation"]["status"], "VALIDATED_LOCAL")
        self.assertFalse(result["validation"]["contractValidated"])

    def test_organization_must_be_supplied_separately(self):
        for org in (None, "", "../../tenant", "Other_Org", 1):
            with self.subTest(org=org), self.assertRaises(TissError) as raised:
                self.analyze(org=org)
            self.assertEqual(raised.exception.code, "ORGANIZATION_REQUIRED")

    def test_cli_closed_schema_and_sanitized_errors(self):
        command = [sys.executable, str(Path(__file__).parent / "aurora_tiss.py")]
        result = subprocess.run(command, input=json.dumps({"xml": XML, "orgId": "synthetic-org"}), capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["summary"]["totalCents"], 10700)
        self.assertEqual(result.stderr, "")
        for request in ({"xml": XML, "orgId": "synthetic-org", "override": True}, {"xml": "PRIVATE-SOURCE-MARKER", "orgId": "synthetic-org"}):
            result = subprocess.run(command, input=json.dumps(request), capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn("PRIVATE-SOURCE-MARKER", result.stdout + result.stderr)
            self.assertIn("code", json.loads(result.stdout)["error"])
            self.assertEqual(result.stderr, "")
        result = subprocess.run(command, input='{"xml":"invalid","orgId":"synthetic-a","orgId":"synthetic-b"}', capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["error"]["code"], "AMBIGUOUS_JSON_FIELD")


if __name__ == "__main__":
    unittest.main()
