//go:build aurora_windows_setup && !windows

package main
import "fmt"
func runWizard(){fmt.Println("Este assistente exige Windows. Use --diagnose para verificar o pacote.")}
