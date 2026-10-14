import SwiftUI
import WebKit
import HealthKit
import UserNotifications

private let appBackground = UIColor(red: 17/255, green: 21/255, blue: 28/255, alpha: 1)

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Bridge.shared.migrate()
        Bridge.shared.startBackgroundHealth()
        return true
    }
}

@main
struct TrendlineApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            WebView()
                .ignoresSafeArea()
                .background(Color(appBackground))
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Bridge.shared.foreground() }
        }
    }
}

/// Connects the web interface to native storage, backups, Apple Health,
/// reminders and the share sheet.
final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let shared = Bridge()
    weak var webView: WKWebView?

    private let fm = FileManager.default
    private let health = HKHealthStore()
    private let massType = HKQuantityType.quantityType(forIdentifier: .bodyMass)!
    private let fatType = HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage)!
    private let leanType = HKQuantityType.quantityType(forIdentifier: .leanBodyMass)!
    private var readTypes: Set<HKObjectType> { [massType, fatType, leanType] }
    private var observing = false
    private let stateLock = NSLock()
    private let backupQueue = DispatchQueue(label: "trendline.backup")

    // MARK: Files

    private var documents: URL { fm.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private var support: URL {
        let url = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? fm.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    var stateURL: URL { support.appendingPathComponent("trendline-state.json") }
    private var backupsDir: URL {
        let url = documents.appendingPathComponent("Backups", isDirectory: true)
        try? fm.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// Version 1.0 kept its data in Documents; move it out of sight of the Files app.
    func migrate() {
        let old = documents.appendingPathComponent("trendline-state.json")
        guard fm.fileExists(atPath: old.path) else { return }
        if fm.fileExists(atPath: stateURL.path) { try? fm.removeItem(at: old) }
        else { try? fm.moveItem(at: old, to: stateURL) }
    }

    func loadState() -> String? {
        stateLock.lock(); defer { stateLock.unlock() }
        return try? String(contentsOf: stateURL, encoding: .utf8)
    }

    private func store(_ json: String) {
        let data = Data(json.utf8)
        stateLock.lock()
        try? data.write(to: stateURL, options: .atomic)
        stateLock.unlock()
        backupQueue.async { self.writeBackups(data) }
    }

    /// Hands the page the saved state (it may have changed in the background), then refreshes.
    func foreground() {
        if let json = loadState() { send("state", ["json": json]) }
        send("foreground", [:])
    }

    /// Keeps a "latest" copy plus one dated copy per week (the newest 8).
    private func writeBackups(_ data: Data) {
        let dir = backupsDir
        try? data.write(to: dir.appendingPathComponent("trendline-latest.json"), options: .atomic)
        let dated = datedBackups()
        let weekAgo = Date().addingTimeInterval(-7 * 86400)
        if let newest = dated.last, let made = modified(newest), made > weekAgo {
            // a weekly copy already exists
        } else {
            try? data.write(to: dir.appendingPathComponent("trendline-\(Bridge.day(Date())).json"), options: .atomic)
        }
        let all = datedBackups()
        if all.count > 8 { all.prefix(all.count - 8).forEach { try? fm.removeItem(at: $0) } }
    }

    private func datedBackups() -> [URL] {
        let items = (try? fm.contentsOfDirectory(at: backupsDir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        return items.filter { $0.lastPathComponent.hasPrefix("trendline-20") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    private func modified(_ url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }

    private func backupInfo() {
        backupQueue.async {
            let latest = self.backupsDir.appendingPathComponent("trendline-latest.json")
            var info: [String: Any] = ["count": self.datedBackups().count]
            if let date = self.modified(latest) { info["last"] = ISO8601DateFormatter().string(from: date) }
            self.send("backup-info", info)
        }
    }

    // MARK: Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "store":
            if let json = message.body as? String { store(json) }
        case "share":
            if let body = message.body as? [String: Any],
               let name = body["name"] as? String, let text = body["text"] as? String {
                share(name: name, text: text)
            }
        case "native":
            guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
            handle(cmd, body)
        default:
            break
        }
    }

    private func handle(_ cmd: String, _ body: [String: Any]) {
        switch cmd {
        case "healthAuthorize":
            healthAuthorize(write: body["write"] as? Bool ?? false)
        case "healthRead":
            healthRead(since: body["since"] as? String ?? "2000-01-01")
        case "healthWrite":
            if let date = body["date"] as? String, let kg = (body["kg"] as? NSNumber)?.doubleValue {
                healthReplace(date: date, kg: kg)
            }
        case "healthDelete":
            if let date = body["date"] as? String { healthReplace(date: date, kg: nil) }
        case "notifyAuth":
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        case "reminder":
            reminder(enabled: body["enabled"] as? Bool ?? false,
                     hour: (body["hour"] as? NSNumber)?.intValue ?? 7,
                     minute: (body["minute"] as? NSNumber)?.intValue ?? 30,
                     weighedToday: body["weighedToday"] as? Bool ?? false,
                     text: body["body"] as? String ?? "Step on the scale before breakfast.")
        case "backupInfo":
            backupInfo()
        default:
            break
        }
    }

    /// Calls `window.__native(event, payload)` in the page.
    func send(_ event: String, _ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = "window.__native && window.__native(\"\(event)\", \(json));"
        DispatchQueue.main.async { self.webView?.evaluateJavaScript(script, completionHandler: nil) }
    }

    // MARK: Apple Health

    private func healthAuthorize(write: Bool) {
        guard HKHealthStore.isHealthDataAvailable() else { send("health-status", ["available": false]); return }
        health.requestAuthorization(toShare: write ? [massType] : [], read: readTypes) { ok, error in
            self.startBackgroundHealth()
            self.send("health-status", ["available": true, "ok": ok, "error": error?.localizedDescription ?? ""])
        }
    }

    /// First reading of each day from other apps and scales: weight, body fat % and lean mass.
    private func fetchDays(since: Date, completion: @escaping ([String: [String: Double]], Error?) -> Void) {
        let mine = HKSource.default()
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let group = DispatchGroup()
        let lock = NSLock()
        var days: [String: [String: Double]] = [:]
        var firstError: Error?
        let specs: [(HKQuantityType, String, HKUnit, Double)] = [
            (massType, "kg", .gramUnit(with: .kilo), 1),
            (fatType, "fat", .percent(), 100),
            (leanType, "lean", .gramUnit(with: .kilo), 1),
        ]
        for (type, key, unit, scale) in specs {
            group.enter()
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit,
                                      sortDescriptors: [sort]) { _, samples, error in
                lock.lock()
                if let error = error, key == "kg" { firstError = error }
                for case let sample as HKQuantitySample in samples ?? [] {
                    if sample.sourceRevision.source == mine { continue }
                    let day = Bridge.day(sample.startDate)
                    if days[day]?[key] == nil {
                        let value = sample.quantity.doubleValue(for: unit) * scale
                        days[day, default: [:]][key] = (value * 1000).rounded() / 1000
                    }
                }
                lock.unlock()
                group.leave()
            }
            health.execute(query)
        }
        group.notify(queue: .global()) { completion(days, firstError) }
    }

    private func healthRead(since: String) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        fetchDays(since: Bridge.date(since) ?? .distantPast) { days, error in
            if let error = error as NSError?,
               error.code != HKError.Code.errorAuthorizationNotDetermined.rawValue,
               error.code != HKError.Code.errorAuthorizationDenied.rawValue {
                self.send("health-samples", ["samples": [], "error": error.localizedDescription])
                return
            }
            let list: [[String: Any]] = days.map { day, values in
                var item: [String: Any] = ["date": day]
                for (k, v) in values { item[k] = v }
                return item
            }
            self.send("health-samples", ["samples": list])
        }
    }

    /// Removes this app's own weight samples for a day, then saves the new weight (if any).
    /// Keeps Apple Health free of duplicates when a weigh-in is edited or deleted.
    private func healthReplace(date: String, kg: Double?) {
        guard HKHealthStore.isHealthDataAvailable(), let day = Bridge.date(date),
              let next = Calendar.current.date(byAdding: .day, value: 1, to: day) else { return }
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForSamples(withStart: day, end: next, options: []),
            HKQuery.predicateForObjects(from: HKSource.default()),
        ])
        health.deleteObjects(of: massType, predicate: predicate) { _, _, _ in
            guard let kg = kg else { return }
            var when = Date()
            if date != Bridge.day(Date()) {
                when = Calendar.current.date(byAdding: .hour, value: 8, to: day) ?? day
            }
            let sample = HKQuantitySample(type: self.massType,
                                          quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg),
                                          start: when, end: when)
            self.health.save(sample) { ok, _ in
                if !ok { self.send("toast", ["text": "Could not save to Apple Health. Check access in the Health app."]) }
            }
        }
    }

    // MARK: Background sync from a smart scale

    private func settings(of state: [String: Any]?) -> [String: Any] { state?["settings"] as? [String: Any] ?? [:] }

    /// Wakes the app whenever a new weight lands in Apple Health (for example from a Wi-Fi scale).
    func startBackgroundHealth() {
        guard HKHealthStore.isHealthDataAvailable(), !observing else { return }
        let state = loadState().flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
        guard settings(of: state)["healthRead"] as? Bool == true else { return }
        observing = true
        let query = HKObserverQuery(sampleType: massType, predicate: nil) { _, completion, error in
            guard error == nil else { completion(); return }
            self.handleHealthChange(completion)
        }
        health.execute(query)
        health.enableBackgroundDelivery(for: massType, frequency: .immediate) { _, _ in }
    }

    private func handleHealthChange(_ done: @escaping () -> Void) {
        DispatchQueue.main.async {
            // While the app is on screen, the page does the import itself.
            if UIApplication.shared.applicationState == .active, self.webView != nil {
                self.send("foreground", [:])
                done()
                return
            }
            self.importInBackground(done)
        }
    }

    private func importInBackground(_ done: @escaping () -> Void) {
        guard let since = Calendar.current.date(byAdding: .day, value: -3, to: Calendar.current.startOfDay(for: Date())) else { done(); return }
        fetchDays(since: since) { days, _ in
            defer { done() }
            self.stateLock.lock()
            guard let text = try? String(contentsOf: self.stateURL, encoding: .utf8),
                  var state = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else {
                self.stateLock.unlock(); return
            }
            let prefs = self.settings(of: state)
            guard prefs["healthRead"] as? Bool == true else { self.stateLock.unlock(); return }
            let ignore = Set(prefs["healthIgnore"] as? [String] ?? [])
            var entries = state["entries"] as? [[String: Any]] ?? []
            var addedDays: [String] = []
            var changed = false
            for (day, values) in days where !ignore.contains(day) {
                if let i = entries.firstIndex(where: { $0["date"] as? String == day }) {
                    if entries[i]["src"] as? String == "health", let kg = values["kg"],
                       abs((entries[i]["kg"] as? Double ?? 0) - kg) > 0.005 { entries[i]["kg"] = kg; changed = true }
                    if let fat = values["fat"], entries[i]["fat"] as? Double != fat { entries[i]["fat"] = fat; changed = true }
                    if let lean = values["lean"], entries[i]["lean"] as? Double != lean { entries[i]["lean"] = lean; changed = true }
                } else if let kg = values["kg"], kg > 20, kg < 400 {
                    var entry: [String: Any] = ["id": "h" + day, "date": day, "kg": kg, "note": "", "src": "health"]
                    if let fat = values["fat"] { entry["fat"] = fat }
                    if let lean = values["lean"] { entry["lean"] = lean }
                    entries.append(entry)
                    addedDays.append(day)
                    changed = true
                }
            }
            guard changed else { self.stateLock.unlock(); return }
            entries.sort { ($0["date"] as? String ?? "") < ($1["date"] as? String ?? "") }
            state["entries"] = entries
            var newPrefs = prefs
            newPrefs["healthSince"] = Bridge.day(Date())
            state["settings"] = newPrefs
            guard let data = try? JSONSerialization.data(withJSONObject: state) else { self.stateLock.unlock(); return }
            try? data.write(to: self.stateURL, options: .atomic)
            self.stateLock.unlock()
            self.backupQueue.async { self.writeBackups(data) }

            let today = Bridge.day(Date())
            if addedDays.contains(today) {
                UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["weigh-0"])
            }
            if let newest = addedDays.max(), prefs["notifyWeigh"] as? Bool != false {
                self.notifyWeighIn(day: newest, entries: entries, prefs: prefs)
            }
        }
    }

    /// Same smoothing as the page: exponential average that respects gaps between weigh-ins.
    private func notifyWeighIn(day: String, entries: [[String: Any]], prefs: [String: Any]) {
        let alpha = prefs["smooth"] as? Double ?? 0.1
        var trend: Double?
        var previousTrend: Double?
        var prevDay: Double?
        var weight = 0.0
        for e in entries {
            guard let d = e["date"] as? String, let kg = e["kg"] as? Double, let n = Bridge.dayNumber(d) else { continue }
            previousTrend = trend
            if let t = trend, let p = prevDay {
                trend = t + (1 - pow(1 - alpha, max(1, n - p))) * (kg - t)
            } else { trend = kg }
            prevDay = n
            if d == day { weight = kg; break }
        }
        guard let t = trend else { return }
        let lb = (prefs["unit"] as? String) == "lb"
        let f: (Double) -> String = { String(format: "%.1f", lb ? $0 * 2.2046226218 : $0) }
        let unit = lb ? "lb" : "kg"
        var body = "Trend \(f(t)) \(unit)"
        if let p = previousTrend {
            let delta = t - p
            body += abs(delta) < 0.05 ? " · steady" : (delta < 0 ? " · ↓ \(f(abs(delta)))" : " · ↑ \(f(delta))")
        }
        if let fat = entries.first(where: { $0["date"] as? String == day })?["fat"] as? Double {
            body += String(format: " · %.1f%% fat", fat)
        }
        let content = UNMutableNotificationContent()
        content.title = "Weighed in: \(f(weight)) \(unit)"
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "weighed-\(day)", content: content, trigger: nil))
    }

    // MARK: Reminders

    /// Schedules one notification per day for the next 30 days, skipping today if already weighed.
    private func reminder(enabled: Bool, hour: Int, minute: Int, weighedToday: Bool, text: String) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: (0..<40).map { "weigh-\($0)" })
        guard enabled else { return }
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { self.send("reminder-denied", [:]); return }
            let calendar = Calendar.current
            let now = Date()
            let today = calendar.startOfDay(for: now)
            for offset in 0..<30 {
                if offset == 0 && weighedToday { continue }
                guard let day = calendar.date(byAdding: .day, value: offset, to: today),
                      let fire = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day),
                      fire > now else { continue }
                let content = UNMutableNotificationContent()
                content.title = "Time to weigh in"
                content.body = text
                content.sound = .default
                let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
                let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
                center.add(UNNotificationRequest(identifier: "weigh-\(offset)", content: content, trigger: trigger))
            }
        }
    }

    // MARK: Share sheet

    private func share(name: String, text: String) {
        let url = fm.temporaryDirectory.appendingPathComponent(name)
        try? text.write(to: url, atomically: true, encoding: .utf8)
        DispatchQueue.main.async {
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            guard var top = self.webView?.window?.rootViewController else { return }
            while let presented = top.presentedViewController { top = presented }
            sheet.popoverPresentationController?.sourceView = self.webView
            top.present(sheet, animated: true)
        }
    }

    // MARK: Navigation

    /// Opens web links in Safari instead of inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, ["http", "https"].contains(url.scheme ?? ""),
           action.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // MARK: Dates (local calendar day as yyyy-MM-dd)

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static func day(_ date: Date) -> String {
        dayFormatter.timeZone = .current
        return dayFormatter.string(from: date)
    }
    static func date(_ day: String) -> Date? {
        dayFormatter.timeZone = .current
        return dayFormatter.date(from: day)
    }
    /// Days since 1970 for a yyyy-MM-dd string (calendar days, no time zone shifts).
    static func dayNumber(_ day: String) -> Double? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        guard let d = utc.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return nil }
        return (d.timeIntervalSince1970 / 86400).rounded()
    }
}

struct WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let bridge = Bridge.shared

        let content = WKUserContentController()
        var stateLiteral = "null"
        if let saved = bridge.loadState(),
           let data = try? JSONEncoder().encode(saved),
           let encoded = String(data: data, encoding: .utf8) {
            stateLiteral = encoded
        }
        let info = Bundle.main.infoDictionary
        let version = "\(info?["CFBundleShortVersionString"] as? String ?? "1.0") (\(info?["CFBundleVersion"] as? String ?? "1"))"
        content.addUserScript(WKUserScript(
            source: "window.__NATIVE_STATE__ = \(stateLiteral); window.__APP_VERSION__ = \"\(version)\";",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(bridge, name: "store")
        content.add(bridge, name: "share")
        content.add(bridge, name: "native")

        let config = WKWebViewConfiguration()
        config.userContentController = content
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = appBackground
        webView.scrollView.backgroundColor = appBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = bridge
        bridge.webView = webView

        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
