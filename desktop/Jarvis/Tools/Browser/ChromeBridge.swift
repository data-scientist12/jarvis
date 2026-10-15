import Foundation

/// Drives the user's real Google Chrome (already signed in to Gmail, Calendar, etc.) via AppleScript + injected JS.
/// Requires Chrome → View → Developer → "Allow JavaScript from Apple Events".
actor ChromeBridge {
    static let shared = ChromeBridge()
    private(set) var tabId: Int?

    static let jsDisabledHint = "In Chrome, enable View → Developer → Allow JavaScript from Apple Events, then retry."

    /// Opens a URL in a new Jarvis tab (or reuses the Jarvis tab) and waits for it to load.
    @discardableResult
    func open(_ url: String, newTab: Bool = true) async throws -> Int {
        let q = AppleScript.quote(url)
        let script: String
        if !newTab, let tabId, await tabExists(tabId) {
            script = """
            tell application "Google Chrome"
              repeat with w in windows
                repeat with t in tabs of w
                  if id of t is \(tabId) then
                    set URL of t to \(q)
                    return id of t
                  end if
                end repeat
              end repeat
            end tell
            """
        } else {
            script = """
            tell application "Google Chrome"
              activate
              if (count of windows) is 0 then make new window
              tell front window
                set t to make new tab with properties {URL:\(q)}
                set active tab index to (count of tabs)
              end tell
              return id of t
            end tell
            """
        }
        let out = try await AppleScript.run(script)
        guard let id = Int(out) else { throw ToolError("chrome_error", "Chrome did not return a tab id: \(out)") }
        tabId = id
        try await waitForLoad()
        return id
    }

    func tabExists(_ id: Int) async -> Bool {
        let s = """
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if id of t is \(id) then return "yes"
            end repeat
          end repeat
          return "no"
        end tell
        """
        return (try? await AppleScript.run(s)) == "yes"
    }

    /// Uses the active tab of the front window as the Jarvis tab.
    func adoptActiveTab() async throws {
        let out = try await AppleScript.run("tell application \"Google Chrome\" to return id of active tab of front window")
        tabId = Int(out)
    }

    func waitForLoad(timeout: TimeInterval = 20) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        try await Task.sleep(nanoseconds: 400_000_000)
        while Date() < deadline {
            if let state = try? await js("document.readyState"), state == "complete" { return }
            try await Task.sleep(nanoseconds: 300_000_000)
        }
    }

    /// Executes JavaScript in the Jarvis tab and returns the result as a string.
    func js(_ code: String) async throws -> String {
        if tabId == nil || !(await tabExists(tabId!)) { try await adoptActiveTab() }
        guard let tabId else { throw ToolError("no_tab", "No Chrome tab available.", suggestion: "Call browser_open first.") }
        let script = """
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if id of t is \(tabId) then
                return execute t javascript \(AppleScript.quote(code))
              end if
            end repeat
          end repeat
          error "Jarvis tab not found"
        end tell
        """
        do {
            return try await AppleScript.run(script, timeout: 25)
        } catch let e as AppleScript.Failure {
            if e.message.lowercased().contains("javascript") && (e.message.contains("turned off") || e.message.contains("Allow JavaScript")) {
                throw ToolError("chrome_js_disabled", "Chrome blocks JavaScript from Apple Events.", suggestion: Self.jsDisabledHint)
            }
            if e.message.contains("-1743") || e.message.lowercased().contains("not authorized") {
                throw ToolError("automation_denied", "Jarvis is not allowed to control Chrome.",
                                suggestion: "Ask the user to allow Jarvis → Google Chrome in System Settings → Privacy & Security → Automation.")
            }
            throw ToolError("chrome_error", e.message)
        }
    }

    /// Runs a JS function body that returns a JSON-serialisable value; decodes the result.
    func call(_ body: String) async throws -> Any? {
        let wrapped = "(function(){ try { const __r = (function(){ \(body) })(); return JSON.stringify(__r === undefined ? null : __r); } catch(e) { return JSON.stringify({__error: String(e)}); } })()"
        let out = try await js(wrapped)
        let val = JSON.any(out)
        if let d = val as? [String: Any], let err = d["__error"] as? String { throw ToolError("js_error", err) }
        return val
    }

    func currentURL() async -> String { (try? await js("location.href")) ?? "" }
    func title() async -> String { (try? await js("document.title")) ?? "" }

    /// Polls until a JS boolean expression is true.
    func waitFor(_ expr: String, timeout: TimeInterval = 15) async throws -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let r = try? await js("(function(){ try { return !!(\(expr)) ? 'true' : 'false' } catch(e) { return 'false' } })()"), r == "true" { return true }
            try await Task.sleep(nanoseconds: 350_000_000)
        }
        return false
    }

    /// Polls a JS function body (may use JSLib.helpers) until it returns true.
    func waitUntil(_ body: String, timeout: TimeInterval = 15) async throws -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let r = try? await call(body) as? Bool, r { return true }
            try await Task.sleep(nanoseconds: 350_000_000)
        }
        return false
    }

    func activate() async {
        _ = try? await AppleScript.run("tell application \"Google Chrome\" to activate")
    }
}

/// Shared JS helpers injected per call (no persistent state needed in the page).
enum JSLib {
    /// Visible-element test + label extraction + element finder by id or text.
    static let helpers = #"""
    const __vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
    const __label = (el) => (el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.innerText || el.value ||
      el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.getAttribute('alt') || '').trim().replace(/\s+/g,' ').slice(0,90);
    const __sel = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=option],[role=combobox],[role=textbox],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
    const __find = (id, text) => {
      if (id !== null && id !== undefined && id !== '') { const e = document.querySelector('[data-jid="'+id+'"]'); if (e) return e; }
      if (text) { const t = text.toLowerCase(); const els = [...document.querySelectorAll(__sel)].filter(__vis);
        return els.find(e => __label(e).toLowerCase() === t) || els.find(e => __label(e).toLowerCase().startsWith(t)) || els.find(e => __label(e).toLowerCase().includes(t)); }
      return null; };
    const __click = (el) => { el.scrollIntoView({block:'center'}); const o = {bubbles:true,cancelable:true,view:window};
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t,o) : new MouseEvent(t,o))); };
    const __type = (el, text, clear) => { el.focus();
      if (el.isContentEditable) { if (clear) { document.execCommand('selectAll'); document.execCommand('delete'); } document.execCommand('insertText', false, text); return; }
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, (clear ? '' : el.value) + text);
      el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
    """#

    static let snapshot = helpers + #"""
    let n = 0; const items = [];
    document.querySelectorAll('[data-jid]').forEach(e => e.removeAttribute('data-jid'));
    for (const el of document.querySelectorAll(__sel)) {
      if (!__vis(el)) continue; const label = __label(el); if (!label && el.tagName !== 'INPUT' && !el.isContentEditable) continue;
      el.setAttribute('data-jid', String(n));
      const it = {id: n, tag: el.tagName.toLowerCase(), label};
      const role = el.getAttribute('role'); if (role) it.role = role;
      if (el.type && el.tagName === 'INPUT') it.type = el.type;
      if (el.isContentEditable) it.editable = true;
      if (el.href && el.tagName === 'A') it.href = el.href.slice(0,120);
      items.push(it); n++; if (n >= 160) break;
    }
    const text = (document.querySelector('main, [role=main]') || document.body).innerText.replace(/\n{3,}/g,'\n\n').slice(0, 5000);
    return {url: location.href, title: document.title, elements: items, text};
    """#
}
