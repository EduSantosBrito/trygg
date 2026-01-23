/**
 * @since 1.0.0
 * Platform Services
 *
 * Effect-native wrappers for browser APIs with test layers.
 */
export { Dom, DomError, type DomService } from "./dom.js";
export { Location, LocationError, type LocationService } from "./location.js";
export { History, HistoryError, type HistoryService } from "./history.js";
export {
  SessionStorage,
  LocalStorage,
  StorageError,
  type StorageService,
  sessionStorageBrowser,
  localStorageBrowser,
  sessionStorageTest,
  localStorageTest,
} from "./storage.js";
export { Scroll, ScrollError, type ScrollService } from "./scroll.js";
export { PlatformEventTarget, EventTargetError, type EventTargetService } from "./event-target.js";
export {
  Observer,
  ObserverError,
  type ObserverService,
  type IntersectionOptions,
  type IntersectionHandle,
} from "./observer.js";
export { Idle, IdleError, type IdleService } from "./idle.js";

export { browser } from "./browser.js";
export { test } from "./test.js";
