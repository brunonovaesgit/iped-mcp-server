import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let status = NSTextField(wrappingLabelWithString: "Selecione sua instalação do IPED e um caso já processado.")
    let startButton = NSButton(title: "Selecionar IPED e caso…", target: nil, action: nil)
    let browserButton = NSButton(title: "Abrir investigação", target: nil, action: nil)
    var worker: Process?
    var outputPipe: Pipe?
    var logHandle: FileHandle?
    var pending = Data()
    var readyURL: URL?
    var terminating = false
    let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/IPED MCP", isDirectory: true)
    var logURL: URL { support.appendingPathComponent("launcher.log") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let item = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Encerrar IPED MCP", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        menu.addItem(item)
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 230), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "IPED MCP"
        window.isReleasedWhenClosed = false
        let title = NSTextField(labelWithString: "IPED MCP")
        title.font = .boldSystemFont(ofSize: 24)
        let note = NSTextField(wrappingLabelWithString: "Consulta de casos processados. As evidências permanecem no IPED.")
        note.textColor = .secondaryLabelColor
        startButton.target = self
        startButton.action = #selector(selectCase)
        browserButton.target = self
        browserButton.action = #selector(openInvestigation)
        browserButton.isEnabled = false
        let logs = NSButton(title: "Ver diagnóstico", target: self, action: #selector(openLog))
        let buttons = NSStackView(views: [startButton, browserButton, logs])
        buttons.spacing = 10
        let stack = NSStackView(views: [title, note, status, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24)
        ])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async { self.selectCase() }
    }

    func folder(_ title: String) -> URL? {
        let panel = NSOpenPanel()
        panel.title = title
        panel.message = title
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Selecionar"
        return panel.runModal() == .OK ? panel.url : nil
    }

    @objc func selectCase() {
        guard worker == nil else { return }
        guard let iped = folder("Selecione a instalação do IPED (pasta que contém lib)") else { return }
        guard let caseURL = folder("Selecione a pasta do caso já processado pelo IPED") else { return }
        do {
            try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            // Rotate the previous startup log, never log credentials or evidence content here.
            let previous = support.appendingPathComponent("launcher.previous.log")
            if FileManager.default.fileExists(atPath: logURL.path) {
                try? FileManager.default.removeItem(at: previous)
                try FileManager.default.moveItem(at: logURL, to: previous)
            }
            FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            logHandle = try FileHandle(forWritingTo: logURL)
            guard let root = Bundle.main.resourceURL?.appendingPathComponent("app") else {
                throw NSError(domain: "IPED MCP", code: 1, userInfo: [NSLocalizedDescriptionKey: "O pacote do aplicativo está incompleto."])
            }
            let process = Process()
            process.executableURL = root.appendingPathComponent("runtime/bin/node")
            process.arguments = [root.appendingPathComponent("dist/launch.js").path, "--desktop", "--iped-home", iped.path, "--case", caseURL.path]
            process.currentDirectoryURL = support
            var env = ProcessInfo.processInfo.environment
            // Finder needs no login shell. Do not inherit Node injection/settings from a terminal.
            env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
            env.removeValue(forKey: "NODE_OPTIONS")
            env.removeValue(forKey: "NODE_PATH")
            env["AUDIT_LOG"] = support.appendingPathComponent("audit/requests.jsonl").path
            env["DOTENV_CONFIG_PATH"] = support.appendingPathComponent(".env").path
            process.environment = env
            process.standardInput = FileHandle.nullDevice
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            pending = Data()
            readyURL = nil
            browserButton.isEnabled = false
            outputPipe = pipe
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { handle.readabilityHandler = nil; return }
                DispatchQueue.main.async { self?.received(data) }
            }
            process.terminationHandler = { [weak self] p in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.worker = nil
                    self.outputPipe?.fileHandleForReading.readabilityHandler = nil
                    self.startButton.isEnabled = true
                    self.browserButton.isEnabled = false
                    self.readyURL = nil
                    if self.terminating { NSApp.reply(toApplicationShouldTerminate: true); return }
                    self.status.stringValue = p.terminationStatus == 0 ? "Sessão encerrada. Selecione um caso para começar." : "Não foi possível manter a conexão. Consulte o diagnóstico e tente novamente."
                    if p.terminationStatus != 0 { self.showError("A inicialização ou conexão foi interrompida. Consulte “Ver diagnóstico” para os detalhes. Você pode selecionar as pastas novamente.") }
                }
            }
            try logHandle?.write(contentsOf: Data("IPED MCP \(Date())\nRuntime: \(process.executableURL!.path)\nDiretório de trabalho: \(support.path)\n".utf8))
            try process.run()
            worker = process
            startButton.isEnabled = false
            status.stringValue = "Validando o caso e iniciando o IPED… Aguarde."
        } catch {
            worker = nil
            startButton.isEnabled = true
            showError(error.localizedDescription)
        }
    }

    func received(_ data: Data) {
        try? logHandle?.write(contentsOf: data)
        pending.append(data)
        while let end = pending.firstIndex(of: 10) {
            let line = String(decoding: pending[..<end], as: UTF8.self)
            pending.removeSubrange(...end)
            let prefix = "IPED_MCP_READY="
            if line.hasPrefix(prefix), let url = URL(string: String(line.dropFirst(prefix.count))),
               url.scheme == "http", url.host == "127.0.0.1", url.port != nil {
                readyURL = url
                status.stringValue = "IPED conectado. Mantenha este aplicativo aberto durante a investigação."
                browserButton.isEnabled = true
                openInvestigation()
            }
        }
        if pending.count > 65536 { pending.removeAll() }
    }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "IPED MCP"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
    @objc func openInvestigation() { if let url = readyURL { NSWorkspace.shared.open(url) } }
    @objc func openLog() { if FileManager.default.fileExists(atPath: logURL.path) { NSWorkspace.shared.open(logURL) } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        if readyURL != nil { openInvestigation() }
        return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let process = worker, process.isRunning else { return .terminateNow }
        terminating = true
        status.stringValue = "Encerrando a conexão com o IPED…"
        process.terminate()
        return .terminateLater
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
