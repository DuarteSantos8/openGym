import AVFoundation
import Capacitor
import Foundation
import UIKit
import Vision

/**
 * Form check (lib/form-check-native.js): the camera full screen over the web view, with Vision's
 * 2D body pose drawn on it as a skeleton, and the joints sent to the page about 15 times a second.
 * The page's drill counts the reps and measures them (lib/form-drills/); this side only sees.
 * No frame is recorded, kept or sent anywhere: each one is read by Vision and dropped.
 *
 * Usage from JS:
 *   const FormCheck = registerPlugin('FormCheck')
 *   await FormCheck.available()                      -> { available }  (false on the simulator)
 *   FormCheck.addListener('pose', e => ...)          { t: ms, aspect: w / h, joints: { leftHip: [x, y, conf], ... } }
 *   FormCheck.addListener('closed', () => ...)       Done tapped, or stop()
 *   await FormCheck.start({ camera: 'back' | 'front', labels: { done, flip } })
 *   await FormCheck.setStatus({ text, reps, highlight, quiet }) the status line, the big count, and
 *                                                    the joints drawn large and green ([] none): the rep
 *                                                    under way meets the standard (the drill's choice).
 *                                                    A new count is read out to VoiceOver unless `quiet`
 *                                                    (a hold's seconds, which change every second)
 *   await FormCheck.feedback({ kind, text })         'counted': a green flash of the screen edge and a
 *                                                    light tap; 'missed': a red flash and an error buzz.
 *                                                    `text`, when given, is read out to VoiceOver (a
 *                                                    no-rep's reason, a hold's "20 seconds"). The count
 *                                                    does not move.
 *   await FormCheck.stop()
 *
 * Joints are in normalised image coordinates with y growing downward (Vision's origin is the
 * bottom left), only the ones Vision is reasonably sure of. The image is upright, in portrait or,
 * with the phone turned on its side (a body lying along the floor fills more of it), in landscape,
 * and for the front camera mirrored like the preview, so the skeleton lands on the picture. `aspect`
 * is that upright image's width over its height, so it follows the turn.
 */
@objc(FormCheckPlugin)
public class FormCheckPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FormCheckPlugin"
    public let jsName = "FormCheck"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "feedback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var shown: FormCheckViewController?

    @objc func available(_ call: CAPPluginCall) {
        #if targetEnvironment(simulator)
        call.resolve(["available": false])
        #else
        let any = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
            || AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) != nil
        call.resolve(["available": any])
        #endif
    }

    @objc func start(_ call: CAPPluginCall) {
        let front = call.getString("camera") == "front"
        let labels = call.getObject("labels") ?? [:]
        let done = labels["done"] as? String ?? "Done"
        let flip = labels["flip"] as? String ?? "Switch camera"
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            present(call, front: front, done: done, flip: flip)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted { self.present(call, front: front, done: done, flip: flip) } else { call.reject("Camera access is off", "denied") }
            }
        default:
            call.reject("Camera access is off", "denied")
        }
    }

    private func present(_ call: CAPPluginCall, front: Bool, done: String, flip: String) {
        DispatchQueue.main.async { [self] in
            guard self.shown == nil else { call.reject("already open", "busy"); return }
            guard let host = self.bridge?.viewController else { call.reject("no view", "failed"); return }
            let vc = FormCheckViewController(front: front, doneTitle: done, flipTitle: flip)
            vc.onPose = { [weak self] pose in self?.notifyListeners("pose", data: pose) }
            vc.onClose = { [weak self] in
                self?.shown = nil
                self?.notifyListeners("closed", data: [:])
            }
            self.shown = vc
            host.present(vc, animated: true) { call.resolve() }
        }
    }

    @objc func setStatus(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let reps = call.getInt("reps") ?? 0
        let highlight = Set(call.getArray("highlight", String.self) ?? [])
        let quiet = call.getBool("quiet") ?? false
        DispatchQueue.main.async {
            self.shown?.setStatus(text, reps: reps, highlight: highlight, quiet: quiet)
            call.resolve()
        }
    }

    @objc func feedback(_ call: CAPPluginCall) {
        let missed = call.getString("kind") == "missed"
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async {
            self.shown?.feedback(missed: missed, text: text)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let vc = self.shown { vc.dismiss(animated: true) }
            call.resolve()
        }
    }
}

/// The camera, the skeleton over it, a status line, the rep count, a camera flip and Done.
final class FormCheckViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onPose: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?

    private var front: Bool
    private let doneTitle: String
    private let flipTitle: String
    private let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let sessionQueue = DispatchQueue(label: "opengym.formcheck.session")
    private let videoQueue = DispatchQueue(label: "opengym.formcheck.video")
    private let request = VNDetectHumanBodyPoseRequest()
    private var preview: AVCaptureVideoPreviewLayer!
    private let skeleton = SkeletonView()
    private let status = UILabel()
    private let reps = UILabel()
    private let edge = UIView()
    private let haptics = UINotificationFeedbackGenerator()
    private var lastSent: Double = 0       // video queue only
    private var sessionOrientation: AVCaptureVideoOrientation = .portrait   // session queue only
    private var wasIdleDisabled = false
    private var closed = false

    /// About 15 poses a second: enough to time a rep, light on the bridge and the battery.
    private static let minInterval = 1.0 / 15
    private static let minConfidence: Float = 0.2
    private static let names: [(VNHumanBodyPoseObservation.JointName, String)] = [
        (.nose, "nose"), (.neck, "neck"),
        (.leftShoulder, "leftShoulder"), (.rightShoulder, "rightShoulder"),
        (.leftElbow, "leftElbow"), (.rightElbow, "rightElbow"),
        (.leftWrist, "leftWrist"), (.rightWrist, "rightWrist"),
        (.leftHip, "leftHip"), (.rightHip, "rightHip"),
        (.leftKnee, "leftKnee"), (.rightKnee, "rightKnee"),
        (.leftAnkle, "leftAnkle"), (.rightAnkle, "rightAnkle"),
        (.root, "root"),
    ]

    init(front: Bool, doneTitle: String, flipTitle: String) {
        self.front = front
        self.doneTitle = doneTitle
        self.flipTitle = flipTitle
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // Portrait, or on its side for a body lying along the floor (a plank fills a landscape frame).
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override var prefersStatusBarHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        preview = AVCaptureVideoPreviewLayer(session: session)
        // Fit, not fill: the joints map onto the picture without guessing what was cropped.
        preview.videoGravity = .resizeAspect
        view.layer.addSublayer(preview)

        skeleton.isOpaque = false
        skeleton.backgroundColor = .clear
        skeleton.isUserInteractionEnabled = false
        view.addSubview(skeleton)

        reps.font = .monospacedDigitSystemFont(ofSize: 96, weight: .bold)
        reps.textColor = .white
        reps.textAlignment = .center
        reps.text = "0"
        reps.accessibilityTraits = .updatesFrequently
        shadow(reps)

        status.font = .preferredFont(forTextStyle: .headline)
        status.adjustsFontForContentSizeCategory = true
        status.textColor = .white
        status.textAlignment = .center
        status.numberOfLines = 2
        shadow(status)

        var doneConfig = UIButton.Configuration.filled()
        doneConfig.title = doneTitle
        doneConfig.cornerStyle = .capsule
        doneConfig.baseBackgroundColor = .white
        doneConfig.baseForegroundColor = .black
        doneConfig.contentInsets = NSDirectionalEdgeInsets(top: 18, leading: 48, bottom: 18, trailing: 48)
        doneConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
            var a = a
            a.font = .systemFont(ofSize: 22, weight: .semibold)
            return a
        }
        let done = UIButton(configuration: doneConfig, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })

        var flipConfig = UIButton.Configuration.gray()
        flipConfig.image = UIImage(systemName: "arrow.triangle.2.circlepath.camera")
        flipConfig.cornerStyle = .capsule
        let flip = UIButton(configuration: flipConfig, primaryAction: UIAction { [weak self] _ in self?.flipCamera() })
        flip.accessibilityLabel = flipTitle

        // The flash: a coloured frame round the screen, faded in and out on each rep.
        edge.isUserInteractionEnabled = false
        edge.backgroundColor = .clear
        edge.layer.borderWidth = 14
        edge.alpha = 0
        view.addSubview(edge)

        for v in [reps, status, done, flip] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(v)
        }
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            flip.topAnchor.constraint(equalTo: g.topAnchor, constant: 12),
            flip.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
            reps.topAnchor.constraint(equalTo: g.topAnchor, constant: 8),
            reps.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            status.topAnchor.constraint(equalTo: reps.bottomAnchor, constant: 4),
            status.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 24),
            status.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -24),
            done.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -24),
            done.centerXAnchor.constraint(equalTo: g.centerXAnchor),
        ])

        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.setSampleBufferDelegate(self, queue: videoQueue)
        sessionQueue.async { self.configure() }
    }

    private func shadow(_ label: UILabel) {
        label.layer.shadowColor = UIColor.black.cgColor
        label.layer.shadowOpacity = 0.8
        label.layer.shadowRadius = 4
        label.layer.shadowOffset = .zero
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview.frame = view.bounds
        skeleton.frame = view.bounds
        edge.frame = view.bounds
    }

    /// The interface's orientation as the camera's, main thread only. The two enums name the
    /// landscapes alike (by where the home side is), unlike UIDeviceOrientation.
    private var interfaceVideoOrientation: AVCaptureVideoOrientation {
        switch view.window?.windowScene?.interfaceOrientation ?? .portrait {
        case .landscapeLeft: return .landscapeLeft
        case .landscapeRight: return .landscapeRight
        default: return .portrait
        }
    }

    /// Turns the preview and the frames Vision reads with the interface, so both stay upright.
    /// Main thread; the output's connection is turned on the session queue.
    private func followOrientation() {
        let o = interfaceVideoOrientation
        if let c = preview.connection, c.isVideoOrientationSupported, c.videoOrientation != o { c.videoOrientation = o }
        sessionQueue.async {
            self.sessionOrientation = o
            if let c = self.output.connection(with: .video), c.isVideoOrientationSupported, c.videoOrientation != o { c.videoOrientation = o }
        }
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in self?.followOrientation() }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        followOrientation()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // The phone is propped up out of reach for the whole set: it must not lock.
        wasIdleDisabled = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        UIApplication.shared.isIdleTimerDisabled = wasIdleDisabled
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
        if !closed {
            closed = true
            onClose?()
        }
    }

    func setStatus(_ text: String, reps count: Int, highlight: Set<String>, quiet: Bool) {
        skeleton.highlight = highlight
        status.text = text
        status.isHidden = text.isEmpty
        let shownCount = String(count)
        if reps.text != shownCount {
            reps.text = shownCount
            if !quiet { UIAccessibility.post(notification: .announcement, argument: shownCount) }
        }
    }

    func feedback(missed: Bool, text: String) {
        edge.layer.borderColor = (missed ? UIColor.systemRed : UIColor.systemGreen).cgColor
        edge.layer.removeAllAnimations()
        edge.alpha = 1
        UIView.animate(withDuration: missed ? 0.9 : 0.5, delay: 0.15, options: [.curveEaseOut, .allowUserInteraction]) {
            self.edge.alpha = 0
        }
        haptics.notificationOccurred(missed ? .error : .success)
        haptics.prepare()
        if !text.isEmpty { UIAccessibility.post(notification: .announcement, argument: text) }
    }

    // Session queue only.
    private func configure() {
        session.beginConfiguration()
        // 720p is plenty for a body filling the frame, and keeps Vision fast.
        if session.canSetSessionPreset(.hd1280x720) { session.sessionPreset = .hd1280x720 }
        if session.canAddOutput(output) { session.addOutput(output) }
        attachCamera()
        session.commitConfiguration()
        session.startRunning()
    }

    // Session queue only, inside a configuration.
    private func attachCamera() {
        for input in session.inputs { session.removeInput(input) }
        let position: AVCaptureDevice.Position = front ? .front : .back
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)
        // Upright frames (portrait or landscape, as the interface is), mirrored for the front
        // camera like the preview: Vision then sees what the lifter sees, and its points land on
        // the picture as they are.
        if let c = output.connection(with: .video) {
            if c.isVideoOrientationSupported { c.videoOrientation = sessionOrientation }
            if c.isVideoMirroringSupported {
                c.automaticallyAdjustsVideoMirroring = false
                c.isVideoMirrored = front
            }
        }
        let mirrored = front
        DispatchQueue.main.async {
            if let c = self.preview.connection {
                if c.isVideoOrientationSupported { c.videoOrientation = self.interfaceVideoOrientation }
                if c.isVideoMirroringSupported {
                    c.automaticallyAdjustsVideoMirroring = false
                    c.isVideoMirrored = mirrored
                }
            }
        }
    }

    private func flipCamera() {
        front.toggle()
        skeleton.joints = [:]
        sessionQueue.async {
            self.session.beginConfiguration()
            self.attachCamera()
            self.session.commitConfiguration()
        }
    }

    // Video queue.
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let time = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        guard time.isFinite, time - lastSent >= FormCheckViewController.minInterval else { return }
        lastSent = time
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let size = CGSize(width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels))
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up, options: [:])
        do { try handler.perform([request]) } catch { return }
        let body = largest(request.results ?? [])
        var joints: [String: Any] = [:]
        var points: [String: CGPoint] = [:]
        if let body = body, let all = try? body.recognizedPoints(.all) {
            for (name, key) in FormCheckViewController.names {
                guard let p = all[name], p.confidence >= FormCheckViewController.minConfidence else { continue }
                let x = Double(p.location.x), y = 1 - Double(p.location.y)
                joints[key] = [x, y, Double(p.confidence)]
                points[key] = CGPoint(x: x, y: y)
            }
        }
        let pose: [String: Any] = [
            "t": (time * 1000).rounded(),
            "aspect": size.height > 0 ? Double(size.width / size.height) : 1,
            "joints": joints,
        ]
        DispatchQueue.main.async {
            guard !self.closed else { return }
            self.skeleton.imageRect = AVMakeRect(aspectRatio: size, insideRect: self.view.bounds)
            self.skeleton.joints = points
            self.onPose?(pose)
        }
    }

    /// The person nearest the camera, when Vision finds more than one: the widest spread of points.
    private func largest(_ bodies: [VNHumanBodyPoseObservation]) -> VNHumanBodyPoseObservation? {
        guard bodies.count > 1 else { return bodies.first }
        func area(_ b: VNHumanBodyPoseObservation) -> CGFloat {
            guard let all = try? b.recognizedPoints(.all) else { return 0 }
            let ps = all.values.filter { $0.confidence >= FormCheckViewController.minConfidence }.map { $0.location }
            guard let minX = ps.map({ $0.x }).min(), let maxX = ps.map({ $0.x }).max(),
                  let minY = ps.map({ $0.y }).min(), let maxY = ps.map({ $0.y }).max() else { return 0 }
            return (maxX - minX) * (maxY - minY)
        }
        return bodies.max { area($0) < area($1) }
    }
}

/// Joints and bones over the picture, in the picture's own rectangle (the preview is aspect-fit).
final class SkeletonView: UIView {
    var imageRect: CGRect = .zero
    var joints: [String: CGPoint] = [:] { didSet { setNeedsDisplay() } }
    /// The joints the drill lights up once the rep under way meets its standard: larger and green.
    var highlight: Set<String> = [] { didSet { if highlight != oldValue { setNeedsDisplay() } } }

    private static let bones: [(String, String)] = [
        ("nose", "neck"), ("neck", "leftShoulder"), ("neck", "rightShoulder"),
        ("leftShoulder", "leftElbow"), ("leftElbow", "leftWrist"),
        ("rightShoulder", "rightElbow"), ("rightElbow", "rightWrist"),
        ("leftShoulder", "leftHip"), ("rightShoulder", "rightHip"), ("leftHip", "rightHip"),
        ("leftHip", "leftKnee"), ("leftKnee", "leftAnkle"),
        ("rightHip", "rightKnee"), ("rightKnee", "rightAnkle"),
    ]

    private func place(_ p: CGPoint) -> CGPoint {
        CGPoint(x: imageRect.minX + p.x * imageRect.width, y: imageRect.minY + p.y * imageRect.height)
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext(), !joints.isEmpty, imageRect.width > 0 else { return }
        ctx.setLineCap(.round)
        ctx.setLineWidth(5)
        ctx.setStrokeColor(UIColor.systemGreen.withAlphaComponent(0.85).cgColor)
        for (a, b) in SkeletonView.bones {
            guard let p = joints[a], let q = joints[b] else { continue }
            ctx.move(to: place(p))
            ctx.addLine(to: place(q))
        }
        ctx.strokePath()
        ctx.setFillColor(UIColor.white.cgColor)
        for p in joints.values {
            let c = place(p)
            ctx.fillEllipse(in: CGRect(x: c.x - 5, y: c.y - 5, width: 10, height: 10))
        }
        guard !highlight.isEmpty else { return }
        ctx.setFillColor(UIColor.systemGreen.cgColor)
        ctx.setStrokeColor(UIColor.white.cgColor)
        ctx.setLineWidth(3)
        for key in highlight {
            guard let p = joints[key] else { continue }
            let c = place(p)
            let dot = CGRect(x: c.x - 11, y: c.y - 11, width: 22, height: 22)
            ctx.fillEllipse(in: dot)
            ctx.strokeEllipse(in: dot)
        }
    }
}
