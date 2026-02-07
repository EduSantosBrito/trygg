import { Effect } from "effect";
import { Component, Resource, Signal } from "trygg";
import { ApiClient } from "../api";
import { type Severity } from "../errors/incidents";
import { incidentsResource } from "../resources/incidents";

const SEVERITIES: ReadonlyArray<Severity> = ["SEV-1", "SEV-2", "SEV-3", "SEV-4"];

const parseSeverity = (value: string): Severity | undefined =>
  SEVERITIES.find((severity) => severity === value);

export const ReportForm = Component.gen(function* () {
  const title = yield* Signal.make("");
  const severity = yield* Signal.make<Severity>("SEV-1");
  const severityValue = yield* Signal.derive(severity, (s): string => s);
  const submitting = yield* Signal.make(false);

  const submitDisabled = yield* Signal.deriveAll(
    [title, submitting],
    (t, s) => t.trim() === "" || s,
  );

  const buttonText = yield* Signal.derive(submitting, (s) =>
    s ? "Creating..." : "Report Incident",
  );

  const handleSubmit = (event: Event) =>
    Effect.gen(function* () {
      event.preventDefault();
      const titleValue = yield* Signal.get(title);
      if (titleValue.trim() === "") return;

      yield* Signal.set(submitting, true);

      const client = yield* ApiClient;
      const severityValue = yield* Signal.get(severity);

      yield* client.incidents.create({
        payload: { title: titleValue.trim(), severity: severityValue },
      });

      yield* Resource.invalidate(incidentsResource);
      yield* Signal.set(title, "");
      yield* Signal.set(submitting, false);
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logError("Create incident failed", error);
          yield* Signal.set(submitting, false);
        }),
      ),
    );

  const onTitleInput = (event: Event) =>
    Effect.sync(() => {
      const target = event.target;
      if (target instanceof HTMLInputElement) {
        return target.value;
      }
      return "";
    }).pipe(Effect.flatMap((value) => Signal.set(title, value)));

  const onSeverityChange = (event: Event) =>
    Effect.sync(() => {
      const target = event.target;
      if (target instanceof HTMLSelectElement) {
        return parseSeverity(target.value);
      }
      return undefined;
    }).pipe(
      Effect.flatMap((next) => {
        if (next === undefined) {
          return Effect.void;
        }
        return Signal.set(severity, next);
      }),
    );

  return (
    <form className="report-form" onSubmit={handleSubmit}>
      <div className="report-form__field">
        <label htmlFor="incident-title" className="report-form__label">
          Title
        </label>
        <input
          type="text"
          id="incident-title"
          className="report-form__input"
          placeholder="Brief incident description"
          value={title}
          onInput={onTitleInput}
        />
      </div>

      <div className="report-form__field">
        <label htmlFor="incident-severity" className="report-form__label">
          Severity
        </label>
        <select
          id="incident-severity"
          className="report-form__select"
          value={severityValue}
          onChange={onSeverityChange}
        >
          {SEVERITIES.map((sev) => (
            <option key={sev} value={sev}>
              {sev}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="report-form__submit"
        disabled={submitDisabled}
        aria-busy={submitting}
      >
        {buttonText}
      </button>
    </form>
  );
});
