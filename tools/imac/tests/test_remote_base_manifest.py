import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "REMOTE_BASE_MANIFEST.json"

class RemoteBaseManifestTests(unittest.TestCase):
    def test_manifest_contract(self):
        data = json.loads(MANIFEST.read_text())
        self.assertEqual(data["id"], "AURORA-IMAC-REMOTE-BASE-001")
        self.assertEqual(data["target"]["hostname"], "iMac-de-Joao.local")
        self.assertEqual(data["controlPlane"]["provider"], "TRIGGERcmd")
        self.assertFalse(data["controlPlane"]["arbitraryShell"])
        self.assertEqual(data["auroraMirror"]["branch"], "main")
        self.assertEqual(data["auroraMirror"]["updatePolicy"], "fast-forward-only")
        self.assertFalse(data["auroraMirror"]["deployAllowed"])
        self.assertFalse(data["auroraMirror"]["firebaseWriteAllowed"])
        self.assertTrue(data["promotionGate"]["requiresHumanReview"])
        guards = set(data["guardrails"])
        for required in {
            "no-sudo",
            "no-arbitrary-shell",
            "no-production-deploy",
            "no-firebase-write-from-sync",
            "no-destructive-git-reset",
            "no-secret-output",
        }:
            self.assertIn(required, guards)

    def test_minimum_operational_commands_declared(self):
        data = json.loads(MANIFEST.read_text())
        commands = set(data["authorizedCommands"])
        for required in {
            "JFN Status Mac",
            "JFN Diagnostico",
            "JFN Rede",
            "JFN Reiniciar Agente",
            "AURORA NEXUS Status",
            "AURORA NEXUS Sincronizar",
        }:
            self.assertIn(required, commands)

if __name__ == "__main__":
    unittest.main()
