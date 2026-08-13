export default {
  expo: {
    name: "Horizon",
    slug: "horizon",
    scheme: "horizon",
    extra: {
      eas: {
           projectId: "d63fd554-61aa-4052-9250-cbe69ab87bcf"
      }
    },
    ios: {
      bundleIdentifier: "com.krithik.horizon",
      infoPlist: {
        UIBackgroundModes: ["location", "audio"], // keep GPS + voice alive in background
        NSMicrophoneUsageDescription: "Lets you talk to your ride group over push-to-talk.",
      },
    },
    android: {
      package: "com.krithik.horizon",
      // Added on top of whatever the plugins declare (this array supplements, it does
      // not replace — blockedPermissions is the removal mechanism).
      //
      // RECEIVE_BOOT_COMPLETED is required by expo-task-manager, not by expo-location,
      // which is why none of expo-location's plugin flags pull it in and why ADR-021 §7's
      // claim that this file needed no change was wrong. TaskManagerUtils schedules a
      // *persisted* JobScheduler job to deliver background location, and Android refuses
      // to persist a job unless the app holds this permission — so the first location
      // delivery hard-crashes the process:
      //
      //   java.lang.IllegalArgumentException: Requested job cannot be persisted without
      //   holding android.permission.RECEIVE_BOOT_COMPLETED permission
      //
      // Found by running it on a device, which is the only way it could have been found:
      // it compiles, type-checks, and passes every test without this line. The persisted
      // job is also what ADR-021 §4's headless-restart path relies on, so this permission
      // is what the design already assumed, not a workaround bolted on around it.
      permissions: ["android.permission.RECEIVE_BOOT_COMPLETED"],
    },
    plugins: [
      "expo-dev-client",
      "@maplibre/maplibre-react-native",
      [
        "expo-location",
        {
          locationWhenInUsePermission: "Shows your position to your ride group.",
          locationAlwaysAndWhenInUsePermission:
            "Keeps sharing your position during a ride when the screen is off.",
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      ["@livekit/react-native-expo-plugin", { android: { audioType: "communication" } }],
      "@config-plugins/react-native-webrtc",
      [
        "expo-image-picker",
        {
          photosPermission: "Lets you add a photo from your gallery to a ride.",
          // Library picks only (PhotoStrip.tsx) — no camera, no microphone, so don't
          // let the plugin add the Android permissions or iOS strings for either.
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
    ],
  },
};