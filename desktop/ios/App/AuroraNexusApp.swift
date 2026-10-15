import SwiftUI

@main
struct AuroraNexusApp: App {
    var body: some Scene {
        WindowGroup { NativeShell() }
    }
}

struct NativeShell: View {
    @StateObject private var browser = PortalBrowser()
    private var syntheticUITest: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("--aurora-ui-test")
        #else
        return false
        #endif
    }

    var body: some View {
        TabView {
            NavigationStack {
                Group {
                    if syntheticUITest {
                        Text("Portal canônico — teste sintético sem rede")
                            .accessibilityIdentifier("synthetic-portal")
                    } else {
                        PortalWebView(browser: browser)
                    }
                }
                .navigationTitle("AURORA NEXUS")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItemGroup(placement: .bottomBar) {
                        Button("Voltar") { browser.back() }
                        Spacer()
                        Button("Portal") { browser.navigate(.portal) }
                        Spacer()
                        Button("Recarregar") { browser.reload() }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    if browser.blockedOperation {
                        Text("Navegação ou download bloqueado por esta candidata. Use somente o portal canônico.")
                            .font(.caption).padding().background(.thinMaterial)
                            .accessibilityIdentifier("navigation-blocked")
                    }
                }
            }
            .tabItem { Label("Portal", systemImage: "square.grid.2x2") }
            NativeStatusCenter(syntheticUITest: syntheticUITest)
                .tabItem { Label("Versão e integração", systemImage: "checklist") }
                .accessibilityIdentifier("native-status-tab")
        }
    }
}
