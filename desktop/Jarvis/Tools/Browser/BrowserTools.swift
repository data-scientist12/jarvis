import Foundation

enum BrowserTools {
    static var chrome: ChromeBridge { .shared }
    static var all: [Tool] { [open, read, click, type, press, scroll, waitFor] }

    static let open = Tool(
        "browser_open",
        "Open a URL in the user's Google Chrome (signed in to their accounts). Use for any website task. Returns page title and URL.",
        params: ["url": P.str("Full URL"), "new_tab": P.bool("Open in a new tab (default true)")],
        required: ["url"], risk: .read, title: { "Opening \(URL(string: $0.string("url") ?? "")?.host ?? $0.string("url") ?? "") in Chrome" }
    ) { a in
        var url = try a.require("url")
        if !url.contains("://") { url = "https://" + url }
        try await chrome.open(url, newTab: a.bool("new_tab") ?? true)
        let t = await chrome.title(), u = await chrome.currentURL()
        return .success("Opened “\(t.truncated(60))”", data: ["title": t, "url": u], verified: !u.isEmpty, evidence: "Tab URL: \(u.truncated(100))")
    }

    static let read = Tool(
        "browser_read",
        "Read the current Chrome tab: returns URL, title, visible text and a numbered list of interactive elements (use their ids with browser_click / browser_type).",
        title: { _ in "Reading the page" }
    ) { _ in
        guard let snap = try await chrome.call(JSLib.snapshot) as? [String: Any] else { throw ToolError("read_failed", "Could not read page") }
        return .success("Read “\((snap["title"] as? String ?? "").truncated(50))” (\((snap["elements"] as? [Any])?.count ?? 0) elements)", data: snap)
    }

    static let click = Tool(
        "browser_click",
        "Click an element in the current Chrome tab by element id (from browser_read) or by its visible text/label.",
        params: ["id": P.int("Element id from browser_read"), "text": P.str("Visible text or aria-label to match if no id")],
        risk: .write, title: { "Clicking “\($0.string("text") ?? "element #\($0.string("id") ?? "?")")”" }
    ) { a in
        let before = await chrome.currentURL()
        let idArg = a.string("id").map { "'\($0)'" } ?? "null"
        let textArg = JSON.string([a.string("text") ?? ""]).map { String($0.dropFirst().dropLast()) } ?? "''"
        let r = try await chrome.call(JSLib.helpers + "const el = __find(\(idArg), \(textArg)); if (!el) return {found:false}; const l = __label(el); __click(el); return {found:true, label:l};") as? [String: Any]
        guard r?["found"] as? Bool == true else {
            throw ToolError("element_missing", "No element matching \(a.string("text") ?? "id " + (a.string("id") ?? "?")).", suggestion: "Call browser_read to get fresh element ids.")
        }
        try await Task.sleep(nanoseconds: 700_000_000)
        let after = await chrome.currentURL()
        return .success("Clicked “\((r?["label"] as? String ?? "").truncated(50))”", data: ["url_after": after, "navigated": after != before])
    }

    static let type = Tool(
        "browser_type",
        "Type text into an input/textarea/contenteditable in Chrome, by element id or label. Optionally press Enter to submit.",
        params: ["id": P.int("Element id from browser_read"), "label": P.str("Field label/placeholder if no id"),
                 "text": P.str("Text to type"), "submit": P.bool("Press Enter after typing"), "clear": P.bool("Clear existing text first (default true)")],
        required: ["text"], risk: .write, title: { "Typing “\(($0.string("text") ?? "").truncated(30))”" }
    ) { a in
        let text = try a.require("text")
        let idArg = a.string("id").map { "'\($0)'" } ?? "null"
        let labelArg = JSON.string([a.string("label") ?? ""]).map { String($0.dropFirst().dropLast()) } ?? "''"
        let textArg = JSON.string([text]).map { String($0.dropFirst().dropLast()) } ?? "''"
        let clear = a.bool("clear") ?? true
        let r = try await chrome.call(JSLib.helpers + """
            let el = __find(\(idArg), \(labelArg)); if (!el) el = document.activeElement;
            if (!el || el === document.body) return {found:false};
            __type(el, \(textArg), \(clear)); return {found:true, value: (el.value || el.innerText || '').slice(0,200)};
            """) as? [String: Any]
        guard r?["found"] as? Bool == true else { throw ToolError("element_missing", "Input field not found.", suggestion: "Call browser_read and pass the field's id.") }
        if a.bool("submit") == true {
            await chrome.activate()
            try await Task.sleep(nanoseconds: 250_000_000)
            try Input.press("return")
            try await Task.sleep(nanoseconds: 900_000_000)
        }
        let value = r?["value"] as? String ?? ""
        return .success("Typed into field", data: ["field_value": value], verified: value.contains(text.prefix(20)), evidence: "Field now contains: \(value.truncated(80))")
    }

    static let press = Tool(
        "browser_press",
        "Press a real key or shortcut in Chrome (e.g. 'return', 'escape', 'tab', 'cmd+enter', 'down').",
        params: ["keys": P.str("Key combo")], required: ["keys"], risk: .write, title: { "Pressing \($0.string("keys") ?? "")" }
    ) { a in
        await chrome.activate()
        try await Task.sleep(nanoseconds: 250_000_000)
        try Input.press(try a.require("keys"))
        try await Task.sleep(nanoseconds: 500_000_000)
        return .success("Pressed \(a.string("keys")!)")
    }

    static let scroll = Tool(
        "browser_scroll", "Scroll the current Chrome page.", params: ["direction": P.oneOf(["down", "up", "top", "bottom"], "Direction")],
        required: ["direction"], title: { _ in "Scrolling" }
    ) { a in
        let d = a.string("direction") ?? "down"
        let code = ["down": "scrollBy(0, innerHeight*0.8)", "up": "scrollBy(0, -innerHeight*0.8)", "top": "scrollTo(0,0)", "bottom": "scrollTo(0, document.body.scrollHeight)"][d]!
        _ = try await chrome.call(code + "; return true;")
        return .success("Scrolled \(d)")
    }

    static let waitFor = Tool(
        "browser_wait_for", "Wait until some text appears on the current Chrome page (to confirm an action worked).",
        params: ["text": P.str("Text to wait for"), "timeout_seconds": P.int("Default 10")], required: ["text"],
        title: { "Waiting for “\(($0.string("text") ?? "").truncated(30))”" }
    ) { a in
        let t = try a.require("text")
        let q = JSON.string([t.lowercased()]).map { String($0.dropFirst().dropLast()) } ?? "''"
        let ok = try await chrome.waitFor("document.body.innerText.toLowerCase().includes(\(q))", timeout: TimeInterval(a.int("timeout_seconds") ?? 10))
        return ok ? .success("“\(t)” appeared", verified: true, evidence: "Text found on page")
                  : .failure("“\(t)” did not appear", error: "timeout", suggestion: "Call browser_read to see what the page shows.")
    }
}

// MARK: - Google workflows driven through the signed-in Chrome session

enum GoogleWebTools {
    static var chrome: ChromeBridge { .shared }
    static var all: [Tool] { [gmailSend, gmailList, gmailOpen, gmailReply, gcalCreate, gcalAgenda, meetInstant] }

    static func jsString(_ s: String) -> String { JSON.string([s]).map { String($0.dropFirst().dropLast()) } ?? "''" }

    static func ensureSignedIn() async throws {
        let u = await chrome.currentURL()
        if u.contains("accounts.google.com") || u.contains("workspace.google.com") {
            throw ToolError("not_signed_in", "Chrome is not signed in to Google.", suggestion: "Ask the user to sign in to Google in Chrome once.")
        }
    }

    static let sendButtonJS = "[...document.querySelectorAll('div[role=button][data-tooltip^=\"Send\"], div[role=button][aria-label^=\"Send\"]')].filter(__vis).pop()"

    static let gmailSend = Tool(
        "gmail_send",
        "Compose and SEND an email from the user's Gmail (via Chrome). Resolve names to emails with contacts_search first. Verified by Gmail's 'Message sent' confirmation.",
        params: ["to": P.strArray("Recipient email addresses"), "subject": P.str("Subject"), "body": P.str("Plain-text body. Sign off with the user's first name."),
                 "cc": P.strArray("CC addresses")],
        required: ["to", "subject", "body"], risk: .high,
        title: { "Sending email to \($0.strings("to").joined(separator: ", "))" }
    ) { a in
        let to = a.strings("to"); guard !to.isEmpty else { throw ToolError("missing_argument", "No recipient") }
        var url = "https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1&to=\(to.joined(separator: ",").urlQueryEncoded)"
        url += "&su=\(try a.require("subject").urlQueryEncoded)&body=\(try a.require("body").urlQueryEncoded)"
        let cc = a.strings("cc"); if !cc.isEmpty { url += "&cc=\(cc.joined(separator: ",").urlQueryEncoded)" }
        try await chrome.open(url, newTab: true)
        try await ensureSignedIn()
        _ = try await chrome.waitUntil(JSLib.helpers + "return !!(\(sendButtonJS));", timeout: 20)
        let r = try await chrome.call(JSLib.helpers + "const b = \(sendButtonJS); if (!b) return false; __click(b); return true;") as? Bool
        guard r == true else {
            throw ToolError("compose_failed", "Gmail compose window did not load the Send button.", suggestion: "Call browser_read to inspect the Gmail page.")
        }
        let sent = try await chrome.waitFor("document.body.innerText.includes('Message sent') || document.body.innerText.includes('Sending')", timeout: 12)
        if !sent {
            let still = try? await chrome.call(JSLib.helpers + "return !!(\(sendButtonJS));") as? Bool
            if still == true { return .failure("Email not sent — Send button still visible", error: "send_not_confirmed", suggestion: "Call browser_read to see any Gmail error (e.g. invalid address).") }
        }
        return .success("Email “\(a.string("subject")!)” sent to \(to.joined(separator: ", "))", data: ["to": to],
                        verified: sent, evidence: sent ? "Gmail showed “Message sent”" : "Compose closed, no confirmation toast seen")
    }

    static let rowsJS = JSLib.helpers + """
        const rows = [...document.querySelectorAll('div[role=main] tr.zA')].filter(__vis);
        return rows.slice(0, MAX).map((r, i) => { r.setAttribute('data-jrow', String(i));
          const s = r.querySelector('.yW span[email], .yW span[name]');
          return {index: i, from: s ? (s.getAttribute('name') || s.innerText) : '', email: s ? s.getAttribute('email') : '',
            subject: (r.querySelector('.bog') || {}).innerText || '', snippet: ((r.querySelector('.y2') || {}).innerText || '').replace(/^\\s*-\\s*/, '').slice(0,160),
            date: (r.querySelector('.xW span, .xY span') || {}).title || '', unread: r.classList.contains('zE')}; });
        """

    static let gmailList = Tool(
        "gmail_list",
        "List emails in the user's Gmail inbox or matching a Gmail search query (e.g. 'is:unread', 'from:rahul', 'newer_than:1d is:important'). Returns indexes for gmail_open/gmail_reply.",
        params: ["query": P.str("Gmail search query; omit for inbox"), "max": P.int("Max results, default 15")],
        title: { $0.string("query").map { "Searching Gmail for “\($0)”" } ?? "Checking your inbox" }
    ) { a in
        let q = a.string("query")
        let hash = q.map { "#search/\($0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? $0)" } ?? "#inbox"
        let onGmail = (await chrome.currentURL()).contains("mail.google.com")
        try await chrome.open("https://mail.google.com/mail/u/0/\(hash)", newTab: !onGmail)
        try await ensureSignedIn()
        try await Task.sleep(nanoseconds: 1_200_000_000)
        _ = try await chrome.waitFor("[...document.querySelectorAll('div[role=main] tr.zA')].some(r => r.offsetParent) || /No (messages|conversations)|matched your search/i.test(document.body.innerText)", timeout: 15)
        let rows = try await chrome.call(rowsJS.replacingOccurrences(of: "MAX", with: String(a.int("max") ?? 15))) as? [[String: Any]] ?? []
        let unread = rows.filter { $0["unread"] as? Bool == true }.count
        return .success("\(rows.count) emails\(q.map { " for “\($0)”" } ?? " in inbox") · \(unread) unread", data: ["emails": rows])
    }

    static let openJS = JSLib.helpers + """
        const bodies = [...document.querySelectorAll('.a3s')].filter(__vis);
        const from = [...document.querySelectorAll('.gD')].pop();
        return {subject: (document.querySelector('h2.hP') || {}).innerText || '', from: from ? from.getAttribute('name') : '',
          email: from ? from.getAttribute('email') : '', date: ([...document.querySelectorAll('.g3')].pop() || {}).title || '',
          body: bodies.length ? bodies[bodies.length-1].innerText.slice(0, 5000) : '', messages_in_thread: bodies.length};
        """

    static func openRow(_ index: Int) async throws -> [String: Any] {
        let clicked = try await chrome.call(JSLib.helpers + "const r = document.querySelector('[data-jrow=\"\(index)\"]'); if (!r) return false; __click(r); return true;") as? Bool
        guard clicked == true else { throw ToolError("email_not_found", "Email #\(index) is not on screen.", suggestion: "Call gmail_list first, then use its index.") }
        guard try await chrome.waitFor("document.querySelector('h2.hP') && document.querySelector('.a3s')", timeout: 12) else {
            throw ToolError("open_failed", "The email did not open.")
        }
        try await Task.sleep(nanoseconds: 300_000_000)
        return try await chrome.call(openJS) as? [String: Any] ?? [:]
    }

    static let gmailOpen = Tool(
        "gmail_open", "Open and read an email from the last gmail_list results by its index. Returns sender, subject and full body.",
        params: ["index": P.int("Index from gmail_list")], required: ["index"],
        title: { "Opening email #\($0.int("index") ?? 0)" }
    ) { a in
        let m = try await openRow(a.int("index") ?? 0)
        return .success("Read “\((m["subject"] as? String ?? "").truncated(50))” from \(m["from"] as? String ?? "")", data: m)
    }

    static let gmailReply = Tool(
        "gmail_reply",
        "Reply to an email in Gmail. Use the index from gmail_list (opens it) or omit index to reply to the currently open email.",
        params: ["index": P.int("Index from gmail_list (optional if an email is open)"), "body": P.str("Reply text, signed with the user's first name")],
        required: ["body"], risk: .high, title: { _ in "Replying in Gmail" }
    ) { a in
        var subject = ""
        if let i = a.int("index") { subject = (try await openRow(i))["subject"] as? String ?? "" }
        else { subject = (try await chrome.call(openJS) as? [String: Any])?["subject"] as? String ?? "" }
        let clicked = try await chrome.call(JSLib.helpers + """
            const b = [...document.querySelectorAll('[role=button][data-tooltip="Reply"], [role=button][aria-label="Reply"], span.ams.bkH')].filter(__vis).pop();
            if (!b) return false; __click(b); return true;
            """) as? Bool
        guard clicked == true else { throw ToolError("reply_button_missing", "Couldn't find Gmail's Reply button.", suggestion: "Call browser_read and click Reply manually.") }
        guard try await chrome.waitFor("[...document.querySelectorAll('div[aria-label=\"Message Body\"][contenteditable=true]')].some(e => e.offsetParent)", timeout: 10) else {
            throw ToolError("reply_box_missing", "Reply box did not open.")
        }
        _ = try await chrome.call(JSLib.helpers + "const box = [...document.querySelectorAll('div[aria-label=\"Message Body\"][contenteditable=true]')].filter(__vis).pop(); __type(box, \(jsString(try a.require("body"))), false); return true;")
        try await Task.sleep(nanoseconds: 400_000_000)
        let sentClick = try await chrome.call(JSLib.helpers + "const b = \(sendButtonJS); if (!b) return false; __click(b); return true;") as? Bool
        guard sentClick == true else { throw ToolError("send_button_missing", "Send button not found in reply.") }
        let sent = try await chrome.waitFor("document.body.innerText.includes('Message sent')", timeout: 12)
        return sent ? .success("Replied to “\(subject.truncated(50))”", verified: true, evidence: "Gmail showed “Message sent”")
                    : .failure("Reply may not have been sent", error: "send_not_confirmed", suggestion: "Call browser_read to check the reply box.")
    }

    static let meetJS = "(() => { const m = (document.body.innerText + ' ' + [...document.querySelectorAll('a[href*=\"meet.google.com\"]')].map(a=>a.href).join(' ')).match(/meet\\.google\\.com\\/[a-z]{3}-[a-z]{4}-[a-z]{3}/); return m ? 'https://' + m[0] : ''; })()"

    static let gcalCreate = Tool(
        "gcal_create_event",
        "Schedule an event in the user's GOOGLE Calendar (via Chrome), by default with a Google Meet link, and send invites to guests. Returns the Meet link. Resolve guest names to emails with contacts_search first.",
        params: ["title": P.str("Event title"), "start": P.str("Local ISO8601 start"), "end": P.str("Local ISO8601 end (optional)"),
                 "duration_minutes": P.int("Default 30"), "guests": P.strArray("Guest email addresses"), "description": P.str("Agenda/description"),
                 "location": P.str("Location"), "add_meet": P.bool("Add a Google Meet link (default true)")],
        required: ["title", "start"], risk: .high,
        title: { "Scheduling “\($0.string("title") ?? "")” in Google Calendar" }
    ) { a in
        guard let start = Dates.parse(a.string("start")) else { throw ToolError("bad_date", "Could not parse start '\(a.string("start") ?? "")'") }
        let end = Dates.parse(a.string("end")) ?? start.addingTimeInterval(Double(a.int("duration_minutes") ?? 30) * 60)
        let guests = a.strings("guests")
        var url = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=\(try a.require("title").urlQueryEncoded)"
        url += "&dates=\(Dates.googleUTC(start))/\(Dates.googleUTC(end))&ctz=\(TimeZone.current.identifier.urlQueryEncoded)"
        if let d = a.string("description") { url += "&details=\(d.urlQueryEncoded)" }
        if let l = a.string("location") { url += "&location=\(l.urlQueryEncoded)" }
        if !guests.isEmpty { url += "&add=\(guests.joined(separator: ",").urlQueryEncoded)" }
        try await chrome.open(url, newTab: true)
        try await ensureSignedIn()
        guard try await chrome.waitUntil(JSLib.helpers + "return !!(document.querySelector('#xSaveBu') || __find(null, 'Save'));", timeout: 20) else {
            throw ToolError("editor_not_loaded", "Google Calendar event editor did not load.", suggestion: "Call browser_read to inspect the page.")
        }
        try await Task.sleep(nanoseconds: 800_000_000)

        // Guests: add any the URL parameter didn't pick up.
        for g in guests {
            let present = try await chrome.call("return document.body.innerText.toLowerCase().includes(\(jsString(g.lowercased())));") as? Bool ?? false
            if present { continue }
            let typed = try await chrome.call(JSLib.helpers + "const i = [...document.querySelectorAll('input[aria-label*=\"guests\" i], input[placeholder*=\"guests\" i]')].filter(__vis)[0]; if (!i) return false; __type(i, \(jsString(g)), true); return true;") as? Bool
            if typed == true { await chrome.activate(); try await Task.sleep(nanoseconds: 300_000_000); try Input.press("return"); try await Task.sleep(nanoseconds: 500_000_000) }
        }

        var meet = ""
        if a.bool("add_meet") ?? true {
            _ = try await chrome.call(JSLib.helpers + "const b = __find(null, 'Add Google Meet video conferencing') || __find(null, 'Google Meet'); if (b) __click(b); return !!b;")
            _ = try await chrome.waitFor("/meet\\.google\\.com\\/[a-z]{3}-/.test(document.body.innerText + [...document.querySelectorAll('a')].map(a=>a.href).join(' '))", timeout: 10)
            meet = (try? await chrome.js(meetJS)) ?? ""
        }

        let saved = try await chrome.call(JSLib.helpers + "const b = document.querySelector('#xSaveBu') || __find(null, 'Save'); if (!b) return false; __click(b); return true;") as? Bool
        guard saved == true else { throw ToolError("save_missing", "Couldn't find the Save button.", suggestion: "Call browser_read and click Save.") }
        // "Send invitation emails?" dialog
        if try await chrome.waitUntil(JSLib.helpers + "return [...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].some(b => /^send$/i.test(__label(b)));", timeout: 4) {
            _ = try await chrome.call(JSLib.helpers + "const b = [...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].find(b => /^send$/i.test(__label(b))); if (b) __click(b); return !!b;")
        }
        let left = try await chrome.waitFor("!location.href.includes('eventedit') && !location.href.includes('action=TEMPLATE')", timeout: 10)
        var data: [String: Any] = ["title": a.string("title")!, "start": Dates.local(start), "end": Dates.local(end), "guests": guests]
        if !meet.isEmpty { data["meet_link"] = meet }
        guard left else {
            return .failure("Event editor is still open — save may have failed", error: "save_not_confirmed", suggestion: "Call browser_read to look for an error on the page.", data: data)
        }
        return .success("“\(a.string("title")!)” scheduled \(Dates.human(start))\(meet.isEmpty ? "" : " with Meet")\(guests.isEmpty ? "" : ", invites sent")",
                        data: data, verified: true, evidence: "Google Calendar closed the editor after Save\(meet.isEmpty ? "" : "; Meet link \(meet)")")
    }

    static let gcalAgenda = Tool(
        "gcal_agenda", "Read the user's Google Calendar agenda (via Chrome) starting from a date. Use for 'what's on my calendar' when Apple Calendar has no Google account.",
        params: ["date": P.str("Local date yyyy-MM-dd, default today")], title: { _ in "Reading Google Calendar" }
    ) { a in
        let d = Dates.parse(a.string("date")) ?? Date()
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        let onCal = (await chrome.currentURL()).contains("calendar.google.com")
        try await chrome.open("https://calendar.google.com/calendar/r/agenda/\(c.year!)/\(c.month!)/\(c.day!)", newTab: !onCal)
        try await ensureSignedIn()
        _ = try await chrome.waitFor("document.querySelector('[role=main]') && document.querySelector('[role=main]').innerText.length > 50", timeout: 12)
        let text = try await chrome.js("(document.querySelector('[role=main]') || document.body).innerText.slice(0, 5000)")
        return .success("Read Google Calendar agenda", data: ["agenda_text": text])
    }

    static let meetInstant = Tool(
        "meet_instant", "Start an instant Google Meet right now in Chrome and return its link (e.g. to share with people).",
        risk: .write, title: { _ in "Starting a Google Meet" }
    ) { _ in
        try await chrome.open("https://meet.google.com/new", newTab: true)
        try await ensureSignedIn()
        let ok = try await chrome.waitFor("/meet\\.google\\.com\\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(location.href)", timeout: 20)
        let url = await chrome.currentURL()
        guard ok else { return .failure("Meet did not create a meeting room", error: "meet_failed", suggestion: "Check that Chrome is signed in to Google.") }
        let link = url.components(separatedBy: "?").first ?? url
        return .success("Meet ready: \(link)", data: ["meet_link": link], verified: true, evidence: "Chrome is on \(link)")
    }
}
