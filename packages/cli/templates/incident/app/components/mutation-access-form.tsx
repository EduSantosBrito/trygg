import { Effect, Redacted } from "effect";
import { Component, Signal } from "trygg";
import { MutationAccess } from "../services/mutation-access";

export const MutationAccessForm = Component.gen(function* () {
  const access = yield* MutationAccess;
  const message = yield* Signal.make("");
  const status = yield* Signal.derive(access.configured, (configured) =>
    configured
      ? "Token loaded for this tab. The server verifies each mutation."
      : "Read-only until an access token is entered.",
  );
  return (
    <form
      aria-label="Mutation access"
      onSubmit={(event) =>
        Effect.gen(function* () {
          event.preventDefault();
          const form = event.currentTarget;
          if (!(form instanceof HTMLFormElement)) return;
          const input = form.elements.namedItem("access-token");
          if (!(input instanceof HTMLInputElement)) return;
          const token = Redacted.make(input.value);
          input.value = "";
          yield* access.setToken(token);
          yield* Signal.set(message, "");
        }).pipe(
          Effect.catchTag("MutationAccessError", ({ message: detail }) =>
            Signal.set(message, detail),
          ),
        )
      }
    >
      <label className="label" htmlFor="access-token">
        Mutation access token
      </label>
      <input id="access-token" name="access-token" type="password" autoComplete="off" />
      <button type="submit" className="btn">
        Use token
      </button>
      <button type="button" className="btn" onClick={() => access.clear}>
        Forget token
      </button>
      <p className="text-xs" role="status">
        {status}
      </p>
      <p className="text-xs" role="alert">
        {message}
      </p>
    </form>
  );
});
