import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/**
 * The folder auto-backup writes into, chosen by the person (#161), on the iPhone: a folder in
 * iCloud Drive, or in any Files provider (Google Drive, Dropbox, Nextcloud). The same JS API as
 * android/.../BackupFolderPlugin.java, so lib/mobile.js has no per-platform branch:
 *
 *   const BackupFolder = registerPlugin('BackupFolder')
 *   const { uri, label } = await BackupFolder.pick()          // {} when cancelled
 *   const { ok } = await BackupFolder.check({ uri })          // still allowed to write there?
 *   await BackupFolder.write({ uri, name, data })
 *   await BackupFolder.prune({ uri, keep, pattern, written }) // keeps the newest `keep`
 *   const { files } = await BackupFolder.list({ uri })        // [{ name, size }], the app's dated names, newest first
 *   const { data } = await BackupFolder.read({ uri, name })   // one of them, as UTF-8 text
 *   await BackupFolder.release({ uri })
 *
 * `uri` is "bookmark:<uuid>": the id of a security-scoped bookmark kept in UserDefaults, never a
 * path (a path means nothing once the app restarts). write, prune, list and read act only on a folder whose
 * bookmark this app holds, and only on the app's own dated file names (`backupName`, the same
 * rule as lib/mobile.js AUTO_BACKUP_NAME): `pattern` from JS is ignored, so nothing the WebView
 * sends can widen what is written or deleted there.
 */
@objc(BackupFolderPlugin)
public class BackupFolderPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "BackupFolderPlugin"
    public let jsName = "BackupFolder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prune", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
    ]

    private static let prefix = "bookmark:"
    private static let store = "opengym.backupFolderBookmarks"   // [uuid: bookmark Data]
    // The only files write and prune touch: "opengym-backup-2026-10-15.json", "...-2.json".
    private static let backupName = try! NSRegularExpression(pattern: "^opengym-backup-\\d{4}-\\d{2}-\\d{2}(-[2-9])?\\.json\\z")

    // Writes and listings may wait on iCloud or a provider app: off the main thread, one at a time
    // so two backups never race for the same name.
    private let io = DispatchQueue(label: "opengym.backupfolder")
    private var pickCall: CAPPluginCall?   // main thread only; a new pick resolves a stale one as cancelled

    private static func isBackupName(_ n: String) -> Bool {
        backupName.firstMatch(in: n, range: NSRange(n.startIndex..., in: n)) != nil
    }

    // MARK: bookmarks

    // pick (main), a stale refresh (io) and release (bridge queue) all change the dictionary: one lock keeps an entry from being lost.
    private static let lock = NSLock()
    private static func bookmarks() -> [String: Data] {
        UserDefaults.standard.dictionary(forKey: store) as? [String: Data] ?? [:]
    }
    private static func update(_ change: (inout [String: Data]) -> Void) {
        lock.lock(); defer { lock.unlock() }
        var all = bookmarks(); change(&all)
        UserDefaults.standard.set(all, forKey: store)
    }
    private static func id(of uri: String) -> String? { uri.hasPrefix(prefix) ? String(uri.dropFirst(prefix.count)) : nil }

    /// The folder behind a bookmark id, or nil when it is gone (deleted, provider removed).
    /// A stale bookmark (the folder moved, iCloud renamed it) is made again under the same id.
    private static func resolve(_ uri: String) -> URL? {
        guard let key = id(of: uri), let data = bookmarks()[key] else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        // A bookmark follows a folder into the trash: that is deleted, not a place to keep backups.
        if url.path.contains("/.Trash") { return nil }
        if stale {
            let started = url.startAccessingSecurityScopedResource()
            defer { if started { url.stopAccessingSecurityScopedResource() } }
            if let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                update { $0[key] = fresh }
            }
        }
        return url
    }

    /// Runs `body` on the folder with access held, and says why not when it cannot be had.
    private static func withFolder<T>(_ uri: String, _ body: (URL) throws -> T) throws -> T {
        guard let url = resolve(uri) else { throw NSError(domain: "BackupFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "this folder is not one the app may write to"]) }
        // False for a folder inside the app's own container, which is writable all the same: a truly missing right fails the write itself.
        let started = url.startAccessingSecurityScopedResource()
        defer { if started { url.stopAccessingSecurityScopedResource() } }
        return try body(url)
    }

    // MARK: pick

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard var host = self.bridge?.viewController else { call.reject("the folder picker is not available"); return }
            // A picker the person never finished must not block the next one.
            self.pickCall?.resolve([:])
            self.pickCall = call
            while let next = host.presentedViewController { host = next }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            host.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.resolve([:])   // cancelled: nothing changes
        pickCall = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let call = pickCall
        pickCall = nil
        guard let url = urls.first else { call?.resolve([:]); return }
        let started = url.startAccessingSecurityScopedResource()
        defer { if started { url.stopAccessingSecurityScopedResource() } }
        do {
            // Minimal options: .withSecurityScope is macOS only; on iOS the picked URL already carries the scope.
            let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            let key = UUID().uuidString
            BackupFolderPlugin.update { $0[key] = data }
            // "iCloud Drive" for its root, whose folder name is com~apple~CloudDocs.
            call?.resolve(["uri": BackupFolderPlugin.prefix + key, "label": FileManager.default.displayName(atPath: url.path)])
        } catch {
            call?.reject("this folder cannot be kept for later writes", nil, error)
        }
    }

    // MARK: check, write, prune, release

    @objc func check(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri") else { call.resolve(["ok": false]); return }
        io.async {
            let ok = (try? BackupFolderPlugin.withFolder(uri) { try $0.checkResourceIsReachable() }) ?? false
            call.resolve(["ok": ok])
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let name = call.getString("name"), let text = call.getString("data") else {
            call.reject("uri, name and data are required"); return
        }
        guard BackupFolderPlugin.isBackupName(name) else { call.reject("not a backup file name"); return }
        io.async {
            do {
                try BackupFolderPlugin.withFolder(uri) { folder in
                    let file = folder.appendingPathComponent(name)
                    var failure: NSError?
                    var thrown: Error?
                    // A coordinated write: the file may be an iCloud one that is evicted or in use.
                    NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: &failure) { url in
                        do { try Data(text.utf8).write(to: url, options: .atomic) } catch { thrown = error }
                    }
                    if let e = (failure as Error?) ?? thrown { throw e }
                }
                call.resolve(["ok": true])
            } catch {
                call.reject("could not write to the backup folder: " + error.localizedDescription, nil, error)
            }
        }
    }

    @objc func prune(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), call.getString("pattern") != nil else { call.reject("uri, pattern and keep are required"); return }
        let written = call.getString("written") ?? ""
        let keep = call.getInt("keep") ?? 14
        guard keep >= 1 else { call.reject("uri, pattern and keep are required"); return }
        io.async {
            var deleted = 0
            do {
                try BackupFolderPlugin.withFolder(uri) { folder in
                    // An iCloud file that is not downloaded lists as ".name.icloud": its real name is the one to count and delete.
                    var listed: [String] = []
                    var listFailure: NSError?
                    var listThrown: Error?
                    NSFileCoordinator().coordinate(readingItemAt: folder, options: [], error: &listFailure) { url in
                        do { listed = try FileManager.default.contentsOfDirectory(atPath: url.path) } catch { listThrown = error }
                    }
                    if let e = (listFailure as Error?) ?? listThrown { throw e }
                    let names = listed.map { n -> String in
                        n.hasPrefix(".") && n.hasSuffix(".icloud") ? String(n.dropFirst().dropLast(".icloud".count)) : n
                    }
                    // Newest first by the date in the name, as the Documents/openGym prune does.
                    let older = Set(names.filter { BackupFolderPlugin.isBackupName($0) && $0 != written }).sorted { $0.dropLast(5) > $1.dropLast(5) }
                    for n in older.dropFirst(keep - 1) {
                        var failure: NSError?
                        NSFileCoordinator().coordinate(writingItemAt: folder.appendingPathComponent(n), options: .forDeleting, error: &failure) { url in
                            if (try? FileManager.default.removeItem(at: url)) != nil { deleted += 1 }   // one stuck file does not stop the rest
                        }
                    }
                }
            } catch { /* pruning is housekeeping; the copy is already written */ }
            call.resolve(["deleted": deleted])
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri") else { call.reject("uri is required"); return }
        io.async {
            do {
                let files: [[String: Any]] = try BackupFolderPlugin.withFolder(uri) { folder in
                    var listed: [String] = []
                    var failure: NSError?
                    var thrown: Error?
                    NSFileCoordinator().coordinate(readingItemAt: folder, options: [], error: &failure) { url in
                        do { listed = try FileManager.default.contentsOfDirectory(atPath: url.path) } catch { thrown = error }
                    }
                    if let e = (failure as Error?) ?? thrown { throw e }
                    // An iCloud file that is not downloaded lists as ".name.icloud"; reading it fetches it.
                    let names = Set(listed.map { n -> String in
                        n.hasPrefix(".") && n.hasSuffix(".icloud") ? String(n.dropFirst().dropLast(".icloud".count)) : n
                    }.filter { BackupFolderPlugin.isBackupName($0) }).sorted { $0.dropLast(5) > $1.dropLast(5) }
                    return names.map { n in
                        let size = (try? FileManager.default.attributesOfItem(atPath: folder.appendingPathComponent(n).path)[.size] as? Int) ?? 0
                        return ["name": n, "size": size]
                    }
                }
                call.resolve(["files": files])
            } catch {
                call.reject("could not read the backup folder: " + error.localizedDescription, nil, error)
            }
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let name = call.getString("name") else { call.reject("uri and name are required"); return }
        guard BackupFolderPlugin.isBackupName(name) else { call.reject("not a backup file name"); return }
        io.async {
            do {
                let text: String = try BackupFolderPlugin.withFolder(uri) { folder in
                    var failure: NSError?
                    var result: Result<String, Error> = .failure(CocoaError(.fileReadUnknown))
                    // Older iCloud Drive lists only a placeholder: ask for the download, the coordinated read waits for it.
                    let file = folder.appendingPathComponent(name)
                    if !FileManager.default.fileExists(atPath: file.path) { try? FileManager.default.startDownloadingUbiquitousItem(at: file) }
                    // A coordinated read makes iCloud download a file that is evicted.
                    NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: &failure) { url in
                        result = Result { try String(contentsOf: url, encoding: .utf8) }
                    }
                    if let e = failure { throw e }
                    return try result.get()
                }
                call.resolve(["data": text])
            } catch {
                call.reject("could not read the backup: " + error.localizedDescription, nil, error)
            }
        }
    }

    @objc func release(_ call: CAPPluginCall) {
        if let uri = call.getString("uri"), let key = BackupFolderPlugin.id(of: uri) {
            BackupFolderPlugin.update { $0[key] = nil }
        }
        call.resolve()
    }
}
