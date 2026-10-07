//go:build aurora_windows_setup

package main

import (
 "archive/zip"
 "bytes"
 _ "embed"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "os/exec"
 "path/filepath"
)

//go:embed payload.zip
var payload []byte
var sourceCommit = "unversioned"
const version = "0.2.0-beta.4"
const portal = "https://wmgj-hml-jfn-20260927.web.app"
var required = []string{"desktop/install_windows_beta.py", "aurora-coletor/aurora_deployment.py", "aurora-coletor/aurora_cloud_sync.py"}

func extract(data []byte, root string) error {
 archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data))); if err != nil { return err }
 allowed := map[string]bool{}; for _, name := range required { allowed[name] = true }
 seen := map[string]bool{}
 for _, f := range archive.File {
  if !allowed[f.Name] { continue }
  if seen[f.Name] || f.Mode()&os.ModeSymlink != 0 || f.UncompressedSize64 > 1024*1024 { return errors.New("invalid payload") }
  seen[f.Name] = true
  target := filepath.Join(root, filepath.FromSlash(f.Name))
  if err = os.MkdirAll(filepath.Dir(target),0700); err != nil { return err }
  reader, e := f.Open(); if e != nil { return e }
  content, e := io.ReadAll(io.LimitReader(reader,1024*1024+1)); reader.Close()
  if e != nil || len(content)>1024*1024 { return errors.New("invalid payload size") }
  out,e := os.OpenFile(target,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600); if e != nil { return e }
  _, e = out.Write(content); closeErr:=out.Close(); if e != nil { return e }; if closeErr != nil { return closeErr }
 }
 for _, name := range required { if !seen[name] { return errors.New("incomplete payload") } }
 return nil
}

func findPython() (string, []string, error) {
 for _, candidate := range []struct{name string; args []string}{{"py",[]string{"-3"}},{"python",nil}} {
  path,err:=exec.LookPath(candidate.name); if err != nil { continue }
  args:=append(append([]string{},candidate.args...),"-I","-c","import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)")
  if exec.Command(path,args...).Run()==nil { return path,candidate.args,nil }
 }
 return "",nil,errors.New("Python 3.10+ required")
}

func main() {
 if len(os.Args)==2 && os.Args[1]=="--diagnose" {
  b,_:=json.Marshal(map[string]any{"component":"aurora-guided-setup","version":version,"sourceCommit":sourceCommit,"environment":"HML","credentialsCollected":false,"deviceInstallationVerified":false})
  fmt.Println(string(b)); return
 }
 runWizard()
}
