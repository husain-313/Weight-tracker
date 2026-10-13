import SwiftUI
import WebKit
import HealthKit
import UserNotifications

private let appBackground = UIColor(red: 17/255, green: 21/255, blue: 28/255, alpha: 1)

@main
struct TrendlineApp: App {
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            WebView()
                .ignoresSafeArea()
                .background(Color(appBackground))
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Bridge.shared.send("foreground", [:]) }
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

    func loadState() -> String? { try? String(contentsOf: stateURL, encoding: .utf8) }

    private func store(_ json: String) {
        let data = Data(json.utf8)
        try? data.write(to: stateURL, options: .atomic)
        backupQueue.async { self.writeBackups(data) }
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
                healthWrite(date: date, kg: kg)
            }
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
        health.requestAuthorization(toShare: write ? [massType] : [], read: [massType]) { ok, error in
            self.send("health-status", ["available": true, "ok": ok, "error": error?.localizedDescription ?? ""])
        }
    }

    /// Sends the first weigh-in of each day (from other apps and scales) since a date.
    private func healthRead(since: String) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let start = Bridge.date(since) ?? .distantPast
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: massType, predicate: predicate, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: [sort]) { _, samples, error in
            if let error = error {
                // Read access denied or not yet decided: report nothing new rather than an error.
                if (error as NSError).code == HKError.Code.errorAuthorizationNotDetermined.rawValue ||
                   (error as NSError).code == HKError.Code.errorAuthorizationDenied.rawValue {
                    self.send("health-samples", ["samples": []])
                } else {
                    self.send("health-samples", ["samples": [], "error": error.localizedDescription])
                }
                return
            }
            let mine = HKSource.default()
            var byDay: [String: Double] = [:]
            for case let sample as HKQuantitySample in samples ?? [] {
                if sample.sourceRevision.source == mine { continue }
                let day = Bridge.day(sample.startDate)
                if byDay[day] == nil {
                    byDay[day] = sample.quantity.doubleValue(for: .gramUnit(with: .kilo))
                }
            }
            let list = byDay.map { ["date": $0.key, "kg": ($0.value * 1000).rounded() / 1000] as [String: Any] }
            self.send("health-samples", ["samples": list])
        }
        health.execute(query)
    }

    private func healthWrite(date: String, kg: Double) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        var when = Date()
        if date != Bridge.day(Date()), let day = Bridge.date(date) {
            when = Calendar.current.date(byAdding: .hour, value: 8, to: day) ?? day
        }
        let quantity = HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg)
        let sample = HKQuantitySample(type: massType, quantity: quantity, start: when, end: when)
        health.save(sample) { ok, _ in
            if !ok { self.send("toast", ["text": "Could not save to Apple Health. Check access in the Health app."]) }
        }
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
}

struct WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let bridge = Bridge.shared
        bridge.migrate()

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
