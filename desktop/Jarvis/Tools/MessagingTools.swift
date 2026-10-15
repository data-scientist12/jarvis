import AppKit

enum MessagingTools {
    static var all: [Tool] { [imessage, whatsapp] }

    static func normalizePhone(_ raw: String) -> String {
        let hasPlus = raw.trimmingCharacters(in: .whitespaces).hasPrefix("+")
        var d = raw.filter(\.isNumber)
        if hasPlus { return d }
        if d.hasPrefix("00") { return String(d.dropFirst(2)) }
        if d.count == 11 && d.hasPrefix("0") { d = String(d.dropFirst()) }
        if d.count == 10 { return Config.defaultCountryCode + d }
        return d
    }

    static let imessage = Tool(
        "imessage_send",
        "Send an iMessage/SMS through the Messages app. 'to' may be a contact name, phone number or email.",
        params: ["to": P.str("Contact name, phone or email"), "text": P.str("Message text")],
        required: ["to", "text"], risk: .high,
        title: { "Texting \($0.string("to") ?? "") on iMessage" }
    ) { a in
        let (name, handle) = try await Contacts.resolve(try a.require("to"), wantPhone: true)
        let target = handle.contains("@") ? handle : "+" + normalizePhone(handle)
        let text = try a.require("text")
        let script = """
        tell application "Messages"
          set svc to 1st account whose service type = iMessage
          set p to participant \(AppleScript.quote(target)) of svc
          send \(AppleScript.quote(text)) to p
        end tell
        """
        do {
            _ = try await AppleScript.run(script)
        } catch {
            throw ToolError("imessage_failed", "Messages could not send: \(error.localizedDescription)",
                            suggestion: "If the recipient isn't on iMessage, try whatsapp_send instead.")
        }
        return .success("iMessage sent to \(name)", data: ["to": target], verified: true, evidence: "Messages accepted the send command without error")
    }

    static let whatsapp = Tool(
        "whatsapp_send",
        "Send a WhatsApp message using the WhatsApp desktop app. 'to' is a contact name or phone number; for a WhatsApp GROUP set is_group=true and pass the group name. Verified by reading the WhatsApp window.",
        params: ["to": P.str("Contact name, phone number, or group name"), "text": P.str("Message text"), "is_group": P.bool("True if 'to' is a WhatsApp group/chat name")],
        required: ["to", "text"], risk: .high,
        title: { "Sending WhatsApp to \($0.string("to") ?? "")" }
    ) { a in
        let to = try a.require("to"), text = try a.require("text")
        try Input.ensureTrusted()
        var display = to
        if a.bool("is_group") == true {
            try await openChatBySearch(to)
            try await Task.sleep(nanoseconds: 500_000_000)
            try Input.type(text)
        } else {
            let resolved: (name: String, handle: String)
            do { resolved = try await Contacts.resolve(to, wantPhone: true) }
            catch let e as ToolError where e.code == "contact_not_found" {
                // Not in Contacts — maybe it's a WhatsApp-only chat name.
                try await openChatBySearch(to)
                try await Task.sleep(nanoseconds: 500_000_000)
                try Input.type(text)
                return try await sendAndVerify(display: to, text: text, note: "Opened via WhatsApp search (not in Contacts)")
            }
            display = resolved.name
            let phone = normalizePhone(resolved.handle)
            guard let url = URL(string: "whatsapp://send?phone=\(phone)&text=\(text.urlQueryEncoded)") else { throw ToolError("bad_url", "Bad WhatsApp URL") }
            await MainActor.run { _ = NSWorkspace.shared.open(url) }
            try await Task.sleep(nanoseconds: 2_800_000_000)
            await activate("WhatsApp")
            try await Task.sleep(nanoseconds: 600_000_000)
        }
        return try await sendAndVerify(display: display, text: text, note: nil)
    }

    static func activate(_ app: String) async {
        _ = try? await AppleScript.run("tell application \(AppleScript.quote(app)) to activate")
    }

    static func openChatBySearch(_ name: String) async throws {
        guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: "net.whatsapp.WhatsApp") != nil
                || FileManager.default.fileExists(atPath: "/Applications/WhatsApp.app") else {
            throw ToolError("whatsapp_missing", "WhatsApp desktop is not installed.")
        }
        await activate("WhatsApp")
        try await Task.sleep(nanoseconds: 1_200_000_000)
        try Input.press("cmd+f")
        try await Task.sleep(nanoseconds: 400_000_000)
        try Input.press("cmd+a")
        try Input.type(name)
        try await Task.sleep(nanoseconds: 1_400_000_000)
        try Input.press("down")
        try await Task.sleep(nanoseconds: 200_000_000)
        try Input.press("return")
        try await Task.sleep(nanoseconds: 1_000_000_000)
    }

    static func sendAndVerify(display: String, text: String, note: String?) async throws -> ToolResult {
        try Input.press("return")
        try await Task.sleep(nanoseconds: 1_300_000_000)
        let check = await Screen.verify(
            "This is the WhatsApp desktop app. Is a chat with “\(display)” open, and does it show an OUTGOING (sent, right-aligned) message containing “\(text.truncated(80))” that is NOT still sitting unsent in the input box at the bottom?",
            appName: "WhatsApp")
        if check.ok {
            return .success("WhatsApp sent to \(display)", verified: true, evidence: [note, "Screen check: \(check.reason)"].compactMap { $0 }.joined(separator: " · "))
        }
        return .failure("WhatsApp message to \(display) not confirmed", error: "send_not_confirmed: \(check.reason)",
                        suggestion: "Use screen_describe to see WhatsApp's state; if the text is still in the input box, call press_keys with 'return'.")
    }
}
