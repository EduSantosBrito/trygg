/**
 * @since 1.0.0
 * Combined test layer for all platform services.
 */
import { Layer } from "effect";
import { Dom, test as domTest } from "./dom.js";
import { Location, test as locationTest } from "./location.js";
import { History, test as historyTest } from "./history.js";
import { SessionStorage, LocalStorage, sessionStorageTest, localStorageTest } from "./storage.js";
import { Scroll, test as scrollTest } from "./scroll.js";
import { PlatformEventTarget, test as eventTargetTest } from "./event-target.js";
import { Observer, test as observerTest } from "./observer.js";
import { Idle, test as idleTest } from "./idle.js";

export const test = (
  initialPath: string = "/",
): Layer.Layer<
  | Dom
  | Location
  | History
  | SessionStorage
  | LocalStorage
  | Scroll
  | PlatformEventTarget
  | Observer
  | Idle
> =>
  Layer.mergeAll(
    domTest,
    locationTest(initialPath),
    historyTest,
    sessionStorageTest,
    localStorageTest,
    scrollTest,
    eventTargetTest,
    observerTest,
    idleTest,
  );
