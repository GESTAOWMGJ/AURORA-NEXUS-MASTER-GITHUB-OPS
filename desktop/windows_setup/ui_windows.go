//go:build aurora_windows_setup && windows

package main

import (
 "os"
 "os/exec"
 "path/filepath"
 "syscall"
 "unsafe"
)

func dialog(title, message string, choice bool) bool {
 text,_:=syscall.UTF16PtrFromString(message); caption,_:=syscall.UTF16PtrFromString("AURORA NEXUS — "+title)
 flags:=uintptr(0x40); if choice { flags=0x41 }
 result,_,_:=syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0,uintptr(unsafe.Pointer(text)),uintptr(unsafe.Pointer(caption)),flags)
 return result==1
}
func openOfficial(url string) {
 verb,_:=syscall.UTF16PtrFromString("open"); target,_:=syscall.UTF16PtrFromString(url)
 syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW").Call(0,uintptr(unsafe.Pointer(verb)),uintptr(unsafe.Pointer(target)),0,0,1)
}
func edgePath() string {
 for _,base:=range []string{os.Getenv("PROGRAMFILES(X86)"),os.Getenv("PROGRAMFILES")} {
  if base=="" { continue }; path:=filepath.Join(base,"Microsoft","Edge","Application","msedge.exe")
  if info,err:=os.Stat(path);err==nil&&!info.IsDir(){return path}
 };return ""
}
func runWizard() {
 if !dialog("1 de 4 — Bem-vindo", "Este assistente instala o cliente beta para o seu usuário.\n\nVocê fará: verificar o computador → instalar → entrar no AURORA → conferir conexões.\n\nTenha seu e-mail AURORA e o autenticador disponíveis. As credenciais serão digitadas somente no portal.\n\nAmbiente: homologação. Pacote sem assinatura de editor. Se o Windows bloquear, não desative suas proteções.\n\nOK: começar. Cancelar: sair sem instalar.",true){return}
 edge:=edgePath(); if edge=="" {dialog("Preparação pendente","Microsoft Edge não foi encontrado. Instale pelo site oficial e execute este assistente novamente.",false);openOfficial("https://www.microsoft.com/edge/download");return}
 python,args,err:=findPython(); if err!=nil {dialog("Preparação pendente","Python 3.10 ou superior não foi encontrado.\n\nNo instalador oficial, habilite o launcher Python. Depois, execute este assistente novamente. O AURORA não altera políticas do computador.",false);openOfficial("https://www.python.org/downloads/windows/");return}
 if !dialog("2 de 4 — Instalar", "Edge e Python encontrados.\n\nSerá criado ou atualizado o atalho AURORA NEXUS no menu Iniciar. A versão anterior será preservada. Não é necessário executar como administrador.\n\nOK: instalar. Cancelar: sair.",true){return}
 root,err:=os.MkdirTemp("","aurora-setup-"); if err!=nil {dialog("Instalação pendente","Não foi possível preparar os arquivos temporários.",false);return};defer os.RemoveAll(root)
 if err=extract(payload,root);err!=nil {dialog("Pacote inválido","Não foi possível verificar os componentes. Baixe novamente pelo portal AURORA.",false);return}
 callArgs:=append(append([]string{},args...),"-I",filepath.Join(root,"desktop","install_windows_beta.py"),"install")
 command:=exec.Command(python,callArgs...)
 command.SysProcAttr=&syscall.SysProcAttr{HideWindow:true}
 // Do not log installer output, credentials, browser storage or user paths.
 if err=command.Run();err!=nil {dialog("Instalação não concluída","Confira internet e acesso ao portal. Se já existe outra instalação, ela precisa ter identidade compatível. Nenhum login foi confirmado. Execute novamente depois de corrigir a pendência.",false);return}
 if !dialog("3 de 4 — Sua conta AURORA", "O cliente foi instalado. Agora será aberto o assistente no portal.\n\nEntre com seu e-mail AURORA, senha e segundo fator. Se já há sessão válida no Edge, ela será reutilizada.\n\nNão forneça senhas de Google, Microsoft, GitHub ou Firebase ao instalador. As integrações da sua empresa são administradas dentro do AURORA.",true){return}
 if err=exec.Command(edge,"--app="+portal+"/setup").Start();err!=nil {dialog("Abrir o portal","Abra o atalho AURORA NEXUS e selecione Instalação e conexões.",false);return}
 dialog("4 de 4 — Concluir no portal","A janela do AURORA foi aberta. Conclua a verificação de conta e conexões nessa janela.\n\nAbrir uma janela não comprova login ou sincronização. O portal mostrará o resultado real.\n\nPatches web usam o atualizador existente. Atualizações do executável ficam em Downloads; instalação binária automática ainda não está habilitada.\n\nAbra o AURORA pelo menu Iniciar nos próximos acessos.",false)
}
