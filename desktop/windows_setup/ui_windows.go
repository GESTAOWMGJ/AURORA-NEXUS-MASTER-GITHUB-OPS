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
	text, _ := syscall.UTF16PtrFromString(message)
	caption, _ := syscall.UTF16PtrFromString("AURORA NEXUS — " + title)
	flags := uintptr(0x40)
	if choice {
		flags = 0x41
	}
	result, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(caption)), flags)
	return result == 1
}
func openOfficial(url string) {
	verb, _ := syscall.UTF16PtrFromString("open")
	target, _ := syscall.UTF16PtrFromString(url)
	syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW").Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, 1)
}
func edgePath() string {
	for _, base := range []string{os.Getenv("PROGRAMFILES(X86)"), os.Getenv("PROGRAMFILES")} {
		if base == "" {
			continue
		}
		path := filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe")
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}
func runWizard() {
	if !dialog("1 de 4 — Preparar", "Este assistente atualiza o mesmo cliente beta para seu usuário.\n\nA instalação só termina depois de integração autorizada, processamento canônico e repetição idempotente confirmados pelo servidor.\n\nFaça login e MFA somente no portal oficial. Credenciais de integração usam o canal protegido do administrador, nunca argumentos do assistente.\n\nAmbiente: homologação. Pacote sem assinatura de editor. Se o Windows bloquear, não desative suas proteções.\n\nOK: começar. Cancelar: sair sem instalar.", true) {
		return
	}
	edge := edgePath()
	if edge == "" {
		dialog("Preparação pendente", "Microsoft Edge não foi encontrado. Instale pelo site oficial e execute este assistente novamente.", false)
		openOfficial("https://www.microsoft.com/edge/download")
		return
	}
	python, args, err := findPython()
	if err != nil {
		dialog("Preparação pendente", "Python 3.10 ou superior não foi encontrado.\n\nNo instalador oficial, habilite o launcher Python. Depois, execute este assistente novamente. O AURORA não altera políticas do computador.", false)
		openOfficial("https://www.python.org/downloads/windows/")
		return
	}
	integrationArgs, err := installerArguments(os.Args[1:])
	if err != nil {
		openOfficial(portal + "/setup")
		dialog("Integração pendente", "Conclua login, MFA e configuração da automação em Instalação e conexões. Depois use a configuração não secreta autorizada para retomar este assistente.\n\nNenhum cliente foi instalado. Abrir o portal ou autenticar não comprova processamento, replay, OAuth nem coleta local. O assistente não exporta a sessão do navegador.", false)
		return
	}
	if !dialog("2 de 4 — Verificar integração", "Edge e Python encontrados.\n\nO componente usará a configuração aprovada e seu estado existente para validar a organização, processar a amostra autorizada e conferir sua repetição idempotente. Cloud e coleta local precisam do adaptador real já configurado; um nome de método não basta.\n\nSomente após o resultado confirmado será atualizado o atalho do mesmo cliente, com backup.\n\nOK: verificar e continuar. Cancelar: sair.", true) {
		return
	}
	root, err := os.MkdirTemp("", "aurora-setup-")
	if err != nil {
		dialog("Instalação pendente", "Não foi possível preparar os arquivos temporários.", false)
		return
	}
	defer os.RemoveAll(root)
	if err = extract(payload, root, sourceCommit); err != nil {
		dialog("Pacote inválido", "Não foi possível verificar a fonte e todos os componentes. Baixe novamente pelo portal AURORA.", false)
		return
	}
	callArgs := append(append([]string{}, args...), "-B", filepath.Join(root, "desktop", "install_windows_beta.py"), "install")
	callArgs = append(callArgs, integrationArgs...)
	command := exec.Command(python, callArgs...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	// Do not log installer output, credentials, browser storage or user paths.
	if err = command.Run(); err != nil {
		dialog("Instalação não concluída", "A integração autenticada, o processamento e a automação precisam estar confirmados. Também confira a identidade da instalação existente.\n\nPreparação, ping, login ou recibo antigo não autorizam conclusão. Preserve o estado e retome após corrigir a pendência; não reinstale outro agente.", false)
		return
	}
	if !dialog("3 de 4 — Cliente integrado", "O cliente foi atualizado após integração canônica confirmada. A versão anterior e os dados existentes foram preservados.\n\nSerá aberto o portal para conferir o estado operacional. Este resultado não certifica aquisição global, OAuth novo, todos os formatos ou execução do agente em segundo plano.", true) {
		return
	}
	if err = exec.Command(edge, "--app="+portal+"/setup").Start(); err != nil {
		dialog("Abrir o portal", "Abra o atalho AURORA NEXUS e selecione Instalação e conexões.", false)
		return
	}
	dialog("4 de 4 — Conferir no portal", "A janela do AURORA foi aberta. Confira os recibos e as pendências reais em Instalação e conexões.\n\nAquisição de nuvem, coleta local e formatos não extraídos mantêm seus próprios gates. Nenhuma identidade de outro dispositivo foi substituída.\n\nAbra o AURORA pelo menu Iniciar nos próximos acessos.", false)
}
