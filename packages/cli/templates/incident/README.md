# Incident Dashboard

This template demonstrates a full-stack incident workflow with mutation authorization enforced at the server boundary.

## Repository Lifetime and Concurrency

The demo repository is in memory and scoped to one Layer acquisition. Restarting
the application resets its incidents; it does not provide durable event delivery,
database migrations, or replayable workflows.

Reads observe state when their Effect executes. Mutations capture their timestamp
before synchronously reading, validating, and committing the current incident.
Concurrent timeline additions retain both entries in commit order. Competing
transitions validate against the latest committed status, so a transition that is
no longer valid fails as `InvalidTransition`.

Creation allocates a new ID on each execution. HTTP retries are not deduplicated;
an application that requires retry-safe creation must add an admission identity
and a repository that stores its result atomically.

## Mutation Authorization

Mutations require an operator access token. Without `INCIDENT_ACCESS_TOKEN`, the
server remains read-only. Create a random token on the server before starting:

```sh
export INCIDENT_ACCESS_TOKEN="$(openssl rand -hex 32)"
bun run dev
```

Set the same environment variable when running the generated production server.
Copy its value securely into the **Mutation access token** field in the sidebar,
then select **Use token**. The token stays in this tab's application memory; the
password input is cleared after submission. **Forget token**, closing the app, or
reloading removes the stored credential. A loaded token is not proof of identity:
the server verifies every protected request.

`MutationAuthorization` accepts a bounded bearer credential from the Authorization
header. The trusted `TokenMutationPolicyLive` verifies it before the handler can
acquire the incident repository. Missing, malformed, or incorrect credentials
produce `MutationUnauthenticated` (401) with a Bearer challenge; an authenticated
policy denial produces `MutationForbidden` (403). Native authentication failures
produce a sanitized 503. Input validation never grants mutation authority.

The configured credential represents one shared `operator` principal. Rotate it
by replacing the server environment value and restarting. Applications needing
individual users, permissions, expiry, or central revocation should replace
`MutationPolicy` with their identity-provider-backed policy. The template's static
credential does not implement those features.

Use HTTPS when exposing the app beyond local development. Bearer credentials give
authority to their holder; keep the token out of URLs, logs, public configuration,
and version control. The client middleware attaches it only to protected API
endpoints. See [Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750) for the
transport requirements. The server uses native [WebCrypto HMAC verification](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify)
against verification material created for its Layer acquisition.
