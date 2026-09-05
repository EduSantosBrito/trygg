import { Context } from "effect";
import { Component, mount } from "../../src/index.js";
import type { ElementRequirementsOf } from "../../src/primitives/element.js";

class UserRepository extends Context.Service<UserRepository, { readonly user: string }>()(
  "test/UserRepository",
) {}

const StringService = Context.Service<string>("test/StringService");

const InnerCard = Component.gen(function* () {
  yield* UserRepository;
  return <div>card</div>;
});

const StringCard = Component.gen(function* () {
  const text = yield* StringService;
  return <div>{text}</div>;
});

// FORMA 1: composicao por CHAMADA DIRETA dentro de Component.gen
const ViaCall = Component.gen(function* () {
  return InnerCard({});
});

// FORMA 2 (controle): composicao por JSX
const ViaJsx = Component.gen(function* () {
  return <InnerCard />;
});

const StringViaCall = Component.gen(function* () {
  return StringCard({});
});

type Req<C> = C extends Component.Type<infer _P, infer _E, infer R> ? R : never;
type IsNever<T> = [T] extends [never] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> =
  IsAny<T> extends true
    ? false
    : unknown extends T
      ? [T] extends [unknown]
        ? true
        : false
      : false;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;
type Expect<T extends true> = T;
type ExpectFalse<T extends false> = T;

type DirectCallRequirement = ElementRequirementsOf<ReturnType<typeof InnerCard>>;
type ViaCallRequirement = Req<typeof ViaCall>;
type ViaCallElementRequirement = ElementRequirementsOf<ReturnType<typeof ViaCall>>;
type StringDirectCallRequirement = ElementRequirementsOf<ReturnType<typeof StringCard>>;
type StringViaCallRequirement = Req<typeof StringViaCall>;
type StringViaCallElementRequirement = ElementRequirementsOf<ReturnType<typeof StringViaCall>>;

// The direct callable result and its enclosing Component both preserve the exact service.
export type DirectCallRequiresExactlyUserRepository = Expect<
  Equal<DirectCallRequirement, UserRepository>
>;
export type CallRequirementIsNotNever = ExpectFalse<IsNever<ViaCallRequirement>>;
export type CallRequirementIsNotUnknown = ExpectFalse<IsUnknown<ViaCallRequirement>>;
export type CallRequiresExactlyUserRepository = Expect<Equal<ViaCallRequirement, UserRepository>>;
export type CallableBoundaryRequiresExactlyUserRepository = Expect<
  Equal<ViaCallElementRequirement, UserRepository>
>;

// Primitive identifiers remain exact across the same callable and Component boundaries.
export type StringDirectCallRequirementIsNotNever = ExpectFalse<
  IsNever<StringDirectCallRequirement>
>;
export type StringDirectCallRequirementIsNotUnknown = ExpectFalse<
  IsUnknown<StringDirectCallRequirement>
>;
export type StringDirectCallRequiresExactlyString = Expect<
  Equal<StringDirectCallRequirement, string>
>;
export type StringCallRequirementIsNotNever = ExpectFalse<IsNever<StringViaCallRequirement>>;
export type StringCallRequirementIsNotUnknown = ExpectFalse<IsUnknown<StringViaCallRequirement>>;
export type StringCallRequiresExactlyString = Expect<Equal<StringViaCallRequirement, string>>;
export type StringCallableBoundaryRequiresExactlyString = Expect<
  Equal<StringViaCallElementRequirement, string>
>;

// JSX sem o transform perde R; este fixture registra essa diferenca.
export type JsxErasesService = Expect<IsNever<Req<typeof ViaJsx>>>;

// End-to-end: the callable boundary remains rejected by mount without a layer.
declare const root: HTMLElement;
// @ts-expect-error UserRepository is still required.
mount(root, ViaCall({}));
