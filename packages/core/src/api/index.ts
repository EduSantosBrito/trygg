/**
 * @since 1.0.0
 * API utilities — handler types and typed client factory.
 *
 * @module
 */
export type {
  Handler,
  GroupHandlers,
  Request,
  Success,
  Error,
  Path,
  UrlParams,
  Payload,
  Headers,
} from "./types.js";

export {
  Trygger,
  type ClientOf,
  type TryggerOptions,
  type TryggerTag,
  type TryggerTagOf,
} from "./trygger.js";
