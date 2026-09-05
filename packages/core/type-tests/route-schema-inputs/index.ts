import { isActive, Link, navigate } from "trygg/router";
import type {
  RouteParamsFor,
  RouteParamsInputFor,
  RouteQueryFor,
  RouteQueryInputFor,
} from "trygg/router";

declare module "trygg/router" {
  interface RouteMap {
    readonly "/events/:at/:count": { readonly at: Date; readonly count: bigint };
    readonly "/search": {};
  }

  interface RouteInputMap {
    readonly "/events/:at/:count": { readonly at: string; readonly count: string };
    readonly "/search": {};
  }

  interface RouteQueryMap {
    readonly "/search": { readonly since: Date; readonly page?: number | undefined };
  }

  interface RouteQueryInputMap {
    readonly "/search": { readonly since: string; readonly page?: string | undefined };
  }
}

const decodedParams: RouteParamsFor<"/events/:at/:count"> = {
  at: new Date("2026-01-01T00:00:00Z"),
  count: 1n,
};
const encodedParams: RouteParamsInputFor<"/events/:at/:count"> = {
  at: "2026-01-01T00:00:00Z",
  count: "1",
};
const decodedQuery: RouteQueryFor<"/search"> = {
  since: new Date("2026-01-01T00:00:00Z"),
  page: 2,
};
const encodedQuery: RouteQueryInputFor<"/search"> = {
  since: "2026-01-01T00:00:00Z",
  page: undefined,
};

Link({ to: "/events/:at/:count", params: encodedParams });
const _encodedNavigation = navigate("/events/:at/:count", { params: encodedParams });
const _encodedActive = isActive("/events/:at/:count", { params: encodedParams });
Link({ to: "/search", query: encodedQuery });
const _encodedQueryNavigation = navigate("/search", { query: encodedQuery });
Link({ to: "/raw/:id", params: { id: 42 } });

// @ts-expect-error Decoded Date and bigint values are not URL-construction inputs.
Link({ to: "/events/:at/:count", params: decodedParams });
// @ts-expect-error Programmatic navigation uses the same encoded input contract.
const _decodedNavigation = navigate("/events/:at/:count", { params: decodedParams });
// @ts-expect-error Active-path interpolation also uses encoded route inputs.
const _decodedActive = isActive("/events/:at/:count", { params: decodedParams });
// @ts-expect-error Dynamic navigation requires all path inputs.
const _missingParamsNavigation = navigate("/events/:at/:count");
// @ts-expect-error Dynamic active checks require all path inputs.
const _missingParamsActive = isActive("/events/:at/:count");
// @ts-expect-error Decoded query values are not serialized as encoded query strings.
Link({ to: "/search", query: decodedQuery });
// @ts-expect-error Programmatic query construction also requires encoded strings.
const _decodedQueryNavigation = navigate("/search", { query: decodedQuery });
