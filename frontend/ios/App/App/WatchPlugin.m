#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Bridges the Swift WatchPlugin into Capacitor's Objective-C plugin registry.
CAP_PLUGIN(WatchPlugin, "Watch",
           CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(status, CAPPluginReturnPromise);
)
