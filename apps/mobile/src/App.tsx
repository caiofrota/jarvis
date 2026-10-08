import {
  companionOrigin,
  companionUserAgent,
  externalWebLink,
  sameServer,
  systemAccountSetup,
} from "@jarvis/api-client";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { messages as t } from "./messages";

const serverKey = "jarvis.companion.server";
function Companion() {
  const [initializing, setInitializing] = useState(true),
    [origin, setOrigin] = useState<string | null>(null);
  const [address, setAddress] = useState(""),
    [error, setError] = useState(""),
    [connecting, setConnecting] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active"),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(serverKey)
      .then((value) => {
        if (!mounted || !value) return;
        const saved = companionOrigin(value);
        setAddress(saved);
        setOrigin(saved);
      })
      .catch(() => {
        if (mounted) setError(t.storageError);
      })
      .finally(() => {
        if (mounted) setInitializing(false);
      });
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  const connect = async () => {
    setError("");
    setConnecting(true);
    try {
      const next = companionOrigin(address);
      if (Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: t.microphoneTitle,
            message: t.microphoneMessage,
            buttonPositive: t.allow,
            buttonNegative: t.cancel,
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED)
          Alert.alert(t.microphoneTitle, t.microphoneDenied);
      }
      await SecureStore.setItemAsync(serverKey, next);
      setFailed(false);
      setAddress(next);
      setOrigin(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.connectionError);
    } finally {
      setConnecting(false);
    }
  };
  const changeServer = () =>
    Alert.alert(t.changeTitle, t.changeMessage, [
      { text: t.cancel, style: "cancel" },
      {
        text: t.confirmChange,
        onPress: () => {
          SecureStore.deleteItemAsync(serverKey)
            .then(() => {
              setOrigin(null);
              setFailed(false);
              setError("");
            })
            .catch(() => setError(t.storageError));
        },
      },
    ]);
  const navigate = (url: string) => {
    if (url === "about:blank") return true;
    if (origin && sameServer(url, origin) && !systemAccountSetup(url, origin)) return true;
    if (externalWebLink(url))
      void Linking.openURL(url).catch(() => Alert.alert(t.title, t.connectionError));
    return false;
  };
  if (initializing)
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#62e5ff" size="large" />
      </View>
    );
  if (!origin)
    return (
      <KeyboardAvoidingView
        style={styles.center}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <View style={styles.orb}>
            <View style={styles.orbInner} />
          </View>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.body}>{t.subtitle}</Text>
          <Text style={styles.label}>{t.server}</Text>
          <TextInput
            accessibilityLabel={t.server}
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder={t.placeholder}
            placeholderTextColor="#66788b"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void connect()}
            editable={!connecting}
          />
          <Text style={styles.hint}>{t.certificateHint}</Text>
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            disabled={connecting}
            onPress={() => void connect()}
          >
            <Text style={styles.buttonText}>{connecting ? t.connecting : t.connect}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>{t.title}</Text>
        <Pressable accessibilityRole="button" onPress={changeServer} style={styles.headerButton}>
          <Text style={styles.body}>{t.change}</Text>
        </Pressable>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {failed ? (
        <View style={styles.center}>
          <View style={styles.card}>
            <Text style={styles.body}>{t.connectionError}</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.button}
              onPress={() => {
                setFailed(false);
                setRevision((v) => v + 1);
              }}
            >
              <Text style={styles.buttonText}>{t.retry}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        active && (
          <WebView
            key={`${origin}:${revision}`}
            source={{ uri: `${origin}/studio` }}
            applicationNameForUserAgent={companionUserAgent}
            style={styles.webview}
            originWhitelist={["https://*"]}
            onShouldStartLoadWithRequest={(request) => navigate(request.url)}
            onOpenWindow={({ nativeEvent }) => {
              navigate(nativeEvent.targetUrl);
            }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
            onHttpError={({ nativeEvent }) => {
              if (nativeEvent.statusCode >= 500) {
                setFailed(true);
                setLoading(false);
              }
            }}
            mediaCapturePermissionGrantType="grantIfSameHostElseDeny"
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            mixedContentMode="never"
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            setSupportMultipleWindows
            webviewDebuggingEnabled={false}
            javaScriptCanOpenWindowsAutomatically={false}
            automaticallyAdjustContentInsets={false}
          />
        )
      )}
      {loading && !failed && active && (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator color="#62e5ff" size="large" />
          <Text style={styles.body}>{t.loading}</Text>
        </View>
      )}
    </View>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#090e14" />
        <Companion />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#090e14" },
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  card: { width: "100%", maxWidth: 440, gap: 18 },
  title: { fontSize: 36, color: "#eff8ff", textAlign: "center", fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 24, color: "#b6c8d9" },
  label: { fontSize: 14, color: "#cde2ee", marginTop: 12 },
  hint: { fontSize: 13, lineHeight: 20, color: "#839bad" },
  input: {
    height: 56,
    borderWidth: 1,
    borderColor: "#284757",
    borderRadius: 14,
    paddingHorizontal: 16,
    color: "#eff8ff",
    fontSize: 16,
    backgroundColor: "#0e1b26",
  },
  button: {
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#62e5ff",
  },
  buttonText: { color: "#08232d", fontSize: 16, fontWeight: "600" },
  error: { color: "#ff9e9e", fontSize: 14, lineHeight: 22 },
  orb: {
    height: 90,
    width: 90,
    alignSelf: "center",
    borderWidth: 2,
    borderColor: "#62e5ff",
    borderRadius: 45,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  orbInner: {
    height: 64,
    width: 64,
    borderWidth: 1,
    borderColor: "#1d667e",
    borderRadius: 32,
    backgroundColor: "#0c2532",
  },
  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#1c303c",
  },
  brand: { color: "#62e5ff", fontSize: 20, fontWeight: "600" },
  headerButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  webview: { flex: 1, backgroundColor: "#090e14" },
  loading: {
    position: "absolute",
    top: 60,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    backgroundColor: "#090e14",
  },
});
