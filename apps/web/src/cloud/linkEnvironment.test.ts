import { RelayWebClientId } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient } from "effect/unstable/http";
import { afterEach, beforeEach, vi } from "vite-plus/test";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";

import {
  linkPrimaryEnvironmentToCloud,
  normalizeRelayBaseUrl,
  readPrimaryCloudLinkState,
  type CloudLinkTarget,
  unlinkPrimaryEnvironmentFromCloud,
  updatePrimaryCloudPreferences,
} from "./linkEnvironment";

const TARGET: CloudLinkTarget = {
  environmentId: "environment-1",
  label: "Desktop",
  httpBaseUrl: "http://127.0.0.1:3000",
  wsBaseUrl: "ws://127.0.0.1:3000",
};

const createProof = vi.fn(() => Effect.succeed("dpop-proof"));
const dpopSignerLayer = Layer.succeed(
  ManagedRelay.ManagedRelayDpopSigner,
  ManagedRelay.ManagedRelayDpopSigner.of({
    thumbprint: Effect.succeed("thumbprint"),
    createProof,
  }),
);

function relayLayer() {
  const http = remoteHttpClientLayer(globalThis.fetch);
  return Layer.mergeAll(
    http,
    ManagedRelay.layer({
      relayUrl: "https://relay.example.test",
      clientId: RelayWebClientId,
    }).pipe(Layer.provideMerge(dpopSignerLayer), Layer.provide(http)),
  );
}

function withServices<A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient | ManagedRelay.ManagedRelayClient>,
) {
  return effect.pipe(Effect.provide(relayLayer()));
}

function bodyText(body: BodyInit | null | undefined): string {
  return body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("web cloud link environment client", () => {
  it("normalizes relay URLs", () => {
    expect(normalizeRelayBaseUrl(" https://relay.example.test/// ")).toBe(
      "https://relay.example.test",
    );
    expect(normalizeRelayBaseUrl(" ")).toBeNull();
  });

  it.effect("reads primary cloud link state from the explicit target", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.example.test",
          relayIssuer: "https://relay.example.test",
          managedTunnelActive: true,
          publishAgentActivity: false,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const state = yield* withServices(readPrimaryCloudLinkState({ target: TARGET }));

      expect(Option.fromNullishOr(state)).toEqual(
        Option.some({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.example.test",
          relayIssuer: "https://relay.example.test",
          managedTunnelActive: true,
          publishAgentActivity: false,
        }),
      );
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "http://127.0.0.1:3000/api/connect/link-state",
      );
    }),
  );

  it.effect("updates agent activity publishing for the explicit primary target", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.example.test",
          relayIssuer: "https://relay.example.test",
          managedTunnelActive: true,
          publishAgentActivity: true,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const state = yield* withServices(
        updatePrimaryCloudPreferences({
          target: TARGET,
          publishAgentActivity: true,
        }),
      );

      expect(state.publishAgentActivity).toBe(true);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "http://127.0.0.1:3000/api/connect/preferences",
      );
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      expect(JSON.parse(bodyText(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
        publishAgentActivity: true,
      });
    }),
  );

  it.effect("links an environment publish-only, with no managed tunnel", () =>
    Effect.gen(function* () {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            challenge: "challenge",
            expiresAt: "2026-06-06T00:05:00.000Z",
          }),
        )
        .mockResolvedValueOnce(Response.json("signed-proof"))
        .mockResolvedValueOnce(
          Response.json({
            ok: true,
            environmentId: TARGET.environmentId,
            endpoint: {
              httpBaseUrl: TARGET.httpBaseUrl,
              wsBaseUrl: TARGET.wsBaseUrl,
              providerKind: "manual",
            },
            relayIssuer: "https://relay.example.test",
            cloudUserId: "user-1",
            environmentCredential: "environment-credential",
            cloudMintPublicKey: "public-key",
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ ok: true, endpointRuntimeStatus: { status: "disabled" } }),
        );
      vi.stubGlobal("fetch", fetchMock);

      yield* withServices(
        linkPrimaryEnvironmentToCloud({
          target: TARGET,
          zeropsToken: "zerops-token",
        }),
      );

      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://relay.example.test/v1/client/environment-link-challenges",
      );
      expect(fetchMock.mock.calls[0]?.[1]?.headers.authorization).toBe("Bearer zerops-token");
      expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
        "http://127.0.0.1:3000/api/connect/link-proof",
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      expect(JSON.parse(bodyText(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
        challenge: "challenge",
        endpoint: {
          httpBaseUrl: TARGET.httpBaseUrl,
          wsBaseUrl: TARGET.wsBaseUrl,
          providerKind: "manual",
        },
      });
      expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
        "https://relay.example.test/v1/client/environment-links",
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const relayConfigBody = JSON.parse(bodyText(fetchMock.mock.calls[3]?.[1]?.body)) as unknown;
      expect(relayConfigBody).toMatchObject({ endpointRuntime: null });
    }),
  );

  it.effect("unlinks locally without contacting the relay", () =>
    Effect.gen(function* () {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ok: true, endpointRuntimeStatus: { status: "disabled" } }),
        );
      vi.stubGlobal("fetch", fetchMock);

      yield* withServices(unlinkPrimaryEnvironmentFromCloud({ target: TARGET }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:3000/api/connect/unlink");
    }),
  );
});
