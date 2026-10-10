#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Bridges the Swift AppleHealthPlugin into Capacitor's Objective-C plugin registry.
CAP_PLUGIN(AppleHealthPlugin, "AppleHealth",
           CAP_PLUGIN_METHOD(status, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(requestPermissions, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(write, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(remove, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(readWeights, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(openSettings, CAPPluginReturnPromise);
)
