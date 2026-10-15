import Foundation

enum StreamEvent {
    case created(id: String)
    case textDelta(String)
    case functionCall(callId: String, name: String, arguments: String)
    case webSearch(status: String, query: String?)
    case completed(id: String)
}

struct OpenAIError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class OpenAIClient {
    static let shared = OpenAIClient()
    private let base = URL(string: "https://api.openai.com/v1")!
    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 120
        c.timeoutIntervalForResource = 300
        return URLSession(configuration: c)
    }()

    private func request(_ path: String, body: [String: Any]) throws -> URLRequest {
        guard let key = KeyProvider.openAIKey else {
            throw OpenAIError(message: "No OpenAI API key found. Add OPENAI_API_KEY to ~/.jarvis/.env")
        }
        var r = URLRequest(url: base.appendingPathComponent(path))
        r.httpMethod = "POST"
        r.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        return r
    }

    static func reasoning(for model: String) -> [String: Any]? {
        model.hasPrefix("gpt-5") || model.hasPrefix("o") ? ["effort": "low"] : nil
    }

    /// Streams a Responses API call.
    func stream(model: String, instructions: String, input: [[String: Any]], tools: [[String: Any]],
                previousResponseId: String?) -> AsyncThrowingStream<StreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var body: [String: Any] = [
                        "model": model, "instructions": instructions, "input": input,
                        "tools": tools, "stream": true, "store": true, "parallel_tool_calls": true,
                    ]
                    if let previousResponseId { body["previous_response_id"] = previousResponseId }
                    if let r = Self.reasoning(for: model) { body["reasoning"] = r }
                    let req = try request("responses", body: body)
                    let (bytes, resp) = try await session.bytes(for: req)
                    if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
                        var data = Data()
                        for try await b in bytes { data.append(b) }
                        throw OpenAIError(message: Self.errorMessage(data, status: http.statusCode))
                    }
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let payload = String(line.dropFirst(6))
                        guard payload != "[DONE]", let ev = JSON.object(payload), let type = ev["type"] as? String else { continue }
                        switch type {
                        case "response.created":
                            if let id = (ev["response"] as? [String: Any])?["id"] as? String { continuation.yield(.created(id: id)) }
                        case "response.output_text.delta":
                            if let d = ev["delta"] as? String { continuation.yield(.textDelta(d)) }
                        case "response.output_item.done":
                            guard let item = ev["item"] as? [String: Any], let itype = item["type"] as? String else { break }
                            if itype == "function_call", let callId = item["call_id"] as? String, let name = item["name"] as? String {
                                continuation.yield(.functionCall(callId: callId, name: name, arguments: item["arguments"] as? String ?? "{}"))
                            } else if itype == "web_search_call" {
                                let q = (item["action"] as? [String: Any])?["query"] as? String
                                continuation.yield(.webSearch(status: "completed", query: q))
                            }
                        case "response.web_search_call.in_progress":
                            continuation.yield(.webSearch(status: "searching", query: nil))
                        case "response.completed":
                            if let id = (ev["response"] as? [String: Any])?["id"] as? String { continuation.yield(.completed(id: id)) }
                        case "response.failed", "error":
                            let msg = ((ev["response"] as? [String: Any])?["error"] as? [String: Any])?["message"] as? String
                                ?? (ev["error"] as? [String: Any])?["message"] as? String
                                ?? ev["message"] as? String ?? "The model request failed."
                            throw OpenAIError(message: msg)
                        default: break
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Single non-streaming call returning output text. Optional PNG image for vision.
    func complete(_ prompt: String, model: String = Config.fastModel, imagePNG: Data? = nil, instructions: String? = nil) async throws -> String {
        var content: [[String: Any]] = [["type": "input_text", "text": prompt]]
        if let imagePNG {
            content.append(["type": "input_image", "image_url": "data:image/png;base64,\(imagePNG.base64EncodedString())", "detail": "high"])
        }
        var body: [String: Any] = ["model": model, "input": [["role": "user", "content": content]], "store": false]
        if let instructions { body["instructions"] = instructions }
        if let r = Self.reasoning(for: model) { body["reasoning"] = r }
        let (data, resp) = try await session.data(for: try request("responses", body: body))
        if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
            throw OpenAIError(message: Self.errorMessage(data, status: http.statusCode))
        }
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let output = obj["output"] as? [[String: Any]] else { throw OpenAIError(message: "Unreadable model response") }
        var text = ""
        for item in output where item["type"] as? String == "message" {
            for c in item["content"] as? [[String: Any]] ?? [] { text += c["text"] as? String ?? "" }
        }
        return text
    }

    /// Asks the fast model for a JSON object.
    func judge(_ prompt: String, imagePNG: Data? = nil) async throws -> [String: Any] {
        let text = try await complete(prompt + "\n\nRespond with ONLY a JSON object.", imagePNG: imagePNG)
        let cleaned = text.replacingOccurrences(of: "```json", with: "").replacingOccurrences(of: "```", with: "")
        if let s = cleaned.firstIndex(of: "{"), let e = cleaned.lastIndex(of: "}"), let o = JSON.object(String(cleaned[s...e])) {
            return o
        }
        throw OpenAIError(message: "Judge returned non-JSON: \(text.truncated(200))")
    }

    private static func errorMessage(_ data: Data, status: Int) -> String {
        if let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let e = o["error"] as? [String: Any], let m = e["message"] as? String { return "OpenAI \(status): \(m)" }
        return "OpenAI HTTP \(status)"
    }
}
