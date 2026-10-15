import Foundation

struct ShellResult {
    let stdout: String
    let stderr: String
    let status: Int32
    let timedOut: Bool
    var ok: Bool { status == 0 && !timedOut }
}

enum Shell {
    /// Runs a process synchronously with a timeout. Call from a background context.
    @discardableResult
    static func run(_ path: String, _ args: [String], stdin: String? = nil, timeout: TimeInterval = 30) -> ShellResult {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        let inPipe = Pipe()
        if stdin != nil { p.standardInput = inPipe } else { p.standardInput = FileHandle.nullDevice }

        var outData = Data(), errData = Data()
        let group = DispatchGroup()
        group.enter(); group.enter()
        DispatchQueue.global().async { outData = out.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        DispatchQueue.global().async { errData = err.fileHandleForReading.readDataToEndOfFile(); group.leave() }

        do { try p.run() } catch {
            return ShellResult(stdout: "", stderr: error.localizedDescription, status: -1, timedOut: false)
        }
        if let stdin {
            inPipe.fileHandleForWriting.write(stdin.data(using: .utf8)!)
            try? inPipe.fileHandleForWriting.close()
        }
        let deadline = Date().addingTimeInterval(timeout)
        var timedOut = false
        while p.isRunning {
            if Date() > deadline { p.terminate(); timedOut = true; break }
            usleep(20_000)
        }
        _ = group.wait(timeout: .now() + 2)
        return ShellResult(stdout: String(data: outData, encoding: .utf8) ?? "",
                           stderr: String(data: errData, encoding: .utf8) ?? "",
                           status: p.terminationStatus, timedOut: timedOut)
    }

    static func runAsync(_ path: String, _ args: [String], stdin: String? = nil, timeout: TimeInterval = 30) async -> ShellResult {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                cont.resume(returning: run(path, args, stdin: stdin, timeout: timeout))
            }
        }
    }

    static func zsh(_ command: String, timeout: TimeInterval = 30) async -> ShellResult {
        await runAsync("/bin/zsh", ["-lc", command], timeout: timeout)
    }
}

enum AppleScript {
    struct Failure: Error, LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// Runs AppleScript through osascript (off the main thread). Returns stdout or throws with stderr.
    static func run(_ source: String, timeout: TimeInterval = 30) async throws -> String {
        let r = await Shell.runAsync("/usr/bin/osascript", ["-"], stdin: source, timeout: timeout)
        if r.timedOut { throw Failure(message: "AppleScript timed out after \(Int(timeout))s") }
        if r.status != 0 {
            throw Failure(message: r.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return r.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Escapes a Swift string for use inside an AppleScript string literal.
    static func quote(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }
}

enum Dates {
    static let tz = TimeZone.current

    /// Accepts ISO8601 with or without timezone, or "yyyy-MM-dd HH:mm", or a bare date.
    static func parse(_ s: String?) -> Date? {
        guard var s = s?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: s) { return d }
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: s) { return d }
        s = s.replacingOccurrences(of: "Z", with: "")
        for f in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"] {
            let df = DateFormatter()
            df.locale = Locale(identifier: "en_US_POSIX")
            df.timeZone = tz
            df.dateFormat = f
            if let d = df.date(from: s) { return d }
        }
        return nil
    }

    static func local(_ d: Date) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = tz
        df.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return df.string(from: d)
    }

    static func human(_ d: Date) -> String {
        let df = DateFormatter()
        df.dateFormat = Calendar.current.isDateInToday(d) ? "'today' h:mm a"
            : Calendar.current.isDateInTomorrow(d) ? "'tomorrow' h:mm a" : "EEE d MMM, h:mm a"
        return df.string(from: d)
    }

    static func googleUTC(_ d: Date) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(identifier: "UTC")
        df.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return df.string(from: d)
    }
}
