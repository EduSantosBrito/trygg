import componentsMd from "../../../../packages/core/src/primitives/component.docs.md?raw";
import elementsMd from "../../../../packages/core/src/primitives/element.docs.md?raw";
import signalsMd from "../../../../packages/core/src/primitives/signal.docs.md?raw";
import resourcesMd from "../../../../packages/core/src/primitives/resource.docs.md?raw";
import errorBoundaryMd from "../../../../packages/core/src/primitives/error-boundary.docs.md?raw";
import portalMd from "../../../../packages/core/src/primitives/portal.docs.md?raw";
import headMd from "../../../../packages/core/src/primitives/head.docs.md?raw";
import securityMd from "../../../../packages/core/src/security/safe-url.docs.md?raw";
import routesMd from "../../../../packages/core/src/router/route.docs.md?raw";
import linksMd from "../../../../packages/core/src/router/link.docs.md?raw";
import navigationMd from "../../../../packages/core/src/router/service.docs.md?raw";
import matchingMd from "../../../../packages/core/src/router/matching.docs.md?raw";
import outletMd from "../../../../packages/core/src/router/outlet.docs.md?raw";
import routerMd from "../../../../packages/core/src/router/router.docs.md?raw";
import jsxRuntimeMd from "../../../../packages/core/src/jsx-runtime.docs.md?raw";
import jsxDevMd from "../../../../packages/core/src/jsx-dev-runtime.docs.md?raw";
import apiTypesMd from "../../../../packages/core/src/api/api.docs.md?raw";
import configMd from "../../../../packages/core/src/config.docs.md?raw";
import vitePluginMd from "../../../../packages/core/src/vite/plugin.docs.md?raw";
import testingMd from "../../../../packages/core/src/testing/testing.docs.md?raw";
import debugMd from "../../../../packages/core/src/debug/debug.docs.md?raw";
import metricsMd from "../../../../packages/core/src/debug/metrics.docs.md?raw";

export const docsContent: Readonly<Record<string, string>> = {
  "/docs/components": componentsMd,
  "/docs/elements": elementsMd,
  "/docs/signals": signalsMd,
  "/docs/resources": resourcesMd,
  "/docs/error-boundary": errorBoundaryMd,
  "/docs/portal": portalMd,
  "/docs/head": headMd,
  "/docs/security": securityMd,
  "/docs/router/routes": routesMd,
  "/docs/router/links": linksMd,
  "/docs/router/navigation": navigationMd,
  "/docs/router/layouts": outletMd,
  "/docs/router/middleware": matchingMd,
  "/docs/router/params": routerMd,
  "/docs/jsx-runtime": jsxRuntimeMd,
  "/docs/jsx-dev": jsxDevMd,
  "/docs/api-types": apiTypesMd,
  "/docs/config": configMd,
  "/docs/vite-plugin": vitePluginMd,
  "/docs/testing": testingMd,
  "/docs/debug": debugMd,
  "/docs/metrics": metricsMd,
};
