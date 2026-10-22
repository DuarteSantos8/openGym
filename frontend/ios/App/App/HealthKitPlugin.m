#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Bridges the Swift HealthKitPlugin into Capacitor's Objective-C plugin registry.
CAP_PLUGIN(HealthKitPlugin, "HealthKit",
           CAP_PLUGIN_METHOD(status, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(requestPermissions, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(write, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(remove, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(openSettings, CAPPluginReturnPromise);
)
