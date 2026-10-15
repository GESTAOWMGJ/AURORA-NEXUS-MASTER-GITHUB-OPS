import SwiftUI

struct NativeStatusCenter: View {
    let syntheticUITest: Bool
    @State private var diagnostic = PublicOriginDiagnostic.notObserved
    @State private var loading = false
    private let requirement = InstallationRequirement()

    private var build: BuildProvenance? {
        guard let url = Bundle.main.url(forResource: "BuildProvenance", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? BuildProvenance.parse(data)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Versão desta candidata") {
                    if let build {
                        LabeledContent("Produto", value: build.productVersion)
                        LabeledContent("Fonte do build", value: String(build.sourceSha.prefix(12)))
                        Text(build.releaseId).font(.caption).textSelection(.enabled)
                            .accessibilityIdentifier("native-release-id")
                        Text(build.signingStatus == "UNSIGNED"
                             ? "Sem assinatura Apple e sem aceite nativo. A fonte do build não comprova a referência vigente."
                             : "Candidata para assinatura Apple. Assinatura, processamento no TestFlight e aceite exigem recibos externos; não são atestados por esta tela.")
                            .font(.caption)
                    } else {
                        Text("Proveniência indisponível ou inválida. Não tratar esta candidata como release oficial.")
                    }
                }
                Section("Integração na organização") {
                    Text("Pendente de observação autenticada no portal.")
                        .accessibilityIdentifier("integration-pending")
                    ForEach(requirement.methods, id: \.self) { method in
                        LabeledContent(method, value: "Pendente de recibo")
                    }
                    Text("Instalação completa exige processamento, recibo persistido, replay idempotente e automação integrada. Login, ping e CI não são recibos de ingestão.")
                        .font(.caption)
                    Text("Nenhuma credencial, documento ou prova privada é transferida do portal para esta central.")
                        .font(.caption)
                }
                Section("Diagnóstico público da origem") {
                    Text(diagnostic.status).accessibilityIdentifier("diagnostic-status")
                    if let status = diagnostic.httpStatus { LabeledContent("HTTP", value: String(status)) }
                    Text("Consulta anônima somente a /portal, sem seguir redirect, sem cookies e sem ler o corpo. Não valida login, MFA ou integração.")
                        .font(.caption)
                    Button(loading ? "Verificando…" : "Verificar origem canônica") {
                        guard !loading, !syntheticUITest else { return }
                        loading = true
                        Task {
                            diagnostic = await CanonicalDiagnostics.run()
                            loading = false
                        }
                    }
                    .disabled(loading || syntheticUITest)
                    .accessibilityIdentifier("diagnose-origin")
                }
                Section("Distribuição iOS") {
                    Text("Nativo TestFlight / App Store solicitado.")
                    Text("Build iOS, assinatura, provisionamento, envio e aceite permanecem gates próprios. Nenhum PWA satisfaz esta entrega nativa.")
                        .font(.caption)
                }
            }
            .navigationTitle("Versão e integração")
            .accessibilityIdentifier("native-status-center")
        }
    }
}
