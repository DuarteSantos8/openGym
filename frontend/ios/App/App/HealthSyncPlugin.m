#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(HealthSyncPlugin, "HealthSync",
           CAP_PLUGIN_METHOD(available, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(authorize, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(readWeights, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(writeWeights, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(writeWorkouts, CAPPluginReturnPromise);
)
