import Foundation
import EventKit
import Contacts

// MARK: - EventKit (Apple Calendar + Reminders, synced to iPhone through iCloud)

final class EventKitConnector {
    static let shared = EventKitConnector()
    let store = EKEventStore()

    func ensureEvents() async throws {
        if EKEventStore.authorizationStatus(for: .event) == .fullAccess { return }
        let ok = try await store.requestFullAccessToEvents()
        guard ok else { throw ToolError("permission_denied", "Calendar access is not granted.", suggestion: "Ask the user to allow Calendars for Jarvis in System Settings → Privacy & Security → Calendars.") }
    }

    func ensureReminders() async throws {
        if EKEventStore.authorizationStatus(for: .reminder) == .fullAccess { return }
        let ok = try await store.requestFullAccessToReminders()
        guard ok else { throw ToolError("permission_denied", "Reminders access is not granted.", suggestion: "Ask the user to allow Reminders for Jarvis in System Settings → Privacy & Security → Reminders.") }
    }

    func reminderList(named name: String?) -> EKCalendar? {
        if let name, let c = store.calendars(for: .reminder).first(where: { $0.title.lowercased() == name.lowercased() }) { return c }
        return store.defaultCalendarForNewReminders()
    }

    func eventCalendar(named name: String?) -> EKCalendar? {
        if let name, let c = store.calendars(for: .event).first(where: { $0.title.lowercased() == name.lowercased() && $0.allowsContentModifications }) { return c }
        return store.defaultCalendarForNewEvents
    }

    func fetchReminders(_ predicate: NSPredicate) async -> [EKReminder] {
        await withCheckedContinuation { cont in
            store.fetchReminders(matching: predicate) { cont.resume(returning: $0 ?? []) }
        }
    }

    func describe(_ r: EKReminder) -> [String: Any] {
        var o: [String: Any] = ["id": r.calendarItemIdentifier, "title": r.title ?? "", "list": r.calendar.title, "completed": r.isCompleted]
        if let d = r.dueDateComponents?.date { o["due"] = Dates.local(d) }
        if let n = r.notes, !n.isEmpty { o["notes"] = n.truncated(200) }
        if r.priority > 0 { o["priority"] = r.priority }
        return o
    }

    func describe(_ e: EKEvent) -> [String: Any] {
        var o: [String: Any] = ["id": e.eventIdentifier ?? "", "title": e.title ?? "", "start": Dates.local(e.startDate),
                                "end": Dates.local(e.endDate), "calendar": e.calendar.title, "all_day": e.isAllDay]
        if let l = e.location, !l.isEmpty { o["location"] = l }
        if let n = e.notes, !n.isEmpty { o["notes"] = n.truncated(300) }
        if let u = e.url { o["url"] = u.absoluteString }
        if let a = e.attendees, !a.isEmpty { o["attendees"] = a.compactMap { $0.name ?? $0.url.absoluteString } }
        let meet = [e.notes, e.location, e.url?.absoluteString].compactMap { $0 }.joined(separator: " ")
        if let r = meet.range(of: #"https://meet\.google\.com/[a-z\-]+"#, options: .regularExpression) { o["meet_link"] = String(meet[r]) }
        return o
    }
}

enum AppleTools {
    static var ek: EventKitConnector { .shared }

    static var all: [Tool] { [remindersCreate, remindersList, remindersComplete, calendarList, calendarCreate, calendarUpdate, calendarDelete, contactsSearch] }

    static let remindersCreate = Tool(
        "reminders_create",
        "Create an Apple Reminder (syncs to the user's iPhone/Watch). Use for to-dos and 'remind me' requests.",
        params: ["title": P.str("Reminder text"), "due": P.str("Local ISO8601 datetime, e.g. 2026-10-15T18:00:00. Omit if no time."),
                 "notes": P.str("Optional notes"), "list": P.str("Optional reminder list name"), "priority": P.oneOf(["none", "low", "medium", "high"], "Priority")],
        required: ["title"], risk: .write,
        title: { "Creating reminder “\($0.string("title") ?? "")”" }
    ) { a in
        try await ek.ensureReminders()
        let r = EKReminder(eventStore: ek.store)
        r.title = try a.require("title")
        r.notes = a.string("notes")
        guard let cal = ek.reminderList(named: a.string("list")) else { throw ToolError("no_list", "No reminders list available.") }
        r.calendar = cal
        if let due = Dates.parse(a.string("due")) {
            r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
            r.addAlarm(EKAlarm(absoluteDate: due))
        }
        r.priority = ["high": 1, "medium": 5, "low": 9][a.string("priority") ?? ""] ?? 0
        try ek.store.save(r, commit: true)
        let check = ek.store.calendarItem(withIdentifier: r.calendarItemIdentifier) as? EKReminder
        let when = r.dueDateComponents?.date.map { " for \(Dates.human($0))" } ?? ""
        return .success("Reminder “\(r.title ?? "")” added to \(cal.title)\(when)", data: ek.describe(r),
                        verified: check != nil, evidence: check != nil ? "Re-read reminder from Reminders store" : "Reminder not found after save")
    }

    static let remindersList = Tool(
        "reminders_list", "List the user's open (incomplete) reminders, optionally only those due before a date.",
        params: ["due_before": P.str("Optional local ISO8601 datetime"), "list": P.str("Optional list name"), "include_completed": P.bool("Include completed ones")],
        title: { _ in "Checking Reminders" }
    ) { a in
        try await ek.ensureReminders()
        let cals = a.string("list").flatMap { n in ek.store.calendars(for: .reminder).filter { $0.title.lowercased() == n.lowercased() } }
        let pred = a.bool("include_completed") == true
            ? ek.store.predicateForReminders(in: cals)
            : ek.store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: Dates.parse(a.string("due_before")), calendars: cals)
        let items = await ek.fetchReminders(pred)
            .sorted { ($0.dueDateComponents?.date ?? .distantFuture) < ($1.dueDateComponents?.date ?? .distantFuture) }
        return .success("Found \(items.count) reminder\(items.count == 1 ? "" : "s")",
                        data: ["reminders": items.prefix(60).map(ek.describe), "lists": ek.store.calendars(for: .reminder).map(\.title)])
    }

    static let remindersComplete = Tool(
        "reminders_complete", "Mark a reminder as done, by id or by (partial) title.",
        params: ["id": P.str("Reminder id from reminders_list"), "title": P.str("Title text to match if no id")],
        risk: .write, title: { "Completing reminder “\($0.string("title") ?? $0.string("id") ?? "")”" }
    ) { a in
        try await ek.ensureReminders()
        var target: EKReminder?
        if let id = a.string("id") { target = ek.store.calendarItem(withIdentifier: id) as? EKReminder }
        if target == nil, let t = a.string("title")?.lowercased() {
            target = await ek.fetchReminders(ek.store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil))
                .first { ($0.title ?? "").lowercased().contains(t) }
        }
        guard let r = target else { throw ToolError("not_found", "No matching open reminder.", suggestion: "Call reminders_list to see exact titles.") }
        r.isCompleted = true
        try ek.store.save(r, commit: true)
        let done = (ek.store.calendarItem(withIdentifier: r.calendarItemIdentifier) as? EKReminder)?.isCompleted == true
        return .success("Completed “\(r.title ?? "")”", verified: done, evidence: "Reminder re-read, completed=\(done)")
    }

    static let calendarList = Tool(
        "calendar_list",
        "List events from the Mac's Calendar app (iCloud, and Google/Exchange accounts if added in macOS). Defaults to today.",
        params: ["start": P.str("Local ISO8601 start (default: start of today)"), "end": P.str("Local ISO8601 end (default: end of start day)")],
        title: { _ in "Reading your calendar" }
    ) { a in
        try await ek.ensureEvents()
        let start = Dates.parse(a.string("start")) ?? Calendar.current.startOfDay(for: Date())
        let end = Dates.parse(a.string("end")) ?? Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: start))!
        let events = ek.store.events(matching: ek.store.predicateForEvents(withStart: start, end: end, calendars: nil))
            .sorted { $0.startDate < $1.startDate }
        return .success("\(events.count) event\(events.count == 1 ? "" : "s") between \(Dates.human(start)) and \(Dates.human(end))",
                        data: ["events": events.prefix(80).map(ek.describe), "calendars": ek.store.calendars(for: .event).map(\.title)])
    }

    static let calendarCreate = Tool(
        "calendar_create",
        "Create an event in the Mac Calendar app (iCloud). For Google Meet meetings with invites prefer gcal_create_event.",
        params: ["title": P.str("Event title"), "start": P.str("Local ISO8601 start"), "end": P.str("Local ISO8601 end (optional)"),
                 "duration_minutes": P.int("Used when end is omitted, default 30"), "location": P.str("Location or link"),
                 "notes": P.str("Notes"), "calendar": P.str("Calendar name (optional)"), "url": P.str("URL (optional)")],
        required: ["title", "start"], risk: .write,
        title: { "Adding “\($0.string("title") ?? "")” to Calendar" }
    ) { a in
        try await ek.ensureEvents()
        guard let start = Dates.parse(a.string("start")) else { throw ToolError("bad_date", "Could not parse start date '\(a.string("start") ?? "")'") }
        let e = EKEvent(eventStore: ek.store)
        e.title = try a.require("title")
        e.startDate = start
        e.endDate = Dates.parse(a.string("end")) ?? start.addingTimeInterval(Double(a.int("duration_minutes") ?? 30) * 60)
        e.location = a.string("location")
        e.notes = a.string("notes")
        if let u = a.string("url") { e.url = URL(string: u) }
        guard let cal = ek.eventCalendar(named: a.string("calendar")) else { throw ToolError("no_calendar", "No writable calendar.") }
        e.calendar = cal
        e.addAlarm(EKAlarm(relativeOffset: -600))
        try ek.store.save(e, span: .thisEvent, commit: true)
        let check = e.eventIdentifier.flatMap { ek.store.event(withIdentifier: $0) }
        return .success("“\(e.title ?? "")” on \(Dates.human(start)) added to \(cal.title)", data: ek.describe(e),
                        verified: check != nil, evidence: "Event re-read from Calendar store")
    }

    static let calendarUpdate = Tool(
        "calendar_update", "Reschedule or rename an Apple Calendar event by id (from calendar_list).",
        params: ["id": P.str("Event id"), "title": P.str("New title"), "start": P.str("New local ISO8601 start"),
                 "end": P.str("New local ISO8601 end"), "location": P.str("New location")],
        required: ["id"], risk: .write, title: { _ in "Updating calendar event" }
    ) { a in
        try await ek.ensureEvents()
        guard let e = ek.store.event(withIdentifier: try a.require("id")) else { throw ToolError("not_found", "Event not found.", suggestion: "Call calendar_list for valid ids.") }
        let duration = e.endDate.timeIntervalSince(e.startDate)
        if let t = a.string("title") { e.title = t }
        if let s = Dates.parse(a.string("start")) { e.startDate = s; e.endDate = s.addingTimeInterval(duration) }
        if let en = Dates.parse(a.string("end")) { e.endDate = en }
        if let l = a.string("location") { e.location = l }
        try ek.store.save(e, span: .thisEvent, commit: true)
        return .success("Updated “\(e.title ?? "")” → \(Dates.human(e.startDate))", data: ek.describe(e), verified: true, evidence: "Saved to Calendar store")
    }

    static let calendarDelete = Tool(
        "calendar_delete", "Delete an Apple Calendar event by id.", params: ["id": P.str("Event id")],
        required: ["id"], risk: .high, title: { _ in "Deleting calendar event" }
    ) { a in
        try await ek.ensureEvents()
        let id = try a.require("id")
        guard let e = ek.store.event(withIdentifier: id) else { throw ToolError("not_found", "Event not found.") }
        let t = e.title ?? ""
        try ek.store.remove(e, span: .thisEvent, commit: true)
        return .success("Deleted “\(t)”", verified: ek.store.event(withIdentifier: id) == nil, evidence: "Event no longer in store")
    }

    // MARK: Contacts

    static let contactsSearch = Tool(
        "contacts_search",
        "Look up a person in the user's Contacts to get phone numbers and emails. ALWAYS call this before messaging, emailing or inviting someone by name.",
        params: ["name": P.str("Name, nickname or relation (e.g. 'Priya', 'Mom')")], required: ["name"],
        title: { "Finding “\($0.string("name") ?? "")” in Contacts" }
    ) { a in
        let name = try a.require("name")
        let matches = try await Contacts.search(name)
        if matches.isEmpty {
            let near = try await Contacts.suggestions(name)
            throw ToolError("contact_not_found", "No contact named “\(name)”.",
                            suggestion: near.isEmpty ? "Ask the user for the phone number or email." : "Ask the user whether they meant: \(near.joined(separator: ", ")).",
                            data: ["did_you_mean": near])
        }
        let first = matches[0]["name"] as? String ?? name
        return .success(matches.count == 1 ? "Found \(first)" : "Found \(matches.count) matches for “\(name)”", data: ["contacts": matches])
    }
}

enum Contacts {
    static let store = CNContactStore()
    static let keys: [CNKeyDescriptor] = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactNicknameKey, CNContactOrganizationNameKey,
                                          CNContactPhoneNumbersKey, CNContactEmailAddressesKey, CNContactRelationsKey] as [CNKeyDescriptor]

    static func ensure() async throws {
        if CNContactStore.authorizationStatus(for: .contacts) == .authorized { return }
        let ok = try await store.requestAccess(for: .contacts)
        guard ok else { throw ToolError("permission_denied", "Contacts access not granted.", suggestion: "Ask the user to allow Contacts for Jarvis in System Settings.") }
    }

    static func describe(_ c: CNContact) -> [String: Any] {
        let name = [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ")
        return ["name": name.isEmpty ? c.organizationName : name,
                "nickname": c.nickname,
                "phones": c.phoneNumbers.map { ["label": CNLabeledValue<NSString>.localizedString(forLabel: $0.label ?? ""), "number": $0.value.stringValue] },
                "emails": c.emailAddresses.map { $0.value as String }]
    }

    static func all() throws -> [CNContact] {
        var out: [CNContact] = []
        try store.enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) { c, _ in out.append(c) }
        return out
    }

    static func search(_ query: String) async throws -> [[String: Any]] {
        try await ensure()
        let q = query.lowercased()
        var found = try store.unifiedContacts(matching: CNContact.predicateForContacts(matchingName: query), keysToFetch: keys)
        if found.isEmpty {
            found = try all().filter { c in
                c.nickname.lowercased() == q || "\(c.givenName) \(c.familyName)".lowercased().contains(q)
                    || c.contactRelations.contains { $0.value.name.lowercased() == q }
            }
        }
        return found.prefix(8).map(describe)
    }

    static func suggestions(_ query: String) async throws -> [String] {
        try await ensure()
        let q = query.lowercased()
        return try all().map { c -> (String, Int) in
            let n = [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ")
            let d = min(levenshtein(q, c.givenName.lowercased()), levenshtein(q, n.lowercased()))
            return (n, d)
        }
        .filter { !$0.0.isEmpty && $0.1 <= max(2, q.count / 2) }
        .sorted { $0.1 < $1.1 }.prefix(3).map(\.0)
    }

    /// Resolves a name or raw handle to a phone number / email.
    static func resolve(_ who: String, wantPhone: Bool) async throws -> (name: String, handle: String) {
        let digits = who.filter { $0.isNumber || $0 == "+" }
        if digits.filter(\.isNumber).count >= 7 { return (who, digits) }
        if who.contains("@") { return (who, who) }
        let matches = try await search(who)
        guard let c = matches.first else {
            let near = try await suggestions(who)
            throw ToolError("contact_not_found", "No contact named “\(who)”.",
                            suggestion: near.isEmpty ? "Ask the user for the number." : "Ask the user whether they meant: \(near.joined(separator: ", ")).",
                            data: ["did_you_mean": near])
        }
        let name = c["name"] as? String ?? who
        let phones = (c["phones"] as? [[String: String]] ?? []).compactMap { $0["number"] }
        let emails = c["emails"] as? [String] ?? []
        if wantPhone, let p = phones.first { return (name, p) }
        if !wantPhone, let e = emails.first { return (name, e) }
        if let any = phones.first ?? emails.first { return (name, any) }
        throw ToolError("no_handle", "\(name) has no \(wantPhone ? "phone number" : "email") in Contacts.", suggestion: "Ask the user for it.")
    }

    static func levenshtein(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        if a.isEmpty { return b.count }; if b.isEmpty { return a.count }
        var prev = Array(0...b.count)
        for i in 1...a.count {
            var cur = [i] + Array(repeating: 0, count: b.count)
            for j in 1...b.count { cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1)) }
            prev = cur
        }
        return prev[b.count]
    }
}
