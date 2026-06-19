export default {
  expo: {
    name: "Horizon",
    slug: "horizon",
    ios: {
      bundleIdentifier: "com.krithik.horizon",
      infoPlist: {
        UIBackgroundModes: ["location", "audio"], // keep GPS + voice alive in background
        NSMicrophoneUsageDescription: "Lets you talk to your ride group over push-to-talk.",
      },
    },
    android: {
      package: "com.krithik.horizon",
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
    ],
  },
};