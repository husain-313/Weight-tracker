import SwiftUI
import WebKit
import HealthKit
import UserNotifications
import LocalAuthentication
import UniformTypeIdentifiers

/// Matches the page background in both themes so there is never a flash on launch or rotation.
let appBackground = UIColor { traits in
    traits.userInterfaceStyle == .dark
        ? UIColor(red: 18/255, green: 17/255, blue: 22/255, alpha: 1)
        : UIColor(red: 242/255, green: 242/255, blue: 247/255, alpha: 1)
}

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
    @StateObject private var lock = LockManager()

    var body: some Scene {
        WindowGroup {
            ZStack {
                WebView()
                    .ignoresSafeArea()
                    .background(Color(appBackground))
                if lock.locked || lock.covered {
                    LockView(lock: lock).transition(.opacity)
                }
            }
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                lock.covered = false
                if lock.locked { lock.authenticate() } else { Bridge.shared.foreground() }
            case .inactive:
                if lock.enabled && !lock.authenticating { lock.covered = true }
            case .background:
                lock.lockIfEnabled()
            @unknown default:
                break
            }
        }
    }
}

/// Face ID / passcode lock. Hides the data in the app switcher and asks to unlock on return.
final class LockManager: ObservableObject {
    @Published var locked: Bool
    @Published var covered = false
    @Published private(set) var authenticating = false

    init() { locked = Bridge.shared.lockEnabled() }
    var enabled: Bool { Bridge.shared.lockEnabled() }

    func lockIfEnabled() { if enabled { locked = true } }

    func authenticate() {
        guard locked, !authenticating else { return }
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            locked = false
            Bridge.shared.foreground()
            return
        }
        authenticating = true
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock your weight data") { ok, _ in
            DispatchQueue.main.async {
                self.authenticating = false
                if ok {
                    withAnimation(.easeOut(duration: 0.2)) { self.locked = false; self.covered = false }
                    Bridge.shared.foreground()
                }
            }
        }
    }
}

struct LockView: View {
    @ObservedObject var lock: LockManager
    var body: some View {
        ZStack {
            Color(appBackground).ignoresSafeArea()
            VStack(spacing: 18) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 42, weight: .semibold))
                    .foregroundColor(.secondary)
                Text("Trendline is locked")
                    .font(.system(.title3, design: .rounded).weight(.semibold))
                if lock.locked && !lock.authenticating {
                    Button(action: { lock.authenticate() }) {
                        Text("Unlock")
                            .font(.headline)
                            .padding(.horizontal, 32)
                            .padding(.vertical, 12)
                            .background(Capsule().fill(Color.secondary.opacity(0.18)))
                    }
                    .foregroundColor(.primary)
                }
            }
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
    private var observing = false
    private let stateLock = NSLock()
    private var themeStyle: UIUserInterfaceStyle = .unspecified
    private let backupQueue = DispatchQueue(label: "trendline.backup")
    /// Readable after the first unlock, so background imports from Apple Health still work while the phone is locked.
    private let protection: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
    private var pendingFolderData: Data?

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
    /// Version 2.0 dropped food logging, so the AI service keys it kept in the Keychain go too.
    func migrate() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                       kSecAttrService as String: "trendline.apikeys"] as CFDictionary)
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
        try? data.write(to: stateURL, options: protection)
        stateLock.unlock()
        backupQueue.async { self.writeBackups(data) }
    }

    func lockEnabled() -> Bool {
        guard let text = loadState(),
              let object = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { return false }
        return settings(of: object)["lock"] as? Bool == true
    }

    /// Hands the page the saved state (it may have changed in the background), then refreshes.
    func foreground() {
        if let json = loadState() { send("state", ["json": json]) }
        send("foreground", [:])
    }

    /// Runs on backupQueue after every save: local backups and the backup folder.
    private func writeBackups(_ data: Data) {
        writeRotating(data, in: backupsDir, keep: 8, options: protection)
        scheduleFolderBackup(data)
    }

    /// Keeps a "latest" copy plus one dated copy per week (the newest `keep`). Returns whether "latest" was written.
    @discardableResult
    private func writeRotating(_ data: Data, in dir: URL, keep: Int, options: Data.WritingOptions) -> Bool {
        guard (try? data.write(to: dir.appendingPathComponent("trendline-latest.json"), options: options)) != nil else { return false }
        let dated = datedBackups(in: dir)
        let weekAgo = Date().addingTimeInterval(-7 * 86400)
        if let newest = dated.last, let made = modified(newest), made > weekAgo {
            // a weekly copy already exists
        } else {
            try? data.write(to: dir.appendingPathComponent("trendline-\(Bridge.day(Date())).json"), options: options)
        }
        let all = datedBackups(in: dir)
        if all.count > keep { all.prefix(all.count - keep).forEach { try? fm.removeItem(at: $0) } }
        return true
    }

    private func datedBackups(in dir: URL) -> [URL] {
        let items = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        return items.filter { $0.lastPathComponent.hasPrefix("trendline-20") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    private func modified(_ url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }

    private func backupInfo() {
        backupQueue.async {
            let latest = self.backupsDir.appendingPathComponent("trendline-latest.json")
            let iso = ISO8601DateFormatter()
            var info: [String: Any] = ["count": self.datedBackups(in: self.backupsDir).count,
                                       "bundle": Bundle.main.bundleIdentifier ?? ""]
            if let date = self.modified(latest) { info["last"] = iso.string(from: date) }
            let defaults = UserDefaults.standard
            if self.fm.fileExists(atPath: self.folderBookmarkURL.path) {
                info["folder"] = defaults.string(forKey: "backupFolderName") ?? "Backup folder"
                if let date = defaults.object(forKey: "backupFolderLast") as? Date { info["folderLast"] = iso.string(from: date) }
                if let error = defaults.string(forKey: "backupFolderError") { info["folderError"] = error }
            }
            self.send("backup-info", info)
        }
    }

    // MARK: Backup folder (survives deleting the app or a revoked certificate)

    private var folderBookmarkURL: URL { support.appendingPathComponent("backup-folder.bookmark") }

    func setBackupFolder(_ url: URL) {
        guard url.startAccessingSecurityScopedResource() else {
            send("toast", ["text": "Trendline can't use that folder. Try another one."]); return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let bookmark = try? url.bookmarkData(),
              (try? bookmark.write(to: folderBookmarkURL, options: protection)) != nil else {
            send("toast", ["text": "Trendline can't use that folder. Try another one."]); return
        }
        let defaults = UserDefaults.standard
        defaults.set(url.lastPathComponent, forKey: "backupFolderName")
        defaults.removeObject(forKey: "backupFolderLast")
        defaults.removeObject(forKey: "backupFolderError")
        backupNow()
    }

    private func removeBackupFolder() {
        try? fm.removeItem(at: folderBookmarkURL)
        ["backupFolderName", "backupFolderLast", "backupFolderError"].forEach { UserDefaults.standard.removeObject(forKey: $0) }
        backupInfo()
    }

    /// Writes every backup straight away and reports how it went.
    private func backupNow() {
        backupQueue.async {
            guard let text = self.loadState() else { self.send("toast", ["text": "Nothing to back up yet."]); return }
            let data = Data(text.utf8)
            self.writeRotating(data, in: self.backupsDir, keep: 8, options: self.protection)
            self.pendingFolderData = nil
            var message = "Backed up on this iPhone"
            if self.fm.fileExists(atPath: self.folderBookmarkURL.path) {
                message = self.writeFolderBackup(data) ? "Backed up to your folder" : "Couldn't write to your backup folder"
            }
            self.send("toast", ["text": message])
            self.backupInfo()
        }
    }

    /// Waits a moment so a burst of saves becomes one write to the folder. Runs on backupQueue.
    private func scheduleFolderBackup(_ data: Data) {
        let idle = pendingFolderData == nil
        pendingFolderData = data
        guard idle else { return }
        backupQueue.asyncAfter(deadline: .now() + 3) {
            guard let latest = self.pendingFolderData else { return }
            self.pendingFolderData = nil
            self.writeFolderBackup(latest)
        }
    }

    /// Same rotation as the local backups (12 weekly copies), coordinated so iCloud Drive syncs it safely.
    @discardableResult
    private func writeFolderBackup(_ data: Data) -> Bool {
        guard let bookmark = try? Data(contentsOf: folderBookmarkURL) else { return false }
        let defaults = UserDefaults.standard
        var stale = false
        guard let folder = try? URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &stale) else {
            defaults.set("The backup folder can't be found. Choose it again.", forKey: "backupFolderError"); return false
        }
        guard folder.startAccessingSecurityScopedResource() else {
            defaults.set("Trendline lost access to the backup folder. Choose it again.", forKey: "backupFolderError"); return false
        }
        defer { folder.stopAccessingSecurityScopedResource() }
        if stale, let fresh = try? folder.bookmarkData() { try? fresh.write(to: folderBookmarkURL, options: protection) }
        var ok = false
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: folder, options: [], error: &coordinationError) { dir in
            ok = self.writeRotating(data, in: dir, keep: 12, options: .atomic)
        }
        if ok {
            defaults.set(Date(), forKey: "backupFolderLast")
            defaults.removeObject(forKey: "backupFolderError")
        } else {
            defaults.set("The last copy to the backup folder failed. It will try again on the next change.", forKey: "backupFolderError")
        }
        return ok
    }

    // MARK: Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "store":
            if let json = message.body as? String { store(json) }
        case "share":
            if let body = message.body as? [String: Any],
               let name = body["name"] as? String, let text = body["text"] as? String {
                share(name: name, data: Data(text.utf8))
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
        case "haptic":
            let kind = body["kind"] as? String ?? "light"
            DispatchQueue.main.async {
                switch kind {
                case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
                case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
                case "selection": UISelectionFeedbackGenerator().selectionChanged()
                case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
            }
        case "theme":
            let mode = body["mode"] as? String ?? "auto"
            themeStyle = mode == "dark" ? .dark : mode == "light" ? .light : .unspecified
            applyTheme()
        case "http":
            performHTTP(body)
        case "openURL":
            if let text = body["url"] as? String, let url = URL(string: text), url.scheme == "https" {
                DispatchQueue.main.async { UIApplication.shared.open(url) }
            }
        case "copy":
            if let text = body["text"] as? String { DispatchQueue.main.async { UIPasteboard.general.string = text } }
        case "lockSet":
            let enable = body["enabled"] as? Bool ?? false
            let context = LAContext()
            var error: NSError?
            guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
                send("lock-result", ["enabled": enable, "ok": false, "reason": "unavailable"])
                return
            }
            let reason = enable ? "Turn on the Face ID lock" : "Turn off the Face ID lock"
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
                self.send("lock-result", ["enabled": enable, "ok": ok])
            }
        case "reminder":
            reminder(enabled: body["enabled"] as? Bool ?? false,
                     hour: (body["hour"] as? NSNumber)?.intValue ?? 7,
                     minute: (body["minute"] as? NSNumber)?.intValue ?? 30,
                     weighedToday: body["weighedToday"] as? Bool ?? false,
                     text: body["body"] as? String ?? "Step on the scale before breakfast.")
        case "backupInfo":
            backupInfo()
        case "backupNow":
            backupNow()
        case "chooseBackupFolder":
            FolderPicker.shared.start(from: webView)
        case "removeBackupFolder":
            removeBackupFolder()
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
            self.startBackgroundHealth()
            self.send("health-status", ["available": true, "ok": ok, "error": error?.localizedDescription ?? ""])
        }
    }

    /// days: first weight of each calendar day from other apps and scales, as kg and t (ms);
    /// own: weights this app wrote (used to restore entries after a reinstall or erase).
    private func fetchDays(since: Date, completion: @escaping ([String: [String: Double]], [[Double]], Error?) -> Void) {
        let mine = HKSource.default()
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let kilo = HKUnit.gramUnit(with: .kilo)
        let query = HKSampleQuery(sampleType: massType, predicate: predicate, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: [sort]) { _, samples, error in
            var days: [String: [String: Double]] = [:]
            var own: [[Double]] = []
            for case let sample as HKQuantitySample in samples ?? [] {
                let t = (sample.startDate.timeIntervalSince1970 * 1000).rounded()
                let kg = (sample.quantity.doubleValue(for: kilo) * 1000).rounded() / 1000
                if sample.sourceRevision.source == mine { own.append([t, kg]); continue }
                let day = Bridge.day(sample.startDate)
                if days[day] == nil { days[day] = ["kg": kg, "t": t] }
            }
            completion(days, own, error)
        }
        health.execute(query)
    }

    private func healthRead(since: String) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        fetchDays(since: Bridge.date(since) ?? .distantPast) { days, own, error in
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
            self.send("health-samples", ["samples": list, "own": own])
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
            self.importInBackground { self.rescheduleReminder(done) }
        }
    }

    private func importInBackground(_ done: @escaping () -> Void) {
        guard let since = Calendar.current.date(byAdding: .day, value: -3, to: Calendar.current.startOfDay(for: Date())) else { done(); return }
        fetchDays(since: since) { days, _, _ in
            defer { done() }
            self.stateLock.lock()
            guard let text = try? String(contentsOf: self.stateURL, encoding: .utf8),
                  var state = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else {
                self.stateLock.unlock(); return
            }
            let prefs = self.settings(of: state)
            guard prefs["healthRead"] as? Bool == true else { self.stateLock.unlock(); return }
            let ignore = Set(prefs["healthIgnore"] as? [String] ?? [])
            let importFrom = prefs["healthFrom"] as? String ?? ""
            var entries = state["entries"] as? [[String: Any]] ?? []
            var addedDays: [String] = []
            var changed = false
            for (day, values) in days where !ignore.contains(day) && day >= importFrom {
                if let i = entries.firstIndex(where: { $0["date"] as? String == day }) {
                    if entries[i]["src"] as? String == "health", let kg = values["kg"],
                       abs((entries[i]["kg"] as? Double ?? 0) - kg) > 0.005 { entries[i]["kg"] = kg; changed = true }
                    if entries[i]["t"] == nil, let t = values["t"] { entries[i]["t"] = t; changed = true }
                } else if let kg = values["kg"], kg > 20, kg < 400 {
                    var entry: [String: Any] = ["id": "h" + day, "date": day, "kg": kg, "note": "", "src": "health"]
                    if let t = values["t"] { entry["t"] = t }
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
            try? data.write(to: self.stateURL, options: self.protection)
            self.stateLock.unlock()
            self.backupQueue.async { self.writeBackups(data) }

            if let newest = addedDays.max(), prefs["notifyWeigh"] as? Bool != false {
                self.notifyWeighIn(day: newest, entries: entries, prefs: prefs)
            }
        }
    }

    /// Same smoothing as the page: exponential average that respects gaps between weigh-ins.
    /// Leaves out weigh-ins the page doesn't count (ignored, or unusual and not confirmed).
    private func trendSeries(_ entries: [[String: Any]], prefs: [String: Any]) -> [(day: String, kg: Double, trend: Double)] {
        let alpha = prefs["smooth"] as? Double ?? 0.1
        var series: [(day: String, kg: Double, trend: Double)] = []
        var trend = 0.0
        var prevDay: Double?
        for e in entries {
            guard let d = e["date"] as? String, let kg = e["kg"] as? Double, let n = Bridge.dayNumber(d) else { continue }
            if e["ignored"] as? Bool == true || (e["outlier"] as? Bool == true && e["keep"] as? Bool != true) { continue }
            if let p = prevDay {
                trend += (1 - pow(1 - alpha, max(1, n - p))) * (kg - trend)
            } else { trend = kg }
            prevDay = n
            series.append((d, kg, trend))
        }
        return series
    }

    /// A weight in the person's unit with one decimal, as the page shows it.
    private func weightText(_ kg: Double, _ prefs: [String: Any]) -> String {
        let lb = (prefs["unit"] as? String) == "lb"
        return String(format: "%.1f", lb ? kg * 2.2046226218 : kg)
    }

    private func notifyWeighIn(day: String, entries: [[String: Any]], prefs: [String: Any]) {
        let series = trendSeries(entries, prefs: prefs)
        guard let i = series.firstIndex(where: { $0.day == day }) else { return }
        let f: (Double) -> String = { self.weightText($0, prefs) }
        let unit = (prefs["unit"] as? String) == "lb" ? "lb" : "kg"
        let t = series[i].trend
        var body = "Trend \(f(t)) \(unit)"
        if i > 0 {
            let delta = t - series[i - 1].trend
            body += abs(delta) < 0.05 ? " · steady" : (delta < 0 ? " · ↓ \(f(abs(delta)))" : " · ↑ \(f(delta))")
        }
        let content = UNMutableNotificationContent()
        content.title = "Weighed in: \(f(series[i].kg)) \(unit)"
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "weighed-\(day)", content: content, trigger: nil))
    }

    // MARK: Network bridge (only the update check talks to the internet)

    private static let allowedHosts: Set<String> = ["api.github.com"]

    private func performHTTP(_ body: [String: Any]) {
        guard let id = (body["id"] as? NSNumber)?.intValue, let urlString = body["url"] as? String else { return }
        let headers = body["headers"] as? [String: String] ?? [:]
        guard let url = URL(string: urlString), url.scheme == "https", let host = url.host, Bridge.allowedHosts.contains(host) else {
            send("http-result", ["id": id, "status": 0, "body": "", "error": "host-not-allowed"]); return
        }
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpMethod = body["method"] as? String ?? "GET"
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        if let text = body["body"] as? String { request.httpBody = Data(text.utf8) }
        URLSession.shared.dataTask(with: request) { data, response, error in
            var payload: [String: Any] = [
                "id": id,
                "status": (response as? HTTPURLResponse)?.statusCode ?? 0,
                "body": String(data: data ?? Data(), encoding: .utf8) ?? "",
            ]
            if let error = error { payload["error"] = error.localizedDescription }
            self.send("http-result", payload)
        }.resume()
    }

    // MARK: Reminders

    /// iOS keeps at most 64 pending notifications per app.
    private static let reminderDays = 60

    /// Schedules one notification per day for the next 60 days, skipping today if already weighed.
    /// The page reschedules whenever it opens, and so does a background import from Apple Health.
    private func reminder(enabled: Bool, hour: Int, minute: Int, weighedToday: Bool, text: String,
                          done: (() -> Void)? = nil) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: (0..<70).map { "weigh-\($0)" })
        guard enabled else { done?(); return }
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { self.send("reminder-denied", [:]); done?(); return }
            let calendar = Calendar.current
            let now = Date()
            let today = calendar.startOfDay(for: now)
            let added = DispatchGroup()
            for offset in 0..<Bridge.reminderDays {
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
                added.enter()
                center.add(UNNotificationRequest(identifier: "weigh-\(offset)", content: content, trigger: trigger)) { _ in added.leave() }
            }
            added.notify(queue: .main) { done?() }
        }
    }

    /// Reschedules the reminder from saved settings while the page isn't running (woken by a smart scale),
    /// so the reminders keep going even if the app isn't opened for weeks.
    private func rescheduleReminder(_ done: @escaping () -> Void) {
        guard let text = loadState(),
              let state = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { done(); return }
        let prefs = settings(of: state)
        guard prefs["remind"] as? Bool == true else { done(); return }
        let time = (prefs["remindTime"] as? String ?? "07:30").split(separator: ":").compactMap { Int($0) }
        let entries = state["entries"] as? [[String: Any]] ?? []
        var body = "Step on the scale before breakfast."
        if let last = trendSeries(entries, prefs: prefs).last {
            let unit = (prefs["unit"] as? String) == "lb" ? "lb" : "kg"
            body = "Your trend is \(weightText(last.trend, prefs)) \(unit). " + body
        }
        reminder(enabled: true, hour: time.count == 2 ? time[0] : 7, minute: time.count == 2 ? time[1] : 30,
                 weighedToday: entries.contains { $0["date"] as? String == Bridge.day(Date()) },
                 text: body, done: done)
    }

    // MARK: Text size

    /// The page's root font size: follows the iPhone's text size (17 at the default),
    /// capped at the largest standard size so the layout still fits.
    static func textSizePx() -> Int {
        Int(min(23, max(14, UIFont.preferredFont(forTextStyle: .body).pointSize)).rounded())
    }

    @objc func textSizeChanged() {
        send("text-size", ["px": Bridge.textSizePx()])
    }

    // MARK: Share sheet

    private func applyTheme() {
        DispatchQueue.main.async {
            self.webView?.window?.overrideUserInterfaceStyle = self.themeStyle
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        applyTheme()
    }

    private func share(name: String, data: Data) {
        let url = fm.temporaryDirectory.appendingPathComponent(name)
        try? data.write(to: url, options: .atomic)
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
            source: "window.__NATIVE_STATE__ = \(stateLiteral); window.__APP_VERSION__ = \"\(version)\";"
                + " document.documentElement.style.fontSize = \"\(Bridge.textSizePx())px\";",
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
        webView.scrollView.keyboardDismissMode = .interactive
        if #available(iOS 16.4, *) { webView.isInspectable = false }
        webView.navigationDelegate = bridge
        bridge.webView = webView
        NotificationCenter.default.addObserver(bridge, selector: #selector(Bridge.textSizeChanged),
                                               name: UIContentSizeCategory.didChangeNotification, object: nil)

        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}


/// Lets the person pick a folder (for example in iCloud Drive) for automatic backup copies.
final class FolderPicker: NSObject, UIDocumentPickerDelegate {
    static let shared = FolderPicker()

    func start(from webView: WKWebView?) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            guard var top = webView?.window?.rootViewController else { return }
            while let presented = top.presentedViewController { top = presented }
            top.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if let url = urls.first { Bridge.shared.setBackupFolder(url) }
    }
}
