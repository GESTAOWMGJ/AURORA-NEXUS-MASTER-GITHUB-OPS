//go:build aurora_windows_setup

package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

//go:embed payload.zip
var payload []byte
var sourceCommit = "unversioned"

const version = "0.2.0-beta.4"
const portal = "https://auroranexus.com.br/portal"

var required = []string{"desktop/install_windows_beta.py", "aurora-coletor/aurora_deployment.py", "aurora-coletor/aurora_cloud_sync.py", "aurora-coletor/client_agent.py", "aurora-coletor/provider_connectors.py", "aurora-coletor/client_secret_store.py", "aurora-coletor/install_client_agent.py", "aurora-coletor/published_release.py"}

type bundleManifest struct {
	SchemaVersion              int               `json:"schemaVersion"`
	ClientVersion              string            `json:"clientVersion"`
	SourceCommit               string            `json:"sourceCommit"`
	Environment                string            `json:"environment"`
	ProductionReleased         bool              `json:"productionReleased"`
	DeviceInstallationVerified bool              `json:"deviceInstallationVerified"`
	Files                      map[string]string `json:"files"`
}

func extract(data []byte, root, expectedSource string) error {
	if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(expectedSource) {
		return errors.New("exact package source required")
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	allowed := map[string]bool{"manifest.json": true, "INSTALAR-AURORA-NEXUS.cmd": true, "LEIA-PRIMEIRO.txt": true}
	for _, name := range required {
		allowed[name] = true
	}
	if len(archive.File) != len(allowed) {
		return errors.New("incomplete payload")
	}
	contents := map[string][]byte{}
	for _, f := range archive.File {
		if !allowed[f.Name] || contents[f.Name] != nil || !f.Mode().IsRegular() || f.UncompressedSize64 > 1024*1024 {
			return errors.New("invalid payload")
		}
		reader, e := f.Open()
		if e != nil {
			return e
		}
		content, e := io.ReadAll(io.LimitReader(reader, 1024*1024+1))
		reader.Close()
		if e != nil || len(content) > 1024*1024 {
			return errors.New("invalid payload size")
		}
		contents[f.Name] = content
	}
	var manifest bundleManifest
	decoder := json.NewDecoder(bytes.NewReader(contents["manifest.json"]))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&manifest) != nil || manifest.SchemaVersion != 1 || manifest.ClientVersion != version || manifest.SourceCommit != expectedSource || manifest.Environment != "HML" || manifest.ProductionReleased || manifest.DeviceInstallationVerified || len(manifest.Files) != len(allowed)-1 {
		return errors.New("package identity mismatch")
	}
	for name, content := range contents {
		if name == "manifest.json" {
			continue
		}
		sum := sha256.Sum256(content)
		if manifest.Files[name] != hex.EncodeToString(sum[:]) {
			return errors.New("package hash mismatch")
		}
	}
	// Check the whole dependency closure before creating any extracted file.
	for name := range contents {
		if _, e := os.Lstat(filepath.Join(root, filepath.FromSlash(name))); !os.IsNotExist(e) {
			return errors.New("existing payload path")
		}
	}
	for name, content := range contents {
		target := filepath.Join(root, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		out, e := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return e
		}
		_, e = out.Write(content)
		closeErr := out.Close()
		if e != nil {
			return e
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func installerArguments(values []string) ([]string, error) {
	allowed := map[string]bool{"--integration-input": true, "--integration-org": true, "--integration-origin": true, "--integration-method": true, "--integration-agent-target": true}
	seen := map[string]string{}
	if len(values)%2 != 0 {
		return nil, errors.New("explicit integration configuration required")
	}
	for i := 0; i < len(values); i += 2 {
		if !allowed[values[i]] || seen[values[i]] != "" || values[i+1] == "" {
			return nil, errors.New("explicit integration configuration required")
		}
		seen[values[i]] = values[i+1]
	}
	method := seen["--integration-method"]
	if method == "" {
		method = "API_TOKEN"
	}
	switch method {
	case "API_TOKEN", "MANUAL":
		if seen["--integration-input"] == "" || seen["--integration-org"] == "" || seen["--integration-origin"] == "" {
			return nil, errors.New("authenticated automation integration required")
		}
	case "CLOUD_OAUTH", "LOCAL_AGENT":
		if seen["--integration-agent-target"] == "" {
			return nil, errors.New("existing authorized source agent required")
		}
	default:
		return nil, errors.New("unknown integration method")
	}
	return append([]string{}, values...), nil
}

func findPython() (string, []string, error) {
	for _, candidate := range []struct {
		name string
		args []string
	}{{"py", []string{"-3"}}, {"python", nil}} {
		path, err := exec.LookPath(candidate.name)
		if err != nil {
			continue
		}
		args := append(append([]string{}, candidate.args...), "-B", "-c", "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)")
		if exec.Command(path, args...).Run() == nil {
			return path, candidate.args, nil
		}
	}
	return "", nil, errors.New("Python 3.10+ required")
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--diagnose" {
		b, _ := json.Marshal(map[string]any{"component": "aurora-guided-setup", "version": version, "sourceCommit": sourceCommit, "environment": "HML", "credentialsCollected": false, "deviceInstallationVerified": false, "installationComplete": false})
		fmt.Println(string(b))
		return
	}
	runWizard()
}
