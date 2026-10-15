//go:build aurora_windows_setup

package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const fixtureSource = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func archiveFor(changes map[string][]byte, duplicate string) []byte {
	files := map[string][]byte{"INSTALAR-AURORA-NEXUS.cmd": []byte("fixture launcher"), "LEIA-PRIMEIRO.txt": []byte("fixture readme")}
	for _, n := range required {
		files[n] = []byte("synthetic dependency " + n)
	}
	manifest := bundleManifest{SchemaVersion: 1, ClientVersion: version, SourceCommit: fixtureSource, Environment: "HML", Files: map[string]string{}}
	for n, content := range files {
		sum := sha256.Sum256(content)
		manifest.Files[n] = hex.EncodeToString(sum[:])
	}
	files["manifest.json"], _ = json.Marshal(manifest)
	for n, content := range changes {
		if content == nil {
			delete(files, n)
		} else {
			files[n] = content
		}
	}
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for n, content := range files {
		w, _ := z.Create(n)
		w.Write(content)
	}
	if duplicate != "" {
		w, _ := z.Create(duplicate)
		w.Write([]byte("duplicate"))
	}
	z.Close()
	return b.Bytes()
}
func TestCompletePayload(t *testing.T) {
	root := t.TempDir()
	if len(required) != 8 {
		t.Fatal("dependency closure changed")
	}
	if err := extract(archiveFor(nil, ""), root, fixtureSource); err != nil {
		t.Fatal(err)
	}
	for _, name := range append(append([]string{}, required...), "manifest.json") {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(name))); err != nil {
			t.Fatal(err)
		}
	}
}
func TestMissingDuplicateAndChangedFiles(t *testing.T) {
	for _, data := range [][]byte{archiveFor(map[string][]byte{required[4]: nil}, ""), archiveFor(nil, required[0]), archiveFor(map[string][]byte{required[4]: []byte("changed")}, "")} {
		root := t.TempDir()
		if extract(data, root, fixtureSource) == nil {
			t.Fatal("invalid payload accepted")
		}
		entries, _ := os.ReadDir(root)
		if len(entries) != 0 {
			t.Fatal("wrote before complete validation")
		}
	}
}
func TestNeverOverwrite(t *testing.T) {
	root := t.TempDir()
	data := archiveFor(nil, "")
	if err := extract(data, root, fixtureSource); err != nil {
		t.Fatal(err)
	}
	if extract(data, root, fixtureSource) == nil {
		t.Fatal("overwrite accepted")
	}
}
func TestTraversalAndWrongSourceAreRejected(t *testing.T) {
	for _, test := range []struct {
		data   []byte
		source string
	}{{archiveFor(map[string][]byte{"../outside": []byte("synthetic")}, ""), fixtureSource}, {archiveFor(nil, ""), "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}, {archiveFor(nil, ""), "unversioned"}} {
		root := t.TempDir()
		if extract(test.data, root, test.source) == nil {
			t.Fatal("unbound package accepted")
		}
		entries, _ := os.ReadDir(root)
		if len(entries) != 0 {
			t.Fatal("wrote before source verification")
		}
	}
}
func TestInstallationRequiresExplicitIntegrationConfiguration(t *testing.T) {
	for _, args := range [][]string{nil, {"--integration-method", "CLOUD_OAUTH"}, {"--integration-method", "LOCAL_AGENT"}, {"--token", "forbidden"}, {"--integration-input", "approved.json"}, {"--integration-method", "API_TOKEN", "--integration-method", "MANUAL"}} {
		if _, err := installerArguments(args); err == nil {
			t.Fatal("unconfigured installation accepted")
		}
	}
}
func TestSourceAdapterAndCanonicalConfigurationRemainDistinct(t *testing.T) {
	for _, args := range [][]string{{"--integration-method", "LOCAL_AGENT", "--integration-agent-target", "existing-agent"}, {"--integration-input", "approved.json", "--integration-org", "synthetic-org", "--integration-origin", "https://auroranexus.com.br"}} {
		result, err := installerArguments(args)
		if err != nil || len(result) != len(args) {
			t.Fatal("nonsecret configuration rejected")
		}
	}
}
