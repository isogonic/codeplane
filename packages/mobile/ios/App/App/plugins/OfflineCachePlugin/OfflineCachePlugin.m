//  OfflineCachePlugin.m
//
//  Capacitor plugin registration. Exposes our Swift @objc methods to
//  the Capacitor JS runtime under the plugin name
//  `CodeplaneOfflineCache` (the name the JS side will use with
//  `registerPlugin<NativeOfflineCachePlugin>("CodeplaneOfflineCache", ...)`).
//
//  Drop next to OfflineCachePlugin.swift in
//  `ios/App/App/plugins/OfflineCachePlugin/`.

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CodeplaneOfflineCachePlugin, "CodeplaneOfflineCache",
    CAP_PLUGIN_METHOD(isSupported,    CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(openInstance,   CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(closeInstance,  CAPPluginReturnPromise);
)
