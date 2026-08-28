import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { StatusPill, type StatusTone } from "../../components/StatusPill";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { ConnectionSheetButton } from "../connection/ConnectionSheetButton";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useZeropsAuth } from "./ZeropsAuthProvider";
import {
  categorizeZeropsService,
  ZeropsApiError,
  type ZeropsClient,
  type ZeropsProject,
  type ZeropsProjectOverview,
  type ZeropsService,
  type ZeropsServiceGroup,
} from "./zerops-api";

const SERVICE_GROUPS: ReadonlyArray<{
  readonly id: ZeropsServiceGroup;
  readonly label: string;
}> = [
  { id: "runtimes", label: "Runtimes" },
  { id: "data", label: "Data" },
  { id: "infrastructure", label: "Infrastructure" },
];

function statusTone(status: string): StatusTone {
  switch (status.toUpperCase()) {
    case "ACTIVE":
    case "RUNNING":
      return {
        label: status,
        pillClassName: "bg-emerald-500/14",
        textClassName: "text-emerald-700 dark:text-emerald-300",
      };
    case "FAILED":
    case "ERROR":
      return {
        label: status,
        pillClassName: "bg-rose-500/14",
        textClassName: "text-rose-700 dark:text-rose-300",
      };
    default:
      return {
        label: status,
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-muted",
      };
  }
}

function formatResource(value: number, suffix: string): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
}

function ServiceRow(props: { readonly service: ZeropsService }) {
  const autoscaling = props.service.currentAutoscaling?.verticalAutoscaling;
  const type = props.service.serviceStackTypeInfo;
  return (
    <View className="gap-1.5 border-t border-border px-4 py-3 first:border-t-0">
      <View className="flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-base font-t3-bold text-foreground" numberOfLines={1}>
          {props.service.name}
        </Text>
        <StatusPill size="compact" {...statusTone(props.service.status)} />
      </View>
      <Text className="text-xs text-foreground-muted">
        {type.serviceStackTypeName} · {type.serviceStackTypeVersionName}
      </Text>
      {autoscaling ? (
        <Text className="text-xs text-foreground-muted">
          CPU {formatResource(autoscaling.minResource.cpuCoreCount, "×")}–
          {formatResource(autoscaling.maxResource.cpuCoreCount, "×")} · RAM{" "}
          {formatResource(autoscaling.minResource.memoryGBytes, " GB")}–
          {formatResource(autoscaling.maxResource.memoryGBytes, " GB")}
        </Text>
      ) : null}
    </View>
  );
}

function OrganizationSwitcher(props: {
  readonly clients: ReadonlyArray<ZeropsClient>;
  readonly activeClientId: string | null;
  readonly onSelect: (clientId: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="px-2 text-sm font-t3-medium text-foreground-muted">Organization</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-0.5"
      >
        {props.clients.map((client) => {
          const active = client.id === props.activeClientId;
          return (
            <Pressable
              key={client.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => props.onSelect(client.id)}
              className={cn(
                "min-h-11 flex-row items-center gap-2 rounded-full border px-4 py-2.5",
                active ? "border-primary bg-primary" : "border-border bg-card",
              )}
            >
              <Text
                className={cn(
                  "text-sm font-t3-bold",
                  active ? "text-primary-foreground" : "text-foreground",
                )}
              >
                {client.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function SettingsZeropsProjectsRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const iconColor = useThemeColor("--color-icon");
  const { onChangeConnectionPairingUrl } = useRemoteConnections();
  const { api, auth, selection, selectClient, selectProject } = useZeropsAuth();
  const [clients, setClients] = useState<ReadonlyArray<ZeropsClient>>([]);
  const [projects, setProjects] = useState<ReadonlyArray<ZeropsProject>>([]);
  const [overview, setOverview] = useState<ZeropsProjectOverview | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const projectsGeneration = useRef(0);
  const overviewGeneration = useRef(0);

  const activeClientId = useMemo(() => {
    if (selection?.clientId && clients.some((client) => client.id === selection.clientId)) {
      return selection.clientId;
    }
    return clients[0]?.id ?? null;
  }, [clients, selection?.clientId]);
  const clientProjects = useMemo(
    () => projects.filter((project) => project.clientId === activeClientId),
    [activeClientId, projects],
  );
  const activeProjectId = useMemo(() => {
    if (
      selection?.projectId &&
      clientProjects.some((project) => project.id === selection.projectId)
    ) {
      return selection.projectId;
    }
    return clientProjects[0]?.id ?? null;
  }, [clientProjects, selection?.projectId]);

  useEffect(() => {
    if (auth.status !== "signedIn") {
      setClients([]);
      setProjects([]);
      return;
    }
    projectsGeneration.current += 1;
    const generation = projectsGeneration.current;
    const cancelled = () => projectsGeneration.current !== generation;
    const memberships = api.clientsFromUser(auth.user);
    setClients(memberships);
    setLoadingProjects(true);
    setProjectsError(null);

    void api
      .fetchAllProjects(memberships)
      .then((nextProjects) => {
        if (cancelled()) return;
        setProjects(nextProjects);
      })
      .catch((error) => {
        if (cancelled()) return;
        setProjectsError(
          error instanceof ZeropsApiError || error instanceof Error
            ? error.message
            : "Could not load Zerops projects.",
        );
      })
      .finally(() => {
        if (!cancelled()) setLoadingProjects(false);
      });

    return () => {
      projectsGeneration.current += 1;
    };
  }, [api, auth, refreshNonce]);

  useEffect(() => {
    if (activeClientId && activeClientId !== selection?.clientId) {
      selectClient(activeClientId);
    }
  }, [activeClientId, selectClient, selection?.clientId]);

  useEffect(() => {
    if (
      activeProjectId &&
      activeClientId === selection?.clientId &&
      activeProjectId !== selection.projectId
    ) {
      selectProject(activeProjectId);
    }
  }, [activeClientId, activeProjectId, selectProject, selection?.clientId, selection?.projectId]);

  useEffect(() => {
    overviewGeneration.current += 1;
    const generation = overviewGeneration.current;
    if (auth.status !== "signedIn" || !activeProjectId) {
      setOverview(null);
      setOverviewError(null);
      setLoadingOverview(false);
      return;
    }
    setOverview(null);
    setOverviewError(null);
    setLoadingOverview(true);
    void api
      .fetchProjectOverview(activeProjectId)
      .then((nextOverview) => {
        if (overviewGeneration.current === generation) setOverview(nextOverview);
      })
      .catch((error) => {
        if (overviewGeneration.current !== generation) return;
        setOverviewError(
          error instanceof ZeropsApiError || error instanceof Error
            ? error.message
            : "Could not load project services.",
        );
      })
      .finally(() => {
        if (overviewGeneration.current === generation) setLoadingOverview(false);
      });
    return () => {
      overviewGeneration.current += 1;
    };
  }, [activeProjectId, api, auth.status, refreshNonce]);

  const groupedServices = useMemo(() => {
    const groups: Record<ZeropsServiceGroup, ZeropsService[]> = {
      runtimes: [],
      data: [],
      infrastructure: [],
    };
    for (const service of overview?.services ?? []) {
      groups[categorizeZeropsService(service)].push(service);
    }
    return groups;
  }, [overview?.services]);

  const connectZcp = useCallback(() => {
    if (!overview?.zcpService) return;
    onChangeConnectionPairingUrl(overview.zcpService.url);
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: { screen: "SettingsEnvironmentNew" },
    });
  }, [navigation, onChangeConnectionPairingUrl, overview?.zcpService]);

  const openAccount = useCallback(() => {
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: { screen: "SettingsZeropsAccount" },
    });
  }, [navigation]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            title="Zerops Projects"
            onBack={() => navigation.goBack()}
            actions={
              auth.status === "signedIn"
                ? [
                    {
                      accessibilityLabel: "Refresh Zerops projects",
                      icon: "arrow.clockwise",
                      onPress: () => setRefreshNonce((current) => current + 1),
                    },
                  ]
                : undefined
            }
          />
        </>
      ) : auth.status === "signedIn" ? (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            icon="arrow.clockwise"
            onPress={() => setRefreshNonce((current) => current + 1)}
            separateBackground
            tintColor={iconColor}
          />
        </NativeHeaderToolbar>
      ) : null}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          auth.status === "signedIn" ? (
            <RefreshControl
              refreshing={loadingProjects && projects.length > 0}
              onRefresh={() => setRefreshNonce((current) => current + 1)}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {auth.status === "loading" ? (
          <View className="items-center gap-3 rounded-[24px] bg-card px-5 py-10">
            <ActivityIndicator />
            <Text className="text-sm text-foreground-muted">Restoring Zerops session…</Text>
          </View>
        ) : null}

        {auth.status === "signedOut" || auth.status === "restorationError" ? (
          <EmptyState
            title="Sign in to Zerops"
            detail="Use your Zerops account to see every organization and project available to you."
            actionLabel="Open Zerops Account"
            onAction={openAccount}
          />
        ) : null}

        {auth.status === "twoFactor" ? (
          <EmptyState
            title="Finish two-factor authentication"
            detail="Complete the Zerops login before loading projects."
            actionLabel="Open Zerops Account"
            onAction={openAccount}
          />
        ) : null}

        {auth.status === "signedIn" ? (
          <>
            {clients.length > 0 ? (
              <OrganizationSwitcher
                clients={clients}
                activeClientId={activeClientId}
                onSelect={selectClient}
              />
            ) : null}

            {projectsError ? <ErrorBanner message={projectsError} /> : null}

            {loadingProjects && projects.length === 0 ? (
              <View className="items-center gap-3 rounded-[24px] bg-card px-5 py-10">
                <ActivityIndicator />
                <Text className="text-sm text-foreground-muted">Loading projects…</Text>
              </View>
            ) : null}

            {!loadingProjects && clients.length === 0 && !projectsError ? (
              <EmptyState
                title="No active organization"
                detail="This Zerops account is not an active member of an organization yet."
              />
            ) : null}

            {!loadingProjects &&
            clients.length > 0 &&
            clientProjects.length === 0 &&
            !projectsError ? (
              <EmptyState
                title="No projects"
                detail="This organization does not have any projects yet."
              />
            ) : null}

            {clientProjects.length > 0 ? (
              <SettingsSection title="Projects" card>
                {clientProjects.map((project, index) => {
                  const active = project.id === activeProjectId;
                  return (
                    <Pressable
                      key={project.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => selectProject(project.id)}
                      className={cn(
                        "min-h-16 flex-row items-center gap-3 px-4 py-3",
                        index > 0 && "border-t border-border",
                        active && "bg-subtle",
                      )}
                    >
                      <View className="min-w-0 flex-1 gap-1">
                        <Text className="text-base font-t3-bold text-foreground" numberOfLines={1}>
                          {project.name}
                        </Text>
                        <Text className="text-xs text-foreground-muted">{project.clientName}</Text>
                      </View>
                      <StatusPill size="compact" {...statusTone(project.status)} />
                      <SymbolView
                        name={active ? "checkmark.circle.fill" : "circle"}
                        size={18}
                        tintColor={iconColor}
                        type="monochrome"
                      />
                    </Pressable>
                  );
                })}
              </SettingsSection>
            ) : null}

            {loadingOverview ? (
              <View className="items-center gap-3 rounded-[24px] bg-card px-5 py-8">
                <ActivityIndicator />
                <Text className="text-sm text-foreground-muted">Loading project services…</Text>
              </View>
            ) : null}

            {overviewError ? <ErrorBanner message={overviewError} /> : null}

            {overview ? (
              <>
                <SettingsSection title="Active project" card>
                  <View className="gap-2 p-4">
                    <View className="flex-row items-center gap-2">
                      <Text className="min-w-0 flex-1 text-xl font-t3-bold text-foreground">
                        {overview.name}
                      </Text>
                      <StatusPill size="compact" {...statusTone(overview.status)} />
                    </View>
                    {overview.subdomainPrefix ? (
                      <Text selectable className="font-mono text-xs text-foreground-muted">
                        {overview.subdomainPrefix}
                      </Text>
                    ) : null}
                    {overview.zcpService ? (
                      <>
                        <Text selectable className="font-mono text-xs text-foreground-muted">
                          {overview.zcpService.url}
                        </Text>
                        <ConnectionSheetButton
                          icon="point.3.connected.trianglepath.dotted"
                          label="Connect zcp environment"
                          tone="primary"
                          onPress={connectZcp}
                        />
                        <Text className="text-xs leading-normal text-foreground-muted">
                          The host is prefilled. Enter the one-time pairing code from this project's
                          zcp service to authorize the device.
                        </Text>
                      </>
                    ) : (
                      <Text className="text-sm text-foreground-muted">
                        This project does not expose a zcp service yet.
                      </Text>
                    )}
                  </View>
                </SettingsSection>

                {SERVICE_GROUPS.map((group) =>
                  groupedServices[group.id].length > 0 ? (
                    <SettingsSection key={group.id} title={group.label} card>
                      {groupedServices[group.id].map((service) => (
                        <ServiceRow key={service.id} service={service} />
                      ))}
                    </SettingsSection>
                  ) : null,
                )}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
