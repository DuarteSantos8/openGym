#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Bridges the Swift PrintPlugin into Capacitor's Objective-C plugin registry.
CAP_PLUGIN(PrintPlugin, "Print",
           CAP_PLUGIN_METHOD(printHtml, CAPPluginReturnPromise);
)
