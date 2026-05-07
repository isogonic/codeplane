//  LiveActivitiesPlugin.m
//
//  Capacitor plugin registration. This is the bridge that exposes our
//  Swift @objc methods to the Capacitor JS runtime under the plugin
//  name `CodeplaneLiveActivities` (matches the registerPlugin call in
//  `live-activities.ts`).
//
//  Drop next to LiveActivitiesPlugin.swift in
//  `ios/App/App/plugins/LiveActivitiesPlugin/`.

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CodeplaneLiveActivitiesPlugin, "CodeplaneLiveActivities",
    CAP_PLUGIN_METHOD(isSupported, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(end, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(list, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(registerForUpdates, CAPPluginReturnPromise);
)
