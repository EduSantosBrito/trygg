import { ConfigProvider, Effect, Exit, Layer, Redacted, Schema } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/unstable/httpapi";
import { assert, describe, it } from "@effect/vitest";
import { Signal } from "trygg";
import ApiLive, {
  Api,
  Incident as IncidentSchema,
  IncidentsHttp,
} from "../../templates/incident/app/api";
import {
  IncidentId,
  IncidentIdFromString,
  IncidentNotFound,
  IncidentTitle,
  InvalidTransition,
  MutationForbidden,
  MutationUnauthenticated,
} from "../../templates/incident/app/errors/incidents";
import {
  TokenMutationPolicyLive,
  DenyMutation,
  MutationAuthorization,
  MutationPolicy,
  MutationTokenConfigurationError,
} from "../../templates/incident/app/services/authorization";
import { Incidents, type IncidentService } from "../../templates/incident/app/services/incidents";
import { MutationAccess } from "../../templates/incident/app/services/mutation-access";
import {
  AppTheme,
  ThemeBrowser,
  ThemeBrowserError,
  ThemeCookieError,
  ThemePreferenceError,
  type ThemeBrowserHost,
} from "../../templates/incident/app/services/theme";

const ACCESS_TOKEN = "test-operator-token-with-at-least-32-characters";
const requestCredential = (header: string) =>
  HttpApiMiddleware.layerClient(MutationAuthorization, ({ request, next }) =>
    next(HttpClientRequest.setHeader(request, "authorization", header)),
  );
const makeIncidentClient = HttpApiTest.groups(Api, ["incidents"]).pipe(
  Effect.provide(requestCredential(`Bearer ${ACCESS_TOKEN}`)),
);
const decodeIncidentIdFromString = Schema.decodeUnknownEffect(IncidentIdFromString);
const decodeIncidentTitle = Schema.decodeUnknownEffect(IncidentTitle);
const decodeIncident = Schema.decodeUnknownEffect(IncidentSchema);
const encodeTokenConfigurationError = Schema.encodeEffect(
  Schema.fromJsonString(MutationTokenConfigurationError),
);

const makeIncidentApiTest = <E, R>(
  policy: Layer.Layer<MutationPolicy, E, R>,
  incidents: Layer.Layer<Incidents> = Incidents.layer,
) => {
  const handlers = IncidentsHttp.layer.pipe(Layer.provideMerge(incidents));
  return Layer.mergeAll(handlers, HttpServer.layerServices).pipe(
    Layer.provideMerge(MutationAuthorization.layer),
    Layer.provideMerge(policy),
  );
};

const TestTokenPolicy = TokenMutationPolicyLive.pipe(
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromUnknown({ INCIDENT_ACCESS_TOKEN: ACCESS_TOKEN })),
  ),
);
const IncidentApiTest = makeIncidentApiTest(TestTokenPolicy);

const requireFirstIncident = <A>(items: ReadonlyArray<A>): A => {
  const incident = items[0];
  return incident === undefined ? assert.fail("Expected a seeded incident") : incident;
};

const makeTrackedIncidents = (state: { acquisitions: number; mutations: number }) => {
  return Layer.effect(
    Incidents,
    Effect.cached(
      Effect.sync(() => {
        state.acquisitions += 1;
        const service = Incidents.make();
        const tracked: IncidentService = {
          ...service,
          create: (params) =>
            Effect.sync(() => {
              state.mutations += 1;
            }).pipe(Effect.andThen(service.create(params))),
          transition: (id, to) =>
            Effect.sync(() => {
              state.mutations += 1;
            }).pipe(Effect.andThen(service.transition(id, to))),
        };
        return tracked;
      }),
    ).pipe(Effect.map((acquire) => Incidents.of({ acquire }))),
  );
};

const themeLayer = (host: ThemeBrowserHost) =>
  AppTheme.layer("dark").pipe(Layer.provide(ThemeBrowser.layer(host)));

describe("incident template contracts", () => {
  for (const scheme of ["bearer ", "Bearer   "]) {
    it.effect(`should accept a legal bearer scheme with ${scheme.length} prefix characters`, () =>
      Effect.gen(function* () {
        // Scope: RFC 6750 allows one or more spaces and HTTP scheme names are case insensitive.
        // Assertion: a valid credential in either legal representation authenticates a real mutation.
        const client = yield* HttpApiTest.groups(Api, ["incidents"]);
        const created = yield* client.incidents.create({
          payload: { title: IncidentTitle.make("Authenticated"), severity: "SEV-2" },
        });
        assert.strictEqual(created.id, IncidentId.make(4));
      }).pipe(
        Effect.provide(Layer.merge(IncidentApiTest, requestCredential(`${scheme}${ACCESS_TOKEN}`))),
      ),
    );
  }

  it.effect("should return a bearer challenge for an unidentified HTTP mutation", () =>
    Effect.gen(function* () {
      // Scope: observes the actual transport response after the middleware rejects authentication.
      // Assertion: clients receive 401 with the Bearer challenge, not a successful fallback.
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            ApiLive.pipe(
              Layer.provide(HttpServer.layerServices),
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
            ),
            { disableLogger: true },
          ),
        ),
        ({ dispose }) => Effect.promise(dispose),
      );
      const response = yield* Effect.promise(() =>
        server.handler(
          new Request("http://localhost/api/incidents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"title":"Unidentified","severity":"SEV-2"}',
          }),
        ),
      );
      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.headers.get("www-authenticate"), 'Bearer realm="incident"');
    }),
  );

  it.effect("should reject malformed server configuration without exposing the credential", () =>
    Effect.gen(function* () {
      // Scope: a server startup configuration error must not echo a rejected secret.
      // Assertion: startup fails with its project tag and a credential-free diagnostic.
      const secret = "private invalid token";
      const error = yield* MutationPolicy.pipe(
        Effect.provide(
          TokenMutationPolicyLive.pipe(
            Layer.provide(
              ConfigProvider.layer(ConfigProvider.fromUnknown({ INCIDENT_ACCESS_TOKEN: secret })),
            ),
          ),
        ),
        Effect.flip,
      );
      assert.instanceOf(error, MutationTokenConfigurationError);
      if (!(error instanceof MutationTokenConfigurationError))
        return assert.fail("Expected token configuration failure");
      const diagnostic = yield* encodeTokenConfigurationError(error);
      assert.notInclude(diagnostic, secret);
    }),
  );

  it.effect("should keep mutations closed when server credentials are not configured", () =>
    Effect.gen(function* () {
      // Scope: the actual default policy reads an empty configuration, even when a client sends a token.
      // Assertion: no repository work occurs and no implicit demo credential enables mutation.
      const state = { acquisitions: 0, mutations: 0 };
      const error = yield* Effect.gen(function* () {
        const client = yield* makeIncidentClient;
        return yield* client.incidents.create({
          payload: { title: IncidentTitle.make("Closed"), severity: "SEV-2" },
        });
      }).pipe(
        Effect.provide(
          makeIncidentApiTest(
            TokenMutationPolicyLive.pipe(
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
            ),
            makeTrackedIncidents(state),
          ),
        ),
        Effect.flip,
      );
      assert.instanceOf(error, MutationUnauthenticated);
      assert.deepStrictEqual(state, { acquisitions: 0, mutations: 0 });
    }),
  );

  for (const header of [
    "",
    "Bearer short",
    `Basic ${ACCESS_TOKEN}`,
    `Bearer ${"x".repeat(513)}`,
    `Bearer ${ACCESS_TOKEN}-wrong`,
  ]) {
    it.effect(
      `should reject invalid mutation credentials (${header.length} bytes) before acquisition`,
      () =>
        Effect.gen(function* () {
          // Scope: malformed and valid-looking wrong credentials cross real client/server middleware and native verification.
          // Assertion: all produce the canonical 401 failure and zero repository work.
          const state = { acquisitions: 0, mutations: 0 };
          const error = yield* Effect.gen(function* () {
            const client = yield* HttpApiTest.groups(Api, ["incidents"]);
            return yield* client.incidents.create({
              payload: { title: IncidentTitle.make("Rejected"), severity: "SEV-2" },
            });
          }).pipe(
            Effect.provide(
              Layer.merge(
                makeIncidentApiTest(TestTokenPolicy, makeTrackedIncidents(state)),
                requestCredential(header),
              ),
            ),
            Effect.flip,
          );
          assert.instanceOf(error, MutationUnauthenticated);
          assert.deepStrictEqual(state, { acquisitions: 0, mutations: 0 });
        }),
    );
  }

  it.effect("should authenticate mutations with the tab credential and revoke them on forget", () =>
    Effect.gen(function* () {
      // Scope: exercises the exact client credential Layer used by AppServicesLive against the real API.
      // Assertion: missing/forgotten credentials fail; a loaded token enables creation with canonical results.
      const access = yield* MutationAccess;
      const client = yield* HttpApiTest.groups(Api, ["incidents"]);
      const create = client.incidents.create({
        payload: { title: IncidentTitle.make("Authenticated"), severity: "SEV-2" },
      });
      assert.instanceOf(yield* Effect.flip(create), MutationUnauthenticated);
      yield* access.setToken(Redacted.make(ACCESS_TOKEN));
      assert.isTrue(yield* Signal.peek(access.configured));
      assert.strictEqual((yield* create).id, IncidentId.make(4));
      yield* access.clear;
      assert.isFalse(yield* Signal.peek(access.configured));
      assert.instanceOf(yield* Effect.flip(create), MutationUnauthenticated);
    }).pipe(
      Effect.provide(
        Layer.merge(
          IncidentApiTest,
          MutationAccess.clientLayer.pipe(Layer.provideMerge(MutationAccess.layer)),
        ),
      ),
    ),
  );

  it.effect("should reject an unidentified mutation before default repository acquisition", () =>
    Effect.gen(function* () {
      // Scope: exercises the default server policy through the actual HTTP contract.
      // Assertion: an unidentified caller cannot acquire or mutate the repository.
      const state = { acquisitions: 0, mutations: 0 };
      const exit = yield* Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(Api, ["incidents"]);
        return yield* client.incidents.create({
          payload: { title: IncidentTitle.make("Unauthenticated"), severity: "SEV-2" },
        });
      }).pipe(
        Effect.provide(makeIncidentApiTest(TokenMutationPolicyLive, makeTrackedIncidents(state))),
        Effect.exit,
      );
      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(state, { acquisitions: 0, mutations: 0 });
    }),
  );

  it.effect("should reject impossible IDs and normalize bounded titles", () =>
    Effect.gen(function* () {
      // Scope: exercises the canonical identity and title schemas used by HTTP, routing, and domain code.
      // Assertion: invalid domain values fail while valid wire IDs and padded titles decode canonically.
      const invalidIds: ReadonlyArray<string> = [
        "-1",
        "0",
        "1.5",
        "NaN",
        "Infinity",
        "9007199254740992",
      ];
      for (const value of invalidIds) {
        const exit = yield* decodeIncidentIdFromString(value).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit), `${value} should not decode as an incident ID`);
      }

      const id = yield* decodeIncidentIdFromString("42");
      assert.strictEqual(id, 42);

      const invalidTitles: ReadonlyArray<string> = ["", "   ", "x".repeat(121)];
      for (const value of invalidTitles) {
        const exit = yield* decodeIncidentTitle(value).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit), "invalid title should fail decoding");
      }

      const title = yield* decodeIncidentTitle("  API latency  ");
      assert.strictEqual(title, "API latency");
    }),
  );

  it.effect("should decode canonical timestamps before incident presentation", () =>
    Effect.gen(function* () {
      // Scope: exercises the shared createdAt/timeline timestamp codec at the HTTP boundary.
      // Assertion: valid wire timestamps become Dates; malformed values fail before presentation runs.
      const encoded = {
        id: 1,
        title: "Timestamp contract",
        severity: "SEV-2",
        status: "Detected",
        timeline: [{ timestamp: "2026-01-15T14:02:00.000Z", message: "Incident created" }],
        createdAt: "2026-01-15T14:02:00.000Z",
      };

      const decoded = yield* decodeIncident(encoded);
      assert.instanceOf(decoded.createdAt, Date);
      assert.instanceOf(decoded.timeline[0]?.timestamp, Date);

      const malformed = [
        { ...encoded, createdAt: "not-a-timestamp" },
        {
          ...encoded,
          timeline: [{ timestamp: "not-a-timestamp", message: "Incident created" }],
        },
      ];
      for (const value of malformed) {
        let presented = 0;
        const exit = yield* decodeIncident(value).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              presented += 1;
            }),
          ),
          Effect.exit,
        );
        assert.isTrue(Exit.isFailure(exit));
        assert.strictEqual(presented, 0);
      }
    }),
  );

  it.effect(
    "should isolate repository state and Date identity across Incidents layer acquisitions",
    () =>
      Effect.gen(function* () {
        // Scope: verifies mutable repository and nested temporal state are owned by each Layer acquisition.
        // Assertion: one acquisition shares a repository; another has fresh objects unaffected by Date mutation.
        const first = yield* Effect.gen(function* () {
          const left = yield* Incidents;
          const right = yield* Incidents;
          assert.strictEqual(left, right);
          const leftRepository = yield* left.acquire;
          const rightRepository = yield* right.acquire;
          assert.strictEqual(leftRepository, rightRepository);

          const seeded = requireFirstIncident(yield* leftRepository.list);
          const seededTimeline = requireFirstIncident(seeded.timeline);
          seeded.createdAt.setUTCFullYear(2040);
          seededTimeline.timestamp.setUTCFullYear(2041);

          const created = yield* leftRepository.create({
            title: IncidentTitle.make("Layer-owned incident"),
            severity: "SEV-3",
          });
          const list = yield* rightRepository.list;
          assert.lengthOf(list, 4);
          return { createdId: created.id, seeded, seededTimeline };
        }).pipe(Effect.provide(Incidents.layer));

        const second = yield* Effect.gen(function* () {
          const incidents = yield* Incidents;
          const repository = yield* incidents.acquire;
          const list = yield* repository.list;
          assert.lengthOf(list, 3);
          const seeded = requireFirstIncident(list);
          const seededTimeline = requireFirstIncident(seeded.timeline);
          const created = yield* repository.create({
            title: IncidentTitle.make("Fresh acquisition"),
            severity: "SEV-4",
          });
          return { created, seeded, seededTimeline };
        }).pipe(Effect.provide(Incidents.layer));

        assert.strictEqual(first.createdId, IncidentId.make(4));
        assert.strictEqual(second.created.id, IncidentId.make(4));
        assert.notStrictEqual(first.seeded, second.seeded);
        assert.notStrictEqual(first.seeded.createdAt, second.seeded.createdAt);
        assert.notStrictEqual(first.seededTimeline.timestamp, second.seededTimeline.timestamp);
        assert.strictEqual(second.seeded.createdAt.toISOString(), "2026-01-15T14:02:00.000Z");
        assert.strictEqual(
          second.seededTimeline.timestamp.toISOString(),
          "2026-01-15T14:02:00.000Z",
        );
      }),
  );

  it.effect(
    "should decide authenticated mutation policy before repository acquisition and mutation",
    () =>
      Effect.gen(function* () {
        // Scope: exercises trusted HttpApi policy ordering and canonical client decoding.
        // Assertion: denial touches no repository; authenticated allow mutates and retains error identity.
        const deniedState = { acquisitions: 0, mutations: 0 };
        const deniedPolicy = MutationPolicy.layer(
          DenyMutation.make({ reason: "Anonymous mutation disabled" }),
        );
        const denied = yield* Effect.gen(function* () {
          const client = yield* makeIncidentClient;
          return yield* client.incidents
            .create({
              payload: {
                title: IncidentTitle.make("Denied authenticated write"),
                severity: "SEV-2",
              },
            })
            .pipe(Effect.flip);
        }).pipe(
          Effect.provide(makeIncidentApiTest(deniedPolicy, makeTrackedIncidents(deniedState))),
        );
        assert.instanceOf(denied, MutationForbidden);
        assert.strictEqual(deniedState.acquisitions, 0);
        assert.strictEqual(deniedState.mutations, 0);

        const allowedState = { acquisitions: 0, mutations: 0 };
        const created = yield* Effect.gen(function* () {
          const client = yield* makeIncidentClient;
          return yield* client.incidents.create({
            payload: {
              title: IncidentTitle.make("Authenticated write"),
              severity: "SEV-2",
            },
          });
        }).pipe(
          Effect.provide(makeIncidentApiTest(TestTokenPolicy, makeTrackedIncidents(allowedState))),
        );
        assert.strictEqual(allowedState.acquisitions, 1);
        assert.strictEqual(allowedState.mutations, 1);
        assert.instanceOf(created.createdAt, Date);
        assert.instanceOf(created.timeline[0]?.timestamp, Date);
        assert.strictEqual(created.id, IncidentId.make(4));

        yield* Effect.gen(function* () {
          const client = yield* makeIncidentClient;
          const missing = yield* client.incidents
            .get({ params: { id: IncidentId.make(999) } })
            .pipe(Effect.flip);
          assert.instanceOf(missing, IncidentNotFound);

          const invalid = yield* client.incidents
            .transition({
              params: { id: IncidentId.make(1) },
              payload: { to: "Resolved" },
            })
            .pipe(Effect.flip);
          assert.instanceOf(invalid, InvalidTransition);
        }).pipe(Effect.provide(IncidentApiTest));
      }),
  );

  it.effect(
    "should translate malformed cookies and unsupported browser capabilities into typed failures",
    () =>
      Effect.gen(function* () {
        // Scope: covers stored input and browser capability failures at AppTheme layer acquisition.
        // Assertion: malformed input and hostile browser operations fail with their canonical typed errors.
        const malformedCookie: ThemeBrowserHost = {
          readCookies: () => "theme=%",
          writeCookie: () => {},
          matchMedia: () => undefined,
        };
        const malformed = yield* AppTheme.pipe(
          Effect.provide(themeLayer(malformedCookie)),
          Effect.flip,
        );
        assert.instanceOf(malformed, ThemeCookieError);

        const invalidPreference: ThemeBrowserHost = {
          readCookies: () => "theme=sepia",
          writeCookie: () => {},
          matchMedia: () => undefined,
        };
        const invalid = yield* AppTheme.pipe(
          Effect.provide(themeLayer(invalidPreference)),
          Effect.flip,
        );
        assert.instanceOf(invalid, ThemePreferenceError);

        const unreadableCookie: ThemeBrowserHost = {
          readCookies: () => {
            // oxlint-disable-next-line effect/no-raw-throw -- Host fake verifies containment of a synchronous cookie getter exception.
            throw new Error("cookie getter denied");
          },
          writeCookie: () => {},
          matchMedia: () => undefined,
        };
        const unreadable = yield* AppTheme.pipe(
          Effect.provide(themeLayer(unreadableCookie)),
          Effect.flip,
        );
        assert.instanceOf(unreadable, ThemeBrowserError);
        assert.strictEqual(unreadable.operation, "readCookie");

        const unsupportedBrowser: ThemeBrowserHost = {
          readCookies: () => "",
          writeCookie: () => {},
          matchMedia: () => null,
        };
        const unsupported = yield* AppTheme.pipe(
          Effect.provide(themeLayer(unsupportedBrowser)),
          Effect.flip,
        );
        assert.instanceOf(unsupported, ThemeBrowserError);
        assert.strictEqual(unsupported.operation, "matchMedia");

        const listenerDenied: ThemeBrowserHost = {
          readCookies: () => "",
          writeCookie: () => {},
          matchMedia: () => ({
            matches: false,
            addChangeListener: () => {
              // oxlint-disable-next-line effect/no-raw-throw -- Host fake verifies containment of listener registration exceptions.
              throw new Error("listener registration denied");
            },
            removeChangeListener: () => {},
          }),
        };
        const listener = yield* AppTheme.pipe(
          Effect.provide(themeLayer(listenerDenied)),
          Effect.flip,
        );
        assert.instanceOf(listener, ThemeBrowserError);
        assert.strictEqual(listener.operation, "addListener");
      }),
  );

  it.effect(
    "should contain cookie setter throws, run media callbacks, and finalize exactly once",
    () =>
      Effect.gen(function* () {
        // Scope: verifies write containment plus callback and listener ownership at the browser boundary.
        // Assertion: callbacks update state, setter failure does not commit, and the same listener is removed once.
        let added = 0;
        let removed = 0;
        let dark = false;
        let registeredListener: (() => void) | undefined;
        let removedListener: (() => void) | undefined;
        const host: ThemeBrowserHost = {
          readCookies: () => "",
          writeCookie: () => {
            // oxlint-disable-next-line effect/no-raw-throw -- Host fake verifies containment of a synchronous browser exception.
            throw new Error("cookie setter denied");
          },
          matchMedia: () => ({
            get matches() {
              return dark;
            },
            addChangeListener: (listener) => {
              added += 1;
              registeredListener = listener;
            },
            removeChangeListener: (listener) => {
              removed += 1;
              removedListener = listener;
              // oxlint-disable-next-line effect/no-raw-throw -- Host fake verifies that finalizer exceptions are contained.
              throw new Error("listener removal denied");
            },
          }),
        };

        yield* Effect.scoped(
          Effect.gen(function* () {
            const theme = yield* AppTheme;
            assert.strictEqual(added, 1);

            dark = true;
            const listener = registeredListener;
            assert.isDefined(listener);
            if (listener !== undefined) {
              listener();
            }
            yield* Effect.yieldNow;
            assert.strictEqual(yield* Signal.peek(theme.mode), "dark");

            const error = yield* theme.setPreference("light").pipe(Effect.flip);
            assert.instanceOf(error, ThemeBrowserError);
            assert.strictEqual(error.operation, "writeCookie");
            assert.strictEqual(yield* Signal.peek(theme.preference), "system");
            assert.strictEqual(yield* Signal.peek(theme.mode), "dark");
          }).pipe(Effect.provide(themeLayer(host))),
        );

        assert.strictEqual(removed, 1);
        assert.strictEqual(removedListener, registeredListener);
      }),
  );
});
