#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Bridges the Swift WatchLinkPlugin into Capacitor's Objective-C plugin registry.
CAP_PLUGIN(WatchLinkPlugin, "WatchLink",
           CAP_PLUGIN_METHOD(status, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(startSession, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(endSession, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(rest, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(clearRest, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(set, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(clearSet, CAPPluginReturnPromise);
)
