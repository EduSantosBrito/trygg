import { Effect } from "effect";
import { Component, Resource, Signal, type ComponentProps } from "trygg";
import { ApiClient } from "../api";
import { type Severity } from "../errors/incidents";
import { incidentsResource } from "../resources/incidents";

const SEVERITIES: ReadonlyArray<{ value: Severity; label: string; description: string }> = [
  {
    value: "SEV-1",
    label: "Critical",
    description: "Complete outage or major functionality broken",
  },
  { value: "SEV-2", label: "Major", description: "Significant impact affecting many users" },
  { value: "SEV-3", label: "Minor", description: "Limited impact, workaround available" },
  { value: "SEV-4", label: "Low", description: "Minimal impact, cosmetic issues" },
];

const parseSeverity = (value: string): Severity | undefined =>
  SEVERITIES.find((s) => s.value === value)?.value;

interface ReportFormProps {
  readonly onSuccess?: () => Effect.Effect<void, unknown, unknown>;
}

export const ReportForm = Component.gen(function* (Props: ComponentProps<ReportFormProps>) {
  const { onSuccess } = yield* Props;

  const title = yield* Signal.make("");
  const severity = yield* Signal.make<Severity>("SEV-3");
  const summary = yield* Signal.make("");
  const submitting = yield* Signal.make(false);

  const submitDisabled = yield* Signal.deriveAll(
    [title, submitting],
    (t, s) => t.trim() === "" || s,
  );

  const buttonText = yield* Signal.derive(submitting, (s) => (s ? "Declaring…" : "Declare"));

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
      yield* Signal.set(summary, "");
      yield* Signal.set(submitting, false);

      if (onSuccess) {
        yield* onSuccess();
      }
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

  const onSummaryInput = (event: Event) =>
    Effect.sync(() => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement) {
        return target.value;
      }
      return "";
    }).pipe(Effect.flatMap((value) => Signal.set(summary, value)));

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

  // Derive selected severity info for description display
  const selectedSeverity = yield* Signal.derive(severity, (s) =>
    SEVERITIES.find((sev) => sev.value === s),
  );
  const severityDescription = yield* Signal.derive(selectedSeverity, (s) => s?.description ?? "");
  const severityValue = yield* Signal.derive(severity, (s): string => s);

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="incident-name" className="label">
          Name
        </label>
        <p className="field-hint" style={{ marginTop: "-4px", marginBottom: "8px" }}>
          Give a short description of what is happening.
        </p>
        <input
          type="text"
          id="incident-name"
          name="name"
          className="input"
          placeholder="e.g. API latency spike in /users endpoint…"
          value={title}
          onInput={onTitleInput}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="form-group">
        <label htmlFor="incident-severity" className="label">
          Severity
        </label>
        <select
          id="incident-severity"
          name="severity"
          className="select"
          value={severityValue}
          onChange={onSeverityChange}
        >
          {SEVERITIES.map((sev) => (
            <option key={sev.value} value={sev.value}>
              {sev.label}
            </option>
          ))}
        </select>
        <p className="field-hint">{severityDescription}</p>
      </div>

      <div className="form-group">
        <label htmlFor="incident-summary" className="label label--optional">
          Summary
        </label>
        <p className="field-hint" style={{ marginTop: "-4px", marginBottom: "8px" }}>
          Your current understanding of the incident and its impact.
        </p>
        <textarea
          id="incident-summary"
          name="summary"
          className="input"
          rows={3}
          placeholder="Think about what you'd like to read if you were coming to the incident with no context…"
          value={summary}
          onInput={onSummaryInput}
          autoComplete="off"
        />
      </div>

      <div className="modal__footer" style={{ padding: 0, border: "none", marginTop: "20px" }}>
        <button type="submit" className="btn btn--primary" disabled={submitDisabled}>
          {buttonText}
        </button>
      </div>
    </form>
  );
});
