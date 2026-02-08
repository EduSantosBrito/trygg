import { Component } from "trygg";

export const IncidentSkeleton = Component.gen(function* () {
  return (
    <div className="incidents-list">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="incident-row" style={{ cursor: "default" }}>
          <div className="incident-row__content">
            <div className="incident-row__header">
              <div className="skeleton" style={{ width: "60px", height: "16px" }} />
              <div className="skeleton" style={{ width: "200px", height: "16px" }} />
            </div>
            <div className="incident-row__meta">
              <div
                className="skeleton"
                style={{ width: "60px", height: "22px", borderRadius: "9999px" }}
              />
              <div
                className="skeleton"
                style={{ width: "80px", height: "22px", borderRadius: "9999px" }}
              />
              <div className="skeleton" style={{ width: "120px", height: "16px" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});
