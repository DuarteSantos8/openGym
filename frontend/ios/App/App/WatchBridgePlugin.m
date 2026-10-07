#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WatchBridgePlugin, "WatchBridge",
           CAP_PLUGIN_METHOD(publish, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(drain, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(ack, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(launchWorkout, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(prepareNotifications, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(missingThumbnails, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(sendThumbnail, CAPPluginReturnPromise);
)
