// Guides — website-owned narrative guide pages (not source-owned sidecars).
import tutorialMd from "./tutorial.md?raw";
import deploymentMd from "./deployment.md?raw";

// Concepts — website-owned narrative guide pages (not source-owned sidecars).
import conceptsHowItWorksMd from "./concepts/how-it-works.md?raw";
import conceptsEffectMd from "./concepts/effect.md?raw";
import conceptsThinkingMd from "./concepts/thinking.md?raw";

// Patterns — website-owned guide pages (not source-owned sidecars).
import patternsGlobalStorageMd from "./patterns/global-storage.md?raw";
import patternsFormsMd from "./patterns/forms.md?raw";

// Core model.
import componentsMd from "../../../../packages/core/src/primitives/component.docs.md?raw";
import elementsMd from "../../../../packages/core/src/primitives/element.docs.md?raw";
import rendererMd from "../../../../packages/core/src/primitives/renderer.docs.md?raw";
import signalsMd from "../../../../packages/core/src/primitives/signal.docs.md?raw";
import resourcesMd from "../../../../packages/core/src/primitives/resource.docs.md?raw";
import errorBoundaryMd from "../../../../packages/core/src/primitives/error-boundary.docs.md?raw";

// Composition.
import portalMd from "../../../../packages/core/src/primitives/portal.docs.md?raw";
import headMd from "../../../../packages/core/src/primitives/head.docs.md?raw";
import cxMd from "../../../../packages/core/src/primitives/cx.docs.md?raw";
import securityMd from "../../../../packages/core/src/security/safe-url.docs.md?raw";

// Routing.
import routerOverviewMd from "../../../../packages/core/src/router/router.docs.md?raw";
import routeMd from "../../../../packages/core/src/router/route.docs.md?raw";
import routeCollectionsMd from "../../../../packages/core/src/router/routes.docs.md?raw";
import linksMd from "../../../../packages/core/src/router/link.docs.md?raw";
import navigationMd from "../../../../packages/core/src/router/service.docs.md?raw";
import outletMd from "../../../../packages/core/src/router/outlet.docs.md?raw";
import prefetchMd from "../../../../packages/core/src/router/prefetch.docs.md?raw";
import renderStrategyMd from "../../../../packages/core/src/router/render-strategy.docs.md?raw";
import scrollStrategyMd from "../../../../packages/core/src/router/scroll-strategy.docs.md?raw";
import matchingMd from "../../../../packages/core/src/router/matching.docs.md?raw";
import routeTypesMd from "../../../../packages/core/src/router/types.docs.md?raw";

// Tooling.
import configMd from "../../../../packages/core/src/config.docs.md?raw";
import vitePluginMd from "../../../../packages/core/src/vite/plugin.docs.md?raw";
import apiTypesMd from "../../../../packages/core/src/api/api.docs.md?raw";
import testingMd from "../../../../packages/core/src/testing/testing.docs.md?raw";

export const docsContent: Readonly<Record<string, string>> = {
  "/docs/tutorial": tutorialMd,
  "/docs/deployment": deploymentMd,
  "/docs/concepts/how-it-works": conceptsHowItWorksMd,
  "/docs/concepts/effect": conceptsEffectMd,
  "/docs/concepts/thinking": conceptsThinkingMd,
  "/docs/components": componentsMd,
  "/docs/elements": elementsMd,
  "/docs/renderer": rendererMd,
  "/docs/signals": signalsMd,
  "/docs/resources": resourcesMd,
  "/docs/error-boundary": errorBoundaryMd,
  "/docs/portal": portalMd,
  "/docs/head": headMd,
  "/docs/cx": cxMd,
  "/docs/security": securityMd,
  "/docs/router/overview": routerOverviewMd,
  "/docs/router/routes": routeMd,
  "/docs/router/collections": routeCollectionsMd,
  "/docs/router/links": linksMd,
  "/docs/router/navigation": navigationMd,
  "/docs/router/layouts": outletMd,
  "/docs/router/prefetch": prefetchMd,
  "/docs/router/render-strategy": renderStrategyMd,
  "/docs/router/scroll-strategy": scrollStrategyMd,
  "/docs/router/matching": matchingMd,
  "/docs/router/types": routeTypesMd,
  "/docs/config": configMd,
  "/docs/vite-plugin": vitePluginMd,
  "/docs/api-types": apiTypesMd,
  "/docs/testing": testingMd,
  "/docs/patterns/global-storage": patternsGlobalStorageMd,
  "/docs/patterns/forms": patternsFormsMd,
};
