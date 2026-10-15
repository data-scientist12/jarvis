import AppKit
import ApplicationServices

/// Synthetic keyboard input (needs Accessibility permission).
enum Input {
    static let keyCodes: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
        "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44,
        "n": 45, "m": 46, ".": 47, "`": 50,
        "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
        "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "forwarddelete": 117,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    ]

    static var trusted: Bool { AXIsProcessTrusted() }

    static func requestTrust() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
    }

    static func ensureTrusted() throws {
        guard trusted else {
            requestTrust()
            throw ToolError("accessibility_denied", "Jarvis needs Accessibility permission to press keys.",
                            suggestion: "Ask the user to enable Jarvis in System Settings → Privacy & Security → Accessibility, then retry.")
        }
    }

    /// Presses a combo like "cmd+shift+t", "return", "cmd+enter".
    static func press(_ combo: String) throws {
        try ensureTrusted()
        var flags: CGEventFlags = []
        var key: CGKeyCode?
        for part in combo.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            switch part {
            case "cmd", "command", "⌘": flags.insert(.maskCommand)
            case "shift", "⇧": flags.insert(.maskShift)
            case "alt", "option", "opt", "⌥": flags.insert(.maskAlternate)
            case "ctrl", "control", "⌃": flags.insert(.maskControl)
            case "fn": flags.insert(.maskSecondaryFn)
            default: key = keyCodes[part]
            }
        }
        guard let key else { throw ToolError("bad_key", "Unknown key in '\(combo)'") }
        let src = CGEventSource(stateID: .hidSystemState)
        let down = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: true)
        let up = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: false)
        down?.flags = flags; up?.flags = flags
        down?.post(tap: .cghidEventTap)
        usleep(12_000)
        up?.post(tap: .cghidEventTap)
        usleep(30_000)
    }

    /// Types arbitrary unicode text into the focused element.
    static func type(_ text: String) throws {
        try ensureTrusted()
        let src = CGEventSource(stateID: .hidSystemState)
        for chunk in Array(text.utf16).chunked(16) {
            let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
            let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
            down?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
            up?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
            down?.post(tap: .cghidEventTap); up?.post(tap: .cghidEventTap)
            usleep(8_000)
        }
    }
}

extension Array {
    func chunked(_ size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}

/// Screen capture via the `screencapture` CLI (needs Screen Recording permission).
enum Screen {
    static func ensureAccess() throws {
        if !CGPreflightScreenCaptureAccess() {
            CGRequestScreenCaptureAccess()
            throw ToolError("screen_recording_denied", "Jarvis needs Screen Recording permission to see the screen.",
                            suggestion: "Ask the user to enable Jarvis in System Settings → Privacy & Security → Screen & System Audio Recording, then restart Jarvis.")
        }
    }

    /// Captures the main display, or the frontmost window of an app.
    static func capture(appName: String? = nil) async throws -> Data {
        try ensureAccess()
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("jarvis-\(UUID().uuidString).png").path
        var args = ["-x", "-t", "png"]
        if let appName, let wid = windowID(for: appName) { args += ["-o", "-l\(wid)"] } else { args += ["-m"] }
        args.append(path)
        let r = await Shell.runAsync("/usr/sbin/screencapture", args, timeout: 10)
        guard r.ok, let data = FileManager.default.contents(atPath: path) else { throw ToolError("capture_failed", "Screenshot failed: \(r.stderr)") }
        try? FileManager.default.removeItem(atPath: path)
        return downscale(data, maxWidth: 1600)
    }

    static func windowID(for app: String) -> Int? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        let wins = list.filter {
            ($0[kCGWindowOwnerName as String] as? String)?.lowercased().contains(app.lowercased()) == true && ($0[kCGWindowLayer as String] as? Int) == 0
        }
        let biggest = wins.max { a, b in
            let ra = a[kCGWindowBounds as String] as? [String: CGFloat] ?? [:], rb = b[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
            return (ra["Width"] ?? 0) * (ra["Height"] ?? 0) < (rb["Width"] ?? 0) * (rb["Height"] ?? 0)
        }
        return biggest?[kCGWindowNumber as String] as? Int
    }

    static func downscale(_ png: Data, maxWidth: CGFloat) -> Data {
        guard let img = NSImage(data: png), let rep = img.representations.first else { return png }
        let w = CGFloat(rep.pixelsWide), h = CGFloat(rep.pixelsHigh)
        guard w > maxWidth else { return png }
        let size = NSSize(width: maxWidth, height: (h * maxWidth / w).rounded())
        guard let bmp = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height), bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        else { return png }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bmp)
        img.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        return bmp.representation(using: .png, properties: [:]) ?? png
    }

    /// Vision check: asks the fast model a yes/no question about a screenshot.
    static func verify(_ question: String, appName: String?) async -> (ok: Bool, reason: String) {
        do {
            let png = try await capture(appName: appName)
            let r = try await OpenAIClient.shared.judge("Look at this screenshot. \(question)\nReturn {\"ok\": true|false, \"reason\": \"short explanation\"}.", imagePNG: png)
            return (r["ok"] as? Bool ?? false, r["reason"] as? String ?? "")
        } catch {
            return (false, "Could not verify visually: \(error.localizedDescription)")
        }
    }
}
