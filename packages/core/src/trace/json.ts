import { Option, Predicate, Schema } from "effect";

const MAX_DEPTH = 8;
const MAX_ENTRIES = 64;
const MAX_STRING_LENGTH = 2_048;

const CIRCULAR = "[Circular]";
const ACCESSOR = "[Accessor]";
const FUNCTION = "[Function]";
const SYMBOL = "[Symbol]";
const UNDEFINED = "[Undefined]";
const UNSERIALIZABLE = "[Unserializable]";
const TRUNCATED_DEPTH = "[Truncated:Depth]";
const TRUNCATED_ENTRIES = "[Truncated:Entries]";
const TRUNCATED_STRING = "[Truncated:String]";
const TRUNCATED_KEY = "$trygg_truncated";

const OMIT = Symbol("trygg/trace/json/omit");
const INVALID = Symbol("trygg/trace/json/invalid");

const ownKeys = Option.liftThrowable(
  (object: object): ReadonlyArray<PropertyKey> => Reflect.ownKeys(object),
);
const ownDescriptor = Option.liftThrowable(
  (object: object, key: PropertyKey): PropertyDescriptor | undefined =>
    Object.getOwnPropertyDescriptor(object, key),
);
const arrayShape = Option.liftThrowable((object: object): boolean => Array.isArray(object));
const isJsonObject = Schema.is(Schema.JsonObject);

export const detachJsonString = (value: string): string =>
  value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED_STRING}`;

/**
 * Copy a framework telemetry container without invoking accessors. The copy
 * preserves original data values for Schema validation and omits symbol keys.
 * Accessors, cycles, and oversized arrays are rejected. Validation may traverse
 * beyond detached JSON's depth cutoff but remains bounded by the global entry
 * budget. Oversized objects retain only a bounded prefix plus the stable
 * truncation marker, so an open `Schema.JsonObject` field can remain observable
 * without unbounded work.
 */
export const copyOwnDataObject = (input: unknown): object | undefined =>
  Option.getOrUndefined(
    Option.liftThrowable(() => {
      if (!Predicate.isObject(input) || Array.isArray(input)) return undefined;
      const ancestors = new WeakSet<object>();
      const budget = { entries: MAX_ENTRIES };

      const copy = (value: unknown, depth: number): unknown | typeof INVALID => {
        if (typeof value === "string") return value;
        if (value === null || typeof value !== "object") return value;
        if (depth >= MAX_ENTRIES || ancestors.has(value)) return INVALID;
        ancestors.add(value);

        const isArray = Array.isArray(value);
        if (isArray) {
          const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
          if (
            typeof length !== "number" ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > budget.entries
          ) {
            ancestors.delete(value);
            return INVALID;
          }
          budget.entries -= length;
          const result: Array<unknown> = [];
          result.length = length;
          for (let index = 0; index < length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (descriptor === undefined) continue;
            if (!Object.hasOwn(descriptor, "value")) {
              ancestors.delete(value);
              return INVALID;
            }
            const child = copy(descriptor.value, depth + 1);
            if (child === INVALID) {
              ancestors.delete(value);
              return INVALID;
            }
            Object.defineProperty(result, index, {
              configurable: false,
              enumerable: true,
              value: child,
              writable: false,
            });
          }
          ancestors.delete(value);
          return Object.freeze(result);
        }

        const keys = Reflect.ownKeys(value);
        const result: Record<string, unknown> = {};
        if (keys.length > 0 && budget.entries === 0) {
          ancestors.delete(value);
          return INVALID;
        }
        const availableEntries = budget.entries;
        let truncated = keys.length > availableEntries;
        let markerReserved = truncated;
        if (markerReserved) budget.entries--;
        const keyLimit = truncated ? Math.max(0, availableEntries - 1) : keys.length;
        for (let index = 0; index < keyLimit; index++) {
          if (budget.entries === 0) {
            if (markerReserved) break;
            ancestors.delete(value);
            return INVALID;
          }
          budget.entries--;
          const key = keys[index];
          if (typeof key !== "string") continue;
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor === undefined) {
            ancestors.delete(value);
            return INVALID;
          }
          if (descriptor.enumerable !== true) continue;
          if (key === TRUNCATED_KEY) {
            truncated = true;
            markerReserved = true;
            break;
          }
          if (key.length > MAX_STRING_LENGTH || !Object.hasOwn(descriptor, "value")) {
            ancestors.delete(value);
            return INVALID;
          }
          const descriptorValue: unknown = descriptor.value;
          let dynamicMarkerReservation = false;
          if (
            !markerReserved &&
            index + 1 < keys.length &&
            descriptorValue !== null &&
            typeof descriptorValue === "object"
          ) {
            if (budget.entries === 0) {
              truncated = true;
              markerReserved = true;
              break;
            }
            budget.entries--;
            dynamicMarkerReservation = true;
            if (budget.entries === 0) {
              truncated = true;
              markerReserved = true;
              break;
            }
          }
          const child = copy(descriptorValue, depth + 1);
          if (child === INVALID) {
            ancestors.delete(value);
            return INVALID;
          }
          if (dynamicMarkerReservation) {
            if (keys.length - index - 1 > budget.entries) {
              truncated = true;
              markerReserved = true;
            } else {
              budget.entries++;
            }
          }
          Object.defineProperty(result, key, {
            configurable: false,
            enumerable: true,
            value: child,
            writable: false,
          });
        }
        if (truncated) {
          if (!markerReserved) {
            ancestors.delete(value);
            return INVALID;
          }
          Object.defineProperty(result, TRUNCATED_KEY, {
            configurable: false,
            enumerable: true,
            value: TRUNCATED_ENTRIES,
            writable: false,
          });
        }
        ancestors.delete(value);
        return Object.freeze(result);
      };

      const copied = copy(input, 0);
      return copied === INVALID || !Predicate.isObject(copied) ? undefined : copied;
    })(),
  );

/**
 * Detach a proven telemetry container into bounded frozen JSON. This function
 * never calls getters or `toJSON`; application values must be classified before
 * they reach this boundary.
 */
export const detachJson = (input: unknown): Schema.Json => {
  const ancestors = new WeakSet<object>();
  const budget = { entries: MAX_ENTRIES };

  const visit = (value: unknown, depth: number): Schema.Json => {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return detachJsonString(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "undefined") return UNDEFINED;
    if (typeof value === "function") return FUNCTION;
    if (typeof value === "symbol") return SYMBOL;
    if (depth >= MAX_DEPTH) return TRUNCATED_DEPTH;
    if (ancestors.has(value)) return CIRCULAR;
    if (budget.entries === 0) return TRUNCATED_ENTRIES;
    ancestors.add(value);

    const isArray = arrayShape(value);
    if (Option.isNone(isArray)) {
      ancestors.delete(value);
      return UNSERIALIZABLE;
    }

    let result: Schema.Json;
    if (isArray.value) {
      const lengthDescriptor = ownDescriptor(value, "length");
      const lengthValue: unknown = Option.isSome(lengthDescriptor)
        ? lengthDescriptor.value?.value
        : undefined;
      if (
        typeof lengthValue !== "number" ||
        !Number.isSafeInteger(lengthValue) ||
        lengthValue < 0
      ) {
        result = UNSERIALIZABLE;
      } else if (lengthValue > budget.entries) {
        budget.entries--;
        result = Object.freeze([TRUNCATED_ENTRIES]);
      } else {
        const detached: Array<Schema.Json> = [];
        let truncated = false;
        let markerReserved = false;
        for (let index = 0; index < lengthValue; index++) {
          if (budget.entries === 0) {
            truncated = true;
            markerReserved = true;
            break;
          }
          budget.entries--;
          const descriptor = ownDescriptor(value, String(index));
          if (Option.isNone(descriptor) || descriptor.value === undefined) {
            detached.push(UNDEFINED);
          } else if (!Object.hasOwn(descriptor.value, "value")) {
            detached.push(ACCESSOR);
          } else {
            const child: unknown = descriptor.value.value;
            let dynamicMarkerReservation = false;
            if (index + 1 < lengthValue && child !== null && typeof child === "object") {
              if (budget.entries === 0) {
                truncated = true;
                markerReserved = true;
                break;
              }
              budget.entries--;
              dynamicMarkerReservation = true;
            }
            const detachedChild = visit(child, depth + 1);
            if (dynamicMarkerReservation) {
              if (lengthValue - index - 1 > budget.entries) {
                truncated = true;
                markerReserved = true;
                break;
              }
              budget.entries++;
            }
            detached.push(detachedChild);
          }
        }
        result =
          truncated && markerReserved
            ? Object.freeze([TRUNCATED_ENTRIES])
            : Object.freeze(detached);
      }
    } else {
      const keys = ownKeys(value);
      if (Option.isNone(keys)) {
        result = UNSERIALIZABLE;
      } else {
        const detached: Record<string, Schema.Json> = {};
        const availableEntries = budget.entries;
        let truncated = keys.value.length > availableEntries;
        let markerReserved = truncated;
        if (markerReserved) budget.entries--;
        let unserializable = false;
        const keyLimit = truncated ? Math.max(0, availableEntries - 1) : keys.value.length;
        for (let index = 0; index < keyLimit; index++) {
          if (budget.entries === 0) {
            if (!markerReserved) unserializable = true;
            break;
          }
          budget.entries--;
          const key = keys.value[index];
          if (typeof key !== "string") continue;
          const descriptor = Option.getOrUndefined(ownDescriptor(value, key));
          if (descriptor === undefined) {
            unserializable = true;
            break;
          }
          if (descriptor.enumerable !== true) continue;
          if (key === TRUNCATED_KEY || key.length > MAX_STRING_LENGTH) {
            truncated = true;
            markerReserved = true;
            break;
          }
          let child: Schema.Json | typeof OMIT;
          if (!Object.hasOwn(descriptor, "value")) {
            child = ACCESSOR;
          } else {
            const descriptorValue: unknown = descriptor.value;
            let dynamicMarkerReservation = false;
            if (
              !markerReserved &&
              index + 1 < keys.value.length &&
              descriptorValue !== null &&
              typeof descriptorValue === "object"
            ) {
              if (budget.entries === 0) {
                truncated = true;
                markerReserved = true;
                break;
              }
              budget.entries--;
              dynamicMarkerReservation = true;
            }
            child = descriptorValue === undefined ? OMIT : visit(descriptorValue, depth + 1);
            if (dynamicMarkerReservation) {
              if (keys.value.length - index - 1 > budget.entries) {
                truncated = true;
                markerReserved = true;
              } else {
                budget.entries++;
              }
            }
          }
          if (child === OMIT) continue;
          Object.defineProperty(detached, key, {
            configurable: false,
            enumerable: true,
            value: child,
            writable: false,
          });
        }
        if (unserializable) {
          result = UNSERIALIZABLE;
        } else {
          if (truncated && markerReserved) {
            Object.defineProperty(detached, TRUNCATED_KEY, {
              configurable: false,
              enumerable: true,
              value: TRUNCATED_ENTRIES,
              writable: false,
            });
          }
          result = Object.freeze(detached);
        }
      }
    }
    ancestors.delete(value);
    return result;
  };

  return Option.getOrElse(Option.liftThrowable(visit)(input, 0), () => UNSERIALIZABLE);
};

export const detachJsonObject = (input: object): Schema.JsonObject => {
  const detached = detachJson(input);
  return isJsonObject(detached) ? detached : Object.freeze({ value: detached });
};
