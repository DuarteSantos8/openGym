import Foundation
import Capacitor
import CoreLocation
import MapKit

/**
 * The gym reminder's place search on the iPhone (#614): Apple Maps' own search, so the results
 * are the ones people know from the Maps app. Since 1.4.4 build 46 the page draws the screens
 * itself (search first, then a small map to fine-tune, views/GymReminder.jsx) and only asks this
 * plugin for what MapKit knows better than OpenStreetMap:
 *
 *   complete({ query, lat?, lng? })  type-ahead (MKLocalSearchCompleter, gyms first)
 *                                    -> { results: [{ id, title, subtitle, fitness }] }, or
 *                                       { stale: true } when a newer question overtook it
 *   resolve({ id })                  the place of one of those rows (one MKLocalSearch per pick)
 *                                    -> { name, address, lat, lng, fitness } or {} if Apple has none
 *   reverse({ lat, lng })            the street address of a spot (CLGeocoder) -> { address }
 *
 * No API key: MapKit comes with the system. Nothing is kept here and no gym ever goes to Apple,
 * only what is typed and a rough "near here"; the page says so under its search field.
 * The full-screen picker of build 45 (`pick`) is gone: lib/gym-places.js treats a build that
 * answers UNIMPLEMENTED for these calls as one without Apple search and uses OpenStreetMap.
 */
@objc(GymMapPickerPlugin)
public class GymMapPickerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GymMapPickerPlugin"
    public let jsName = "GymMapPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "complete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolve", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reverse", returnType: CAPPluginReturnPromise),
    ]

    // Main thread only: MapKit's completer and search want it.
    private var finder: GymPlaceFinder?
    private var search: MKLocalSearch?
    private let geocoder = CLGeocoder()

    @objc func complete(_ call: CAPPluginCall) {
        let query = (call.getString("query") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var near: CLLocationCoordinate2D?
        if let lat = call.getDouble("lat"), let lng = call.getDouble("lng") {
            let c = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            if CLLocationCoordinate2DIsValid(c) { near = c }
        }
        DispatchQueue.main.async {
            let finder = self.finder ?? GymPlaceFinder()
            self.finder = finder
            finder.complete(query, near: near) { rows, stale in
                if stale { call.resolve(["stale": true, "results": []]) } else { call.resolve(["results": rows]) }
            }
        }
    }

    @objc func resolve(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        DispatchQueue.main.async {
            guard let completion = self.finder?.completion(id) else { call.resolve([:]); return }
            self.search?.cancel()
            let search = MKLocalSearch(request: MKLocalSearch.Request(completion: completion))
            self.search = search
            search.start { response, _ in
                guard let item = response?.mapItems.first else { call.resolve([:]); return }
                let c = item.placemark.coordinate
                call.resolve([
                    "name": item.name ?? completion.title,
                    "address": GymPlaceFinder.addressOf(item.placemark),
                    "lat": c.latitude, "lng": c.longitude,
                    "fitness": item.pointOfInterestCategory == .fitnessCenter,
                ])
            }
        }
    }

    @objc func reverse(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lng = call.getDouble("lng") else { call.resolve(["address": ""]); return }
        DispatchQueue.main.async {
            // One lookup at a time (Apple throttles them): a newer spot cancels the older one,
            // whose call then answers with no address.
            self.geocoder.cancelGeocode()
            self.geocoder.reverseGeocodeLocation(CLLocation(latitude: lat, longitude: lng)) { marks, _ in
                call.resolve(["address": marks?.first.map(GymPlaceFinder.addressOf) ?? ""])
            }
        }
    }
}

/// Two completers side by side: one that only knows fitness centres (those come first and get
/// the "Gym" hint), one for everything else, places and addresses alike.
final class GymPlaceFinder: NSObject, MKLocalSearchCompleterDelegate {
    private let gyms = MKLocalSearchCompleter()
    private let all = MKLocalSearchCompleter()
    private var pending: (([[String: Any]], Bool) -> Void)?
    private var gymsDone = false
    private var allDone = false
    private var timer: Timer?
    private var known: [Int: MKLocalSearchCompletion] = [:]
    private var nextId = 0

    override init() {
        super.init()
        gyms.delegate = self
        all.delegate = self
        gyms.resultTypes = .pointOfInterest
        gyms.pointOfInterestFilter = MKPointOfInterestFilter(including: [.fitnessCenter])
        all.resultTypes = [.pointOfInterest, .address]
    }

    func complete(_ query: String, near: CLLocationCoordinate2D?, done: @escaping ([[String: Any]], Bool) -> Void) {
        pending?([], true)
        pending = done
        if let c = near {
            let region = MKCoordinateRegion(center: c, latitudinalMeters: 30_000, longitudinalMeters: 30_000)
            gyms.region = region
            all.region = region
        }
        guard !query.isEmpty else { finish(); return }
        // The same question again: the completers will not answer twice, so read what they have.
        if gyms.queryFragment == query, all.queryFragment == query, !gyms.isSearching, !all.isSearching {
            gymsDone = true
            allDone = true
            finish()
            return
        }
        gymsDone = false
        allDone = false
        timer?.invalidate()
        // Whatever has come in after a few seconds, rather than a spinner forever.
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in self?.finish() }
        gyms.queryFragment = query
        all.queryFragment = query
    }

    func completion(_ id: String) -> MKLocalSearchCompletion? {
        guard let n = Int(id) else { return nil }
        return known[n]
    }

    func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) { answered(completer) }

    func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) { answered(completer) }

    private func answered(_ completer: MKLocalSearchCompleter) {
        if completer === gyms { gymsDone = true } else { allDone = true }
        if gymsDone && allDone { finish() }
    }

    private func finish() {
        timer?.invalidate()
        timer = nil
        guard let done = pending else { return }
        pending = nil
        var rows: [[String: Any]] = []
        var seen = Set<String>()
        func add(_ c: MKLocalSearchCompletion, fitness: Bool) {
            let key = c.title + "\n" + c.subtitle
            guard !c.title.isEmpty, !seen.contains(key), rows.count < 12 else { return }
            seen.insert(key)
            let id = nextId
            nextId += 1
            known[id] = c
            rows.append(["id": String(id), "title": c.title, "subtitle": c.subtitle, "fitness": fitness])
        }
        if gymsDone { gyms.results.prefix(5).forEach { add($0, fitness: true) } }
        if allDone { all.results.prefix(10).forEach { add($0, fitness: false) } }
        // Rows from the last few answers stay pickable (a tap can race a newer answer).
        if known.count > 120 { known = known.filter { $0.key >= nextId - 60 } }
        done(rows, false)
    }

    /// "Gym St 1, 8000 Zürich": the street and number, then the postcode and town.
    static func addressOf(_ p: CLPlacemark) -> String {
        let street = [p.thoroughfare, p.subThoroughfare].compactMap { $0 }.joined(separator: " ")
        let town = [p.postalCode, p.locality].compactMap { $0 }.joined(separator: " ")
        return [street, town].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
