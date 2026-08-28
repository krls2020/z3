/**
 * The client half of the Zerops identity door.
 *
 * A client that is already signed in to Zerops hands its access token to the
 * environment, which proves membership of the project the container runs in
 * and hands back an ordinary pairing credential. From there the flow is the
 * upstream one - the credential goes into the token exchange in `remote.ts`,
 * unchanged - so this module is one request wide.
 *
 * The Zerops token is the subject being proven, not a bearer for this request,
 * so it travels in the body and never as this request's Authorization header.
 *
 * @module authorization/zerops
 */
import * as Effect from "effect/Effect";

import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiClient } from "../rpc/http.ts";

const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 10_000;

export const mintZeropsIdentityCredential = Effect.fn(
  "clientRuntime.authorization.mintZeropsIdentityCredential",
)(function* (input: {
  readonly httpBaseUrl: string;
  readonly zeropsToken: string;
  /**
   * Present when the client binds its access token to a key. The environment
   * binds the grant to the same key, so a stolen credential is unusable.
   */
  readonly dpopProof?: string;
  readonly timeoutMs?: number;
}) {
  const client = yield* makeEnvironmentHttpApiClient(input.httpBaseUrl);
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/api/auth/zerops-identity"),
    input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.zerops.identity({
      headers: input.dpopProof ? { dpop: input.dpopProof } : {},
      payload: { token: input.zeropsToken },
    }),
  );
});
