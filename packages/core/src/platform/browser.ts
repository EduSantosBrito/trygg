/**
 * @since 1.0.0
 * Combined browser layer for all platform services.
 */
import { Layer } from "effect";
import { Dom, browser as domBrowser } from "./dom.js";
import { Location, browser as locationBrowser } from "./location.js";
import { History, browser as historyBrowser } from "./history.js";
import {
  SessionStorage,
  LocalStorage,
  sessionStorageBrowser,
  localStorageBrowser,
} from "./storage.js";
import { Scroll, browser as scrollBrowser } from "./scroll.js";
import { PlatformEventTarget, browser as eventTargetBrowser } from "./event-target.js";
import { Observer, browser as observerBrowser } from "./observer.js";
import { Idle, browser as idleBrowser } from "./idle.js";

export const browser: Layer.Layer<
  | Dom
  | Location
  | History
  | SessionStorage
  | LocalStorage
  | Scroll
  | PlatformEventTarget
  | Observer
  | Idle
> = Layer.mergeAll(
  domBrowser,
  locationBrowser,
  historyBrowser,
  sessionStorageBrowser,
  localStorageBrowser,
  scrollBrowser,
  eventTargetBrowser,
  observerBrowser,
  idleBrowser,
);
