import Foundation
import Capacitor
import Photos

/**
 * Saves a picture the app drew (the share card after a workout, a progress comparison) straight
 * into Photos. Add-only access: openGym can put pictures in, never read the library.
 *
 *   const SaveImage = registerPlugin('SaveImage')
 *   await SaveImage.save({ path: 'file:///…/Caches/opengym-workout.png' })   // { saved: true }
 * Rejects with code "denied" when the person said no, so the page can point to Settings.
 */
@objc(SaveImagePlugin)
public class SaveImagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SaveImagePlugin"
    public let jsName = "SaveImage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
    ]

    @objc func save(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = URL(string: path), url.isFileURL else {
            call.reject("path must be a file URL")
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Not allowed to add to Photos", "denied")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url)
            }) { ok, error in
                if ok { call.resolve(["saved": true]) } else { call.reject(error?.localizedDescription ?? "Could not save") }
            }
        }
    }
}
