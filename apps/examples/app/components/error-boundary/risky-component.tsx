import { Component, type ComponentProps } from "trygg";
import { NetworkError } from "./network-error-display";
import { ValidationError } from "./validation-error-display";
import { UnknownError } from "./unknown-error-display";
import { SuccessDisplay } from "./success-display";

export type AppError = NetworkError | ValidationError | UnknownError;

export const RiskyComponent = Component.gen(function* (
  Props: ComponentProps<{ shouldFail: "network" | "validation" | "unknown" | "none" }>,
) {
  const { shouldFail } = yield* Props;

  if (shouldFail === "network") {
    return yield* new NetworkError({ url: "/api/data", status: 500 });
  }

  if (shouldFail === "validation") {
    return yield* new ValidationError({ field: "email", message: "Invalid format" });
  }

  if (shouldFail === "unknown") {
    return yield* new UnknownError({ cause: new Error("Something unexpected happened") });
  }

  return <SuccessDisplay />;
});
