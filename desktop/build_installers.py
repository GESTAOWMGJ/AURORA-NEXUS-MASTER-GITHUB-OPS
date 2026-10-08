#!/usr/bin/env python3
"""Build private HML portal clients; never deploy, scan documents or sign claims.
Python 3.10+ and local Go 1.23+ are required. No third-party modules/downloads.
"""
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, plistlib, shutil, stat, subprocess, tempfile, zipfile

VERSION = '0.2.0-hml.20261001'
PORTAL = 'https://auroranexus.com.br/portal'
MAC_NAME = 'AURORA-NEXUS-Mac-HML.zip'
WIN_NAME = 'AURORA-NEXUS-Windows-x64-HML.exe'
NOTICE = '''AURORA NEXUS — CLIENTE DE ACESSO | HOMOLOGAÇÃO
Versão: ''' + VERSION + '''
Destino: ''' + PORTAL + '''

Este cliente abre o portal no navegador padrão e utiliza a autenticação do servidor.
Não é um ERP offline, não contém senha e não instala um servidor local.
A compilação/instalação NÃO comprova disponibilidade, login ou deploy do portal.
O portal canônico concentra o acesso do cliente; endpoints Firebase/Cloud Run são infraestrutura.
Não publique URLs técnicas como caminho de usuário. Não substitui o aplicativo existente.

Esta distribuição não possui assinatura de editor nem notarização Apple.
Se Gatekeeper, SmartScreen ou política institucional bloquear, interrompa.
Não desative proteções, não remova a quarentena e não amplie permissões.
A distribuição comercial requer assinatura, validação nativa e aceite de homologação.

MAC: extraia o ZIP e abra Instalar_AURORA_NEXUS.command.
Instalação por usuário em ~/Applications/Aurora Nexus HML-<versão>.app.
O aplicativo é um launcher .app para o portal, compatível com Intel e Apple Silicon
por utilizar os comandos nativos do sistema; a compatibilidade deve ser homologada.
O módulo de descoberta POSIX/macOS anterior é preservado como recurso opcional.
Ele exige Python 3.10+, configuração e autorização próprias antes da execução.
Nenhuma pasta é examinada na instalação. O scanner POSIX não está portado para Windows.

WINDOWS x64: abra AURORA-NEXUS-Windows-x64-HML.exe.
Confirme a instalação por usuário em %LOCALAPPDATA%\\Programs\\AuroraNexusHML\\<versão>.
O instalador cria um atalho de Internet no menu Iniciar sem substituir atalhos existentes.
O executável instalado abre o mesmo portal. Não requer Python para essa função.

O WEB APP é o ponto principal de gestão: registro de ações, status, fontes e integrações.\nAtualizações do WEB APP aparecem na próxima abertura do mesmo portal.
Este cliente NÃO baixa/executa atualizações binárias automaticamente.
Atualização do cliente: nova versão autorizada, verificação de integridade e instalação.
As versões coexistem; nenhum dado ou aplicativo anterior é sobrescrito.
Um arquivo SHA-256 demonstra integridade, não assinatura/autenticidade do editor.
'''
MAC_LAUNCHER = r'''#!/bin/sh
set -eu
if [ "${1:-}" = "--diagnose" ]; then
  printf '%s\n' '{"component":"aurora-portal-client","channel":"homologation","version":"@VERSION@","portal":"@PORTAL@","serverVerified":false,"autoScan":false}'
  exit 0
fi
[ "$(uname -s)" = Darwin ] || { echo 'AURORA: este launcher exige macOS.' >&2; exit 2; }
# Open only the build-time HML endpoint; never source local or remote configuration.
exec /usr/bin/open '@PORTAL@'
'''
MAC_INSTALL = r'''#!/bin/bash
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT"
/usr/bin/shasum -a 256 -c SHA256SUMS.txt >/dev/null
if [ "${1:-}" = "--verify" ]; then
  printf '%s\n' 'AURORA: integridade do pacote verificada; servidor e instalação não verificados.'
  exit 0
fi
[ "$(uname -s)" = Darwin ] || { echo 'AURORA: instalação exclusiva para macOS.' >&2; exit 2; }
[ "$(id -u)" -ne 0 ] || { echo 'Não execute como root/sudo.' >&2; exit 2; }
[ -t 0 ] || { echo 'Abra o instalador no Terminal da sessão do usuário.' >&2; exit 2; }
printf '%s\n' 'AURORA NEXUS HML — cliente do portal; não constitui deploy do servidor.'
printf '%s\n' 'Pacote sem assinatura de editor/notarização. Não desative o Gatekeeper.'
printf '%s\n' 'Nenhuma busca documental será iniciada. Nenhum aplicativo será sobrescrito.'
read -r -p 'Instalar esta versão de homologação apenas para seu usuário? [s/N] ' answer
case "$answer" in s|S|sim|SIM) ;; *) echo 'Instalação cancelada.'; exit 0;; esac
BASE="$HOME/Applications"
DEST="$BASE/Aurora Nexus HML-@VERSION@.app"
[ ! -L "$BASE" ] || { echo 'Pasta Applications redirecionada; instalação bloqueada.' >&2; exit 2; }
[ ! -e "$DEST" ] && [ ! -L "$DEST" ] || { echo 'Versão já existente; nenhum arquivo foi alterado.' >&2; exit 2; }
mkdir -p "$BASE"
STAGE="$(mktemp -d "$BASE/.aurora-stage.XXXXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT
/usr/bin/ditto "$ROOT/Aurora Nexus HML.app" "$STAGE/Aurora Nexus HML.app"
# Serialize this install; no existing version or source document is replaced.
LOCK="$BASE/.aurora-install-@VERSION@.lock"
mkdir "$LOCK" || { echo 'Outra instalação está em andamento.' >&2; exit 2; }
trap 'rmdir -- "$LOCK" 2>/dev/null || true; rm -rf -- "$STAGE"' EXIT
[ ! -e "$DEST" ] && [ ! -L "$DEST" ] || exit 2
mv -n "$STAGE/Aurora Nexus HML.app" "$DEST"
[ -x "$DEST/Contents/MacOS/aurora-portal" ] || { echo 'Instalação não confirmada.' >&2; exit 2; }
printf 'Cliente instalado em: %s\n' "$DEST"
printf '%s\n' 'Abra o aplicativo para acessar o portal. Servidor/login continuam sujeitos à homologação.'
'''
GO_MAIN = r'''package main
import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "strings"
)
const version = "@VERSION@"
const portal = "@PORTAL@"
const notice = `@NOTICE@`

func installBase(base string) error {
 if base == "" || !filepath.IsAbs(base) { return errors.New("destino de instalação inválido") }
 for path := filepath.Clean(base); ; path = filepath.Dir(path) {
  info, err := os.Lstat(path)
  if err != nil && !os.IsNotExist(err) { return err }
  if err == nil && (info.Mode()&os.ModeSymlink != 0 || !info.IsDir() || reparsePoint(path)) { return errors.New("diretório redirecionado ou inválido; nenhuma instalação aplicada") }
  if filepath.Dir(path) == path { break }
 }
 return os.MkdirAll(base, 0700)
}
func writeExclusive(path string, data []byte, mode os.FileMode) error {
 file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
 if err != nil { return err }
 _, writeErr := file.Write(data); syncErr := file.Sync(); closeErr := file.Close()
 if writeErr != nil { return writeErr }; if syncErr != nil { return syncErr }; return closeErr
}
func installAt(base string, image []byte) (string, error) {
 if err := installBase(base); err != nil { return "", err }
 target := filepath.Join(base, version)
 if _, err := os.Lstat(target); err == nil || !os.IsNotExist(err) { return "", errors.New("versão já existente ou destino inacessível; nada sobrescrito") }
 stage, err := os.MkdirTemp(base, ".aurora-stage-"); if err != nil { return "", err }
 defer os.RemoveAll(stage)
 if err = writeExclusive(filepath.Join(stage,"AuroraNexus.exe"),image,0700); err != nil { return "", err }
 if err = writeExclusive(filepath.Join(stage,"LEIA_PRIMEIRO.txt"),[]byte(notice),0600); err != nil { return "", err }
 sum := sha256.Sum256(image)
 if err = writeExclusive(filepath.Join(stage,"SHA256.txt"),[]byte(hex.EncodeToString(sum[:])+"  AuroraNexus.exe\n"),0600); err != nil { return "", err }
 // A per-version exclusive lock prevents installer instances racing each other.
 lock := filepath.Join(base,".install-"+version+".lock")
 if err = os.Mkdir(lock,0700); err != nil { return "", err }; defer os.Remove(lock)
 if _, err = os.Lstat(target); err == nil || !os.IsNotExist(err) { return "", errors.New("destino já existente") }
 if err = os.Rename(stage,target); err != nil { return "", err }
 return filepath.Join(target,"AuroraNexus.exe"), nil
}
func main() {
 if len(os.Args)>1 && os.Args[1]=="--diagnose" {
  data,_ := json.Marshal(map[string]any{"component":"aurora-portal-client","channel":"homologation","version":version,"portal":portal,"serverVerified":false,"autoScan":false})
  fmt.Println(string(data)); return
 }
 self,err := os.Executable(); if err!=nil { show("Não foi possível identificar o cliente."); return }
 if strings.EqualFold(filepath.Base(self),"AuroraNexus.exe") { if err=openPortal();err!=nil { show("Não foi possível abrir o navegador. O servidor não foi validado.") }; return }
 if !confirm("Instalar AURORA NEXUS HML para este usuário?\n\nCliente do portal, sem base offline. Sem assinatura de editor. O servidor ainda depende de homologação. Nenhuma busca documental será iniciada.") { return }
 root:=os.Getenv("LOCALAPPDATA"); if root=="" { show("LOCALAPPDATA não está disponível. Nada instalado."); return }
 image,err:=os.ReadFile(self); if err!=nil { show("Não foi possível ler o instalador."); return }
 target,err:=installAt(filepath.Join(root,"Programs","AuroraNexusHML"),image)
 if err!=nil { show("Instalação não concluída: "+err.Error()); return }
 shortcutMessage:="Atalho não criado; utilize o executável instalado."
 if roaming:=os.Getenv("APPDATA"); roaming!="" && filepath.IsAbs(roaming) {
  dir:=filepath.Join(roaming,"Microsoft","Windows","Start Menu","Programs")
  if installBase(dir)==nil {
   link:=filepath.Join(dir,"Aurora Nexus HML "+version+".url")
   if writeExclusive(link,[]byte("[InternetShortcut]\r\nURL="+portal+"\r\n"),0600)==nil { shortcutMessage="Atalho do portal criado no menu Iniciar." }
  }
 }
 show("Cliente instalado em:\n"+target+"\n\n"+shortcutMessage+"\n\nA instalação não confirma disponibilidade do servidor ou login. Não é uma versão comercial assinada.")
}
'''
GO_WINDOWS = r'''//go:build windows
package main
import (
 "errors"
 "syscall"
 "unsafe"
)
var user32=syscall.NewLazyDLL("user32.dll")
func dialog(message string, flags uintptr) uintptr {
 text,_:=syscall.UTF16PtrFromString(message); title,_:=syscall.UTF16PtrFromString("AURORA NEXUS | Homologação")
 result,_,_:=user32.NewProc("MessageBoxW").Call(0,uintptr(unsafe.Pointer(text)),uintptr(unsafe.Pointer(title)),flags)
 return result
}
func show(message string) { dialog(message,0x40) }
func confirm(message string) bool { return dialog(message,0x24)==6 }
func openPortal() error {
 verb,_:=syscall.UTF16PtrFromString("open"); url,_:=syscall.UTF16PtrFromString(portal)
 result,_,_:=syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW").Call(0,uintptr(unsafe.Pointer(verb)),uintptr(unsafe.Pointer(url)),0,0,1)
 if result<=32 { return errors.New("browser launch failed") };return nil
}
func reparsePoint(path string) bool {
 ptr,err:=syscall.UTF16PtrFromString(path);if err!=nil{return true}
 attrs,err:=syscall.GetFileAttributes(ptr);return err!=nil || attrs&syscall.FILE_ATTRIBUTE_REPARSE_POINT!=0
}
'''
GO_OTHER = r'''//go:build !windows
package main
import "errors"
func show(message string) { panic("UI must not run outside Windows: "+message) }
func confirm(_ string) bool { return false }
func openPortal() error { return errors.New("Windows required") }
func reparsePoint(_ string) bool { return false }
'''
GO_TEST = r'''package main
import("os";"path/filepath";"testing";"bytes")
func TestInstallAndNeverOverwrite(t *testing.T){
 base:=filepath.Join(t.TempDir(),"Programs com espaço ' teste"); image:=[]byte("synthetic-executable")
 target,err:=installAt(base,image);if err!=nil {t.Fatal(err)}
 got,err:=os.ReadFile(target);if err!=nil||!bytes.Equal(got,image){t.Fatal("payload mismatch")}
 if _,err=installAt(base,[]byte("replacement"));err==nil{t.Fatal("overwrite accepted")}
 got,_=os.ReadFile(target);if !bytes.Equal(got,image){t.Fatal("original changed")}
}
func TestRejectRelativeBase(t *testing.T){if _,err:=installAt("relative",[]byte("x"));err==nil{t.Fatal("relative accepted")}}
func TestRejectFileParent(t *testing.T){p:=filepath.Join(t.TempDir(),"file");os.WriteFile(p,[]byte("x"),0600);if _,err:=installAt(filepath.Join(p,"child"),[]byte("x"));err==nil{t.Fatal("file parent accepted")}}
func TestRejectSymlink(t *testing.T){root:=t.TempDir();target:=filepath.Join(root,"real");os.Mkdir(target,0700);link:=filepath.Join(root,"link");if err:=os.Symlink(target,link);err!=nil{t.Skip("symlink unavailable")};if _,err:=installAt(link,[]byte("x"));err==nil{t.Fatal("symlink accepted")}}
func TestExistingLockBlocksInstall(t *testing.T){base:=t.TempDir();os.Mkdir(filepath.Join(base,".install-"+version+".lock"),0700);if _,err:=installAt(base,[]byte("x"));err==nil{t.Fatal("lock ignored")}}
'''

def fill(value: str) -> str:
    return value.replace('@VERSION@',VERSION).replace('@PORTAL@',PORTAL).replace('@NOTICE@',NOTICE)

def write(path: pathlib.Path, data: str|bytes, mode=0o644):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(data.encode('utf-8') if isinstance(data,str) else data)
    path.chmod(mode)

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def create_zip(root, path):
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for item in sorted(root.rglob('*')):
            if not item.is_file():continue
            info=zipfile.ZipInfo(item.relative_to(root).as_posix(),(2026,9,28,0,0,0))
            info.create_system=3;info.external_attr=(stat.S_IFREG|stat.S_IMODE(item.stat().st_mode))<<16
            info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,item.read_bytes())

def build(output: pathlib.Path):
    repo=pathlib.Path(__file__).resolve().parents[1]
    if shutil.which('go') is None:raise RuntimeError('Go local necessário; nenhum download automático será realizado.')
    output.mkdir(parents=True,exist_ok=True)
    try: commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True,stderr=subprocess.DEVNULL).strip()
    except (OSError,subprocess.CalledProcessError):commit='LOCAL_UNCOMMITTED'
    env={**os.environ,'GO111MODULE':'off','GOTOOLCHAIN':'local','GOPROXY':'off','CGO_ENABLED':'0'}
    with tempfile.TemporaryDirectory(prefix='aurora-build-') as temporary:
        work=pathlib.Path(temporary); gosrc=work/'go';gosrc.mkdir()
        for name,content in [('main.go',GO_MAIN),('ui_windows.go',GO_WINDOWS),('ui_other.go',GO_OTHER),('main_test.go',GO_TEST)]:write(gosrc/name,fill(content))
        subprocess.run(['go','test','-v'],cwd=gosrc,env=env,check=True)
        subprocess.run(['go','build','-trimpath','-ldflags=-H=windowsgui -s -w','-o',str(output/WIN_NAME),'.'],cwd=gosrc,env={**env,'GOOS':'windows','GOARCH':'amd64'},check=True)
        mac=work/'mac';app=mac/'Aurora Nexus HML.app';resources=app/'Contents/Resources'
        write(app/'Contents/MacOS/aurora-portal',fill(MAC_LAUNCHER),0o755)
        plist={'CFBundleName':'Aurora Nexus HML','CFBundleDisplayName':'Aurora Nexus HML','CFBundleIdentifier':'br.com.auroranexus.desktop.hml','CFBundleExecutable':'aurora-portal','CFBundlePackageType':'APPL','CFBundleVersion':'1','CFBundleShortVersionString':'0.2.0','LSMinimumSystemVersion':'10.15','NSHighResolutionCapable':True}
        write(app/'Contents/Info.plist',plistlib.dumps(plist))
        write(resources/'LEIA_PRIMEIRO.txt',NOTICE)
        source=repo/'aurora-coletor/aurora_onboarding.py'
        if not source.is_file():raise RuntimeError('Módulo onboarding existente não encontrado; pacote incompleto recusado.')
        write(resources/'onboarding/aurora_onboarding.py',source.read_bytes(),0o644)
        write(resources/'onboarding/NAO_ATIVADO.txt','Módulo POSIX/macOS preservado, não ativado. Exige Python 3.10+, configuração privada com raízes explícitas, autorização documentada e prazo. Nenhum serviço ou varredura foi iniciado.\n')
        write(mac/'LEIA_PRIMEIRO.txt',NOTICE)
        write(mac/'Instalar_AURORA_NEXUS.command',fill(MAC_INSTALL),0o755)
        sums=''.join(sha(p)+'  '+p.relative_to(mac).as_posix()+'\n' for p in sorted(mac.rglob('*')) if p.is_file())
        write(mac/'SHA256SUMS.txt',sums)
        subprocess.run(['bash','-n',str(mac/'Instalar_AURORA_NEXUS.command')],check=True)
        subprocess.run(['bash',str(mac/'Instalar_AURORA_NEXUS.command'),'--verify'],check=True)
        diagnostic=subprocess.check_output(['sh',str(app/'Contents/MacOS/aurora-portal'),'--diagnose'],text=True)
        assert json.loads(diagnostic)['serverVerified'] is False
        create_zip(mac,output/MAC_NAME)
        if os.name=='nt':
            probe=work/'diagnose.exe'
            subprocess.run(['go','build','-o',str(probe),'.'],cwd=gosrc,env=env,check=True)
            result=json.loads(subprocess.check_output([str(probe),'--diagnose'],text=True))
            assert result['autoScan'] is False and result['serverVerified'] is False
    from build_windows_beta_bundle import build as build_beta, NAME as BETA_NAME
    build_beta(repo, output, commit)
    from build_guided_setup import build as build_guided, NAME as GUIDED_NAME
    build_guided(repo, output, commit)
    files=[]
    for name,label,platform in [(GUIDED_NAME,'Windows beta — instalação guiada','windows'),(BETA_NAME,'Windows beta — Edge e Python 3.10+','windows'),(MAC_NAME,'Mac HML experimental — não atualiza o app existente','mac'),(WIN_NAME,'Windows x64 — launcher HML','windows')]:
        path=output/name
        files.append({'name':name,'label':label,'platform':platform,'size':path.stat().st_size,'sha256':sha(path),'signed':False})
    manifest={'schemaVersion':1,'version':VERSION,'channel':'homologation','portalUrl':PORTAL,'sourceCommit':commit,'productionApproved':False,'files':files}
    write(output/'manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    write(output/'LEIA_PRIMEIRO.txt',NOTICE)
    write(output/'SHA256SUMS.txt',''.join(f['sha256']+'  '+f['name']+'\n' for f in files))
    print(json.dumps({'status':'HML_PACKAGES_BUILT','files':files,'serverDeployed':False,'macInstalled':False,'signed':False},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args()
    build(args.output.resolve())
