/**
 * Pixel-ladder brand mark.
 *
 * Renders the trygg mark via an img tag referencing /mark.svg.
 */
import { Component } from "trygg";

export const Logo = Component.gen(function* () {
  return <img src="/mark.svg" alt="trygg" width={28} height={28} />;
});
