import Foundation

enum Config {
    static let jarvisDir: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".jarvis")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static let availableModels = ["gpt-5.4-mini", "gpt-5.5", "gpt-5.4", "gpt-4.1"]

    static var model: String {
        get { UserDefaults.standard.string(forKey: "jarvis.model") ?? "gpt-5.4-mini" }
        set { UserDefaults.standard.set(newValue, forKey: "jarvis.model") }
    }

    /// Small, fast model used for verification and vision checks.
    static let fastModel = "gpt-5.4-mini"

    static var autopilot: Bool {
        get { UserDefaults.standard.object(forKey: "jarvis.autopilot") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "jarvis.autopilot") }
    }

    static let maxIterations = 16
    static let toolTimeout: TimeInterval = 60

    /// Country code prepended to 10-digit local numbers for WhatsApp.
    static var defaultCountryCode: String {
        switch TimeZone.current.identifier {
        case "Asia/Kolkata", "Asia/Calcutta": return "91"
        case "Europe/London": return "44"
        case "Asia/Dubai": return "971"
        case "Asia/Singapore": return "65"
        default: return "1"
        }
    }

    static var userName: String { NSFullUserName() }
}

/// Resolves secrets: ~/.jarvis/.env first, then the process environment, then the login shell.
enum KeyProvider {
    static func value(_ name: String) -> String? {
        if let v = readEnvFile()[name], !v.isEmpty { return v }
        if let v = ProcessInfo.processInfo.environment[name], !v.isEmpty { return v }
        if let v = shellValue(name), !v.isEmpty { return v }
        return nil
    }

    static var openAIKey: String? { value("OPENAI_API_KEY") }

    private static func readEnvFile() -> [String: String] {
        let url = Config.jarvisDir.appendingPathComponent(".env")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [:] }
        var out: [String: String] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            let l = line.trimmingCharacters(in: .whitespaces)
            guard !l.hasPrefix("#"), let eq = l.firstIndex(of: "=") else { continue }
            let k = String(l[..<eq]).trimmingCharacters(in: .whitespaces)
            var v = String(l[l.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            v = v.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            out[k] = v
        }
        return out
    }

    private static func shellValue(_ name: String) -> String? {
        let r = Shell.run("/bin/zsh", ["-ilc", "printenv \(name)"], timeout: 5)
        return r.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Append-only JSONL log for debugging stage failures.
enum JLog {
    private static let queue = DispatchQueue(label: "jarvis.log")
    static func write(_ kind: String, _ payload: [String: Any]) {
        queue.async {
            let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
            let dir = Config.jarvisDir.appendingPathComponent("logs")
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent("\(df.string(from: Date())).jsonl")
            var obj = payload; obj["kind"] = kind; obj["ts"] = ISO8601DateFormatter().string(from: Date())
            guard var line = JSON.string(obj) else { return }
            line += "\n"
            if let h = try? FileHandle(forWritingTo: url) {
                h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
            } else {
                try? line.write(to: url, atomically: true, encoding: .utf8)
            }
        }
    }
}

enum JSON {
    static func string(_ obj: Any, pretty: Bool = false) -> String? {
        guard JSONSerialization.isValidJSONObject(obj),
              let d = try? JSONSerialization.data(withJSONObject: obj, options: pretty ? [.prettyPrinted, .sortedKeys] : [.sortedKeys])
        else { return nil }
        return String(data: d, encoding: .utf8)
    }
    static func object(_ s: String) -> [String: Any]? {
        guard let d = s.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }
    static func any(_ s: String) -> Any? {
        guard let d = s.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed])
    }
}
