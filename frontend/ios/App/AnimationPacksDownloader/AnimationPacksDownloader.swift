import BackgroundAssets
import ExtensionFoundation
import StoreKit

/**
 * The downloader extension Background Assets runs to fetch the app's Apple-hosted asset packs
 * (the exercise animations above 180 px, App/AnimationPacksPlugin.swift). Every pack is on
 * demand: nothing is fetched until the app asks for the quality and figure someone picked, so
 * the extension lets through whatever the app asks for and nothing else is ever scheduled.
 */
@main
struct AnimationPacksDownloader: StoreDownloaderExtension {
    func shouldDownload(_ assetPack: AssetPack) -> Bool {
        return true
    }
}
