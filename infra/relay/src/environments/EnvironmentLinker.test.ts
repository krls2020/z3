import * as NodeCrypto from "node:crypto";
import type {
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkRequest,
} from "@t3tools/contracts/relay";
import { RELAY_LINK_PROOF_TYP } from "@t3tools/shared/relayJwt";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as DpopProofs from "../auth/DpopProofs.ts";
import * as RelayTokens from "../auth/RelayTokens.ts";
import * as EnvironmentCredentials from "./EnvironmentCredentials.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";
import * as RelayConfiguration from "../Config.ts";
import * as EnvironmentLinker from "./EnvironmentLinker.ts";

const relayKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
const environmentKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
const config = RelayConfiguration.RelayConfiguration.of({
  relayIssuer: "https://relay.example.test",
  apns: {
    environment: "sandbox",
    teamId: "team-id",
    keyId: "key-id",
    privateKey: Redacted.make("private-key"),
    bundleId: "com.t3tools.t3code.dev",
  },
  apnsDeliveryJobSigningSecret: Redacted.make("job-secret"),
  clerkSecretKey: Redacted.make("clerk-secret"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "t3-code-relay",
  cloudMintPrivateKey: Redacted.make(relayKeyPair.privateKey),
  cloudMintPublicKey: relayKeyPair.publicKey,
});
const isEnvironmentLinkProofInvalid = Schema.is(EnvironmentLinker.EnvironmentLinkProofInvalid);

function signTestJwt(payload: object, typ: string, privateKey: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ })).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${encodedPayload}`;
  return `${signingInput}.${NodeCrypto.sign(null, Buffer.from(signingInput), privateKey).toString("base64url")}`;
}

function makeLinkProofPayload(overrides: {
  readonly challenge: string;
  readonly nowSeconds: number;
  readonly expiresAtSeconds: number;
  readonly endpoint?: RelayEnvironmentLinkProofPayload["endpoint"];
}): RelayEnvironmentLinkProofPayload {
  return {
    iss: "t3-env:env-link-test",
    aud: "https://relay.example.test",
    sub: "env-link-test",
    jti: "link-proof-jti",
    iat: overrides.nowSeconds,
    exp: overrides.expiresAtSeconds,
    challenge: overrides.challenge,
    environmentId: "env-link-test" as RelayEnvironmentLinkProofPayload["environmentId"],
    descriptor: {
      environmentId: "env-link-test" as RelayEnvironmentLinkProofPayload["environmentId"],
      label: "Link Test Environment",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    environmentPublicKey: environmentKeyPair.publicKey.trim(),
    endpoint: overrides.endpoint ?? {
      httpBaseUrl: "https://env.example.test/",
      wsBaseUrl: "wss://env.example.test/",
      providerKind: "manual",
    },
    origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
    scopes: ["agent_activity_notifications"],
  };
}

const makeRequest = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const expiresAt = DateTime.add(now, { minutes: 5 });
  const relayTokens = yield* RelayTokens.RelayTokens;
  const challenge = yield* relayTokens.issueLinkChallenge({
    userId: "user_123",
    request: {
      notificationsEnabled: true,
      liveActivitiesEnabled: true,
    },
    jti: "challenge-jti",
    issuedAtEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
    expiresAtEpochSeconds: Math.floor(expiresAt.epochMilliseconds / 1_000),
  });
  const payload = makeLinkProofPayload({
    challenge,
    nowSeconds: Math.floor(now.epochMilliseconds / 1_000),
    expiresAtSeconds: Math.floor(expiresAt.epochMilliseconds / 1_000),
  });
  return {
    request: {
      proof: signTestJwt(payload, RELAY_LINK_PROOF_TYP, environmentKeyPair.privateKey),
      notificationsEnabled: true,
      liveActivitiesEnabled: true,
    } satisfies RelayEnvironmentLinkRequest,
    payload,
  };
});

function testLayer(input?: {
  readonly upsert?: EnvironmentLinks.EnvironmentLinks["Service"]["upsert"];
  readonly consume?: DpopProofs.DpopProofReplay["Service"]["consume"];
}) {
  return EnvironmentLinker.layer.pipe(
    Layer.provideMerge(RelayTokens.layer),
    Layer.provide(
      Layer.mergeAll(
        RelayConfiguration.layer(config),
        Layer.succeed(DpopProofs.DpopProofReplay, {
          verifyAndConsume: () => Effect.die("unexpected DPoP proof verification"),
          consume: input?.consume ?? (() => Effect.succeed(true)),
          pruneExpired: Effect.void,
        }),
        Layer.succeed(EnvironmentLinks.EnvironmentLinks, {
          upsert: input?.upsert ?? (() => Effect.void),
          listUsersForEnvironment: () => Effect.succeed([]),
          listDeliveryUsersForEnvironment: () => Effect.succeed([]),
          listPublicKeysForEnvironment: () => Effect.succeed([]),
        }),
        Layer.succeed(EnvironmentCredentials.EnvironmentCredentials, {
          create: () => Effect.succeed("t3env_credential_secret"),
          authenticate: () => Effect.succeedNone,
        }),
      ),
    ),
  );
}

describe("EnvironmentLinker", () => {
  it.effect("uses verified JWT claims when linking an environment", () => {
    let persistedEnvironmentId: string | null = null;
    return Effect.gen(function* () {
      const { request, payload } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* linker.link({ userId: "user_123", request });
      expect(result.environmentId).toBe(payload.environmentId);
      expect(result.endpoint).toEqual(payload.endpoint);
      expect(result.environmentCredential).toBe("t3env_credential_secret");
      expect(persistedEnvironmentId).toBe(payload.environmentId);
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: (input) =>
            Effect.sync(() => {
              persistedEnvironmentId = input.proof.environmentId;
            }),
        }),
      ),
    );
  });

  it.effect("rejects a link whose declared endpoint is not HTTPS/WSS", () => {
    let persisted = false;
    return Effect.gen(function* () {
      const now = yield* DateTime.now;
      const expiresAt = DateTime.add(now, { minutes: 5 });
      const relayTokens = yield* RelayTokens.RelayTokens;
      const challenge = yield* relayTokens.issueLinkChallenge({
        userId: "user_123",
        request: { notificationsEnabled: true, liveActivitiesEnabled: true },
        jti: "insecure-endpoint-challenge-jti",
        issuedAtEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        expiresAtEpochSeconds: Math.floor(expiresAt.epochMilliseconds / 1_000),
      });
      const payload = makeLinkProofPayload({
        challenge,
        nowSeconds: Math.floor(now.epochMilliseconds / 1_000),
        expiresAtSeconds: Math.floor(expiresAt.epochMilliseconds / 1_000),
        endpoint: {
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          providerKind: "manual",
        },
      });
      const request = {
        proof: signTestJwt(payload, RELAY_LINK_PROOF_TYP, environmentKeyPair.privateKey),
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
      } satisfies RelayEnvironmentLinkRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* Effect.result(linker.link({ userId: "user_123", request }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(isEnvironmentLinkProofInvalid(result.failure)).toBe(true);
        if (isEnvironmentLinkProofInvalid(result.failure)) {
          expect(result.failure).toMatchObject({
            userId: "user_123",
            environmentId: "env-link-test",
            reason: "endpoint_not_secure",
            stage: "validate_endpoint",
          });
        }
      }
      expect(persisted).toBe(false);
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: () =>
            Effect.sync(() => {
              persisted = true;
            }),
        }),
      ),
    );
  });

  it.effect("rejects a tampered compact proof before persistence", () => {
    let persisted = false;
    return Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const segments = request.proof.split(".");
      const signature = segments[2]!;
      segments[2] = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
      const tampered = { ...request, proof: segments.join(".") };
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* Effect.result(linker.link({ userId: "user_123", request: tampered }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(isEnvironmentLinkProofInvalid(result.failure)).toBe(true);
        if (isEnvironmentLinkProofInvalid(result.failure)) {
          expect(result.failure).toMatchObject({
            userId: "user_123",
            environmentId: "env-link-test",
            reason: "invalid_signature_or_scope",
            stage: "verify_proof",
            cause: { _tag: "RelayJwtError" },
          });
        }
      }
      expect(persisted).toBe(false);
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: () =>
            Effect.sync(() => {
              persisted = true;
            }),
        }),
      ),
    );
  });

  it.effect("rejects replayed JWT ids", () =>
    Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* Effect.result(linker.link({ userId: "user_123", request }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(isEnvironmentLinkProofInvalid(result.failure)).toBe(true);
        if (isEnvironmentLinkProofInvalid(result.failure)) {
          expect(result.failure).toMatchObject({
            userId: "user_123",
            environmentId: "env-link-test",
            reason: "replayed_nonce",
            stage: "consume_proof_nonce",
          });
        }
      }
    }).pipe(Effect.provide(testLayer({ consume: () => Effect.succeed(false) }))),
  );
});
