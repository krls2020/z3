import { useNavigation } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ZeropsMark } from "../../components/ZeropsMark";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { ConnectionSheetButton } from "../connection/ConnectionSheetButton";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useZeropsAuth } from "./ZeropsAuthProvider";

const ZEROPS_REGISTRATION_URL = "https://app.zerops.io/registration";
const ZEROPS_PASSWORD_RECOVERY_URL = "https://app.zerops.io/forgotten-password";

function LinkButton(props: { readonly label: string; readonly onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={props.onPress} className="px-2 py-1">
      <Text className="text-center text-sm font-t3-medium text-primary">{props.label}</Text>
    </Pressable>
  );
}

function FieldLabel(props: { readonly children: string }) {
  return (
    <Text className="text-2xs font-t3-bold tracking-[0.8px] text-foreground-muted uppercase">
      {props.children}
    </Text>
  );
}

export function SettingsZeropsAccountRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { auth, cancelTwoFactor, retryRestore, signIn, signOut, verifyTwoFactor } = useZeropsAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorToken, setTwoFactorToken] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Zerops sign-in failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const submitLogin = useCallback(() => {
    void run(() => signIn(email, password));
  }, [email, password, run, signIn]);

  const submitTwoFactor = useCallback(() => {
    void run(() => verifyTwoFactor(twoFactorToken));
  }, [run, twoFactorToken, verifyTwoFactor]);

  const openExternal = useCallback((url: string) => {
    void Linking.openURL(url);
  }, []);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Zerops Account" onBack={() => navigation.goBack()} />
        </>
      ) : null}

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <View className="items-center gap-3 py-2">
          <ZeropsMark height={42} />
          <View className="items-center gap-1">
            <Text className="text-2xl font-t3-bold text-foreground">Zerops</Text>
            <Text className="text-center text-sm text-foreground-muted">
              Sign in with the same account you use in the Zerops GUI.
            </Text>
          </View>
        </View>

        {auth.status === "loading" ? (
          <View className="items-center gap-3 rounded-[24px] bg-card px-5 py-10">
            <ActivityIndicator />
            <Text className="text-sm text-foreground-muted">Restoring secure session…</Text>
          </View>
        ) : null}

        {auth.status === "restorationError" ? (
          <View className="gap-4 rounded-[24px] bg-card p-4">
            <ErrorBanner message={auth.message} />
            <ConnectionSheetButton
              icon="arrow.clockwise"
              label={busy ? "Retrying…" : "Try again"}
              disabled={busy}
              tone="primary"
              onPress={() => void run(retryRestore)}
            />
            <ConnectionSheetButton
              icon="rectangle.portrait.and.arrow.right"
              label="Sign out locally"
              disabled={busy}
              onPress={() => void run(signOut)}
            />
          </View>
        ) : null}

        {auth.status === "signedOut" ? (
          <View className="gap-4 rounded-[24px] bg-card p-4">
            <View className="gap-1.5">
              <FieldLabel>Email</FieldLabel>
              <TextInput
                accessibilityLabel="Zerops email"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={submitLogin}
              />
            </View>
            <View className="gap-1.5">
              <FieldLabel>Password</FieldLabel>
              <TextInput
                accessibilityLabel="Zerops password"
                autoCapitalize="none"
                autoComplete="current-password"
                autoCorrect={false}
                secureTextEntry
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={submitLogin}
              />
            </View>
            {error ? <ErrorBanner message={error} /> : null}
            <ConnectionSheetButton
              icon="arrow.right"
              label={busy ? "Signing in…" : "Sign in"}
              disabled={busy || !email.trim() || !password}
              tone="primary"
              onPress={submitLogin}
            />
            <View className="gap-1 border-t border-border pt-3">
              <LinkButton
                label="Forgot password"
                onPress={() => openExternal(ZEROPS_PASSWORD_RECOVERY_URL)}
              />
              <LinkButton
                label="Create a Zerops account"
                onPress={() => openExternal(ZEROPS_REGISTRATION_URL)}
              />
            </View>
          </View>
        ) : null}

        {auth.status === "twoFactor" ? (
          <View className="gap-4 rounded-[24px] bg-card p-4">
            <View className="gap-1">
              <Text className="text-lg font-t3-bold text-foreground">
                Two-factor authentication
              </Text>
              <Text className="text-sm leading-normal text-foreground-muted">
                {recoveryMode
                  ? "Enter one of your 10-character Zerops recovery codes."
                  : "Enter the 6-digit code from your authenticator app."}
              </Text>
            </View>
            <View className="gap-1.5">
              <FieldLabel>{recoveryMode ? "Recovery code" : "Authentication code"}</FieldLabel>
              <TextInput
                accessibilityLabel={
                  recoveryMode ? "Zerops recovery code" : "Zerops two-factor code"
                }
                autoCapitalize="characters"
                autoComplete={recoveryMode ? "off" : "one-time-code"}
                autoCorrect={false}
                keyboardType={recoveryMode ? "default" : "number-pad"}
                maxLength={recoveryMode ? 10 : 6}
                textContentType={recoveryMode ? "none" : "oneTimeCode"}
                value={twoFactorToken}
                onChangeText={setTwoFactorToken}
                onSubmitEditing={submitTwoFactor}
              />
            </View>
            {auth.methods.includes("U2F") && !auth.methods.includes("TOTP") ? (
              <ErrorBanner message="This account requires a security key or passkey. Use a recovery code here; native passkey login will be added in the next authentication slice." />
            ) : null}
            {error ? <ErrorBanner message={error} /> : null}
            <ConnectionSheetButton
              icon={recoveryMode ? "key" : "checkmark.shield"}
              label={busy ? "Verifying…" : recoveryMode ? "Use recovery code" : "Verify code"}
              disabled={busy || twoFactorToken.trim().length !== (recoveryMode ? 10 : 6)}
              tone="primary"
              onPress={submitTwoFactor}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setRecoveryMode((current) => !current);
                setTwoFactorToken("");
                setError(null);
              }}
              className="px-3 py-2"
            >
              <Text className="text-center text-sm font-t3-medium text-primary">
                {recoveryMode ? "Use authenticator code" : "Use recovery code"}
              </Text>
            </Pressable>
            <ConnectionSheetButton
              icon="xmark"
              label="Cancel"
              disabled={busy}
              onPress={() => void run(cancelTwoFactor)}
            />
          </View>
        ) : null}

        {auth.status === "signedIn" ? (
          <>
            {auth.newRecoveryToken ? (
              <View className="gap-2 rounded-[24px] border border-amber-400/40 bg-amber-400/10 p-4">
                <Text className="font-t3-bold text-foreground">Save your new recovery code</Text>
                <Text selectable className="font-mono text-xl text-foreground">
                  {auth.newRecoveryToken}
                </Text>
                <Text className="text-sm leading-normal text-foreground-muted">
                  Zerops rotated this code after recovery login. Store it somewhere safe now.
                </Text>
              </View>
            ) : null}
            <SettingsSection title="Signed in" card>
              <View className="gap-1 p-4">
                <Text className="text-lg font-t3-bold text-foreground">
                  {auth.user.fullName?.trim() || auth.user.email}
                </Text>
                <Text selectable className="text-sm text-foreground-muted">
                  {auth.user.email}
                </Text>
                <Text className="mt-1 text-xs text-foreground-muted">
                  {
                    (auth.user.clientUserList ?? []).filter(
                      (membership) => !membership.status || membership.status === "ACTIVE",
                    ).length
                  }{" "}
                  organization(s)
                </Text>
              </View>
            </SettingsSection>
            {error ? <ErrorBanner message={error} /> : null}
            <ConnectionSheetButton
              icon="rectangle.portrait.and.arrow.right"
              label={busy ? "Signing out…" : "Sign out of Zerops"}
              disabled={busy}
              tone="danger"
              onPress={() => void run(signOut)}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
