import Foundation

enum Risk: String { case read, write, high }

struct Args {
    let raw: [String: Any]
    init(_ raw: [String: Any]) { self.raw = raw }

    func string(_ k: String) -> String? {
        if let s = raw[k] as? String { let t = s.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? nil : t }
        if let n = raw[k] as? NSNumber { return n.stringValue }
        return nil
    }
    func require(_ k: String) throws -> String {
        guard let v = string(k) else { throw ToolError("missing_argument", "Missing required argument '\(k)'") }
        return v
    }
    func int(_ k: String) -> Int? { (raw[k] as? NSNumber)?.intValue ?? string(k).flatMap(Int.init) }
    func bool(_ k: String) -> Bool? { (raw[k] as? Bool) ?? (raw[k] as? NSNumber)?.boolValue }
    func strings(_ k: String) -> [String] {
        if let a = raw[k] as? [String] { return a.filter { !$0.isEmpty } }
        if let s = string(k) { return s.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } }
        return []
    }
}

struct ToolError: Error, LocalizedError {
    let code: String
    let message: String
    var suggestion: String?
    var data: [String: Any]?
    init(_ code: String, _ message: String, suggestion: String? = nil, data: [String: Any]? = nil) {
        self.code = code; self.message = message; self.suggestion = suggestion; self.data = data
    }
    var errorDescription: String? { message }
}

struct ToolResult {
    var ok: Bool
    var summary: String
    var data: [String: Any]? = nil
    var error: String? = nil
    var suggestion: String? = nil
    /// nil = not checked, true = post-condition confirmed, false = action ran but check failed.
    var verified: Bool? = nil
    var evidence: String? = nil

    static func success(_ summary: String, data: [String: Any]? = nil, verified: Bool? = nil, evidence: String? = nil) -> ToolResult {
        ToolResult(ok: true, summary: summary, data: data, verified: verified, evidence: evidence)
    }
    static func failure(_ summary: String, error: String, suggestion: String? = nil, data: [String: Any]? = nil) -> ToolResult {
        ToolResult(ok: false, summary: summary, data: data, error: error, suggestion: suggestion, verified: false)
    }

    /// Serialized payload returned to the model as function_call_output.
    var modelPayload: String {
        var o: [String: Any] = ["ok": ok, "summary": summary]
        if let data { o["data"] = data }
        if let error { o["error"] = error }
        if let suggestion { o["suggestion"] = suggestion }
        if let verified { o["verified"] = verified }
        if let evidence { o["verification_evidence"] = evidence }
        return JSON.string(o) ?? "{\"ok\":\(ok),\"summary\":\"\(summary)\"}"
    }
}

struct Tool {
    let name: String
    let description: String
    /// JSON-schema "properties".
    let params: [String: Any]
    let required: [String]
    let risk: Risk
    /// Human title for the timeline, e.g. "Creating reminder “Call mom”".
    let title: (Args) -> String
    let run: (Args) async throws -> ToolResult

    init(_ name: String, _ description: String, params: [String: Any] = [:], required: [String] = [], risk: Risk = .read,
         title: @escaping (Args) -> String, run: @escaping (Args) async throws -> ToolResult) {
        self.name = name; self.description = description; self.params = params
        self.required = required; self.risk = risk; self.title = title; self.run = run
    }

    var schema: [String: Any] {
        ["type": "function", "name": name, "description": description,
         "parameters": ["type": "object", "properties": params, "required": required, "additionalProperties": false] as [String: Any],
         "strict": false]
    }
}

/// Schema shorthands.
enum P {
    static func str(_ d: String) -> [String: Any] { ["type": "string", "description": d] }
    static func int(_ d: String) -> [String: Any] { ["type": "integer", "description": d] }
    static func bool(_ d: String) -> [String: Any] { ["type": "boolean", "description": d] }
    static func strArray(_ d: String) -> [String: Any] { ["type": "array", "items": ["type": "string"], "description": d] }
    static func oneOf(_ values: [String], _ d: String) -> [String: Any] { ["type": "string", "enum": values, "description": d] }
}

extension String {
    func truncated(_ n: Int) -> String { count > n ? String(prefix(n)) + "…" : self }
    var urlQueryEncoded: String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?#,")
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }
}
