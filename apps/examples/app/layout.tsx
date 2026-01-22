/**
 * Root Layout
 *
 * This wraps all routes and provides the HTML structure.
 */
import { Component, DevMode, type ComponentProps, type Element } from "effect-ui";
import * as Router from "effect-ui/router";

export default Component.gen(function* (Props: ComponentProps<{ children: Element }>) {
  const { children } = yield* Props;

  return (
    <div className="app">
      <DevMode />
      <header className="app-header">
        <h1>
          <Router.Link to="/">effect-ui</Router.Link>
        </h1>
        <nav>
          <Router.Link to="/counter">Counter</Router.Link>
          <Router.Link to="/suspend">Suspend</Router.Link>
          <Router.Link to="/resource">Resource</Router.Link>
          <Router.Link to="/todo">Todo</Router.Link>
          <Router.Link to="/theme">Theme</Router.Link>
          <Router.Link to="/form">Form</Router.Link>
          <Router.Link to="/error-boundary">Errors</Router.Link>
          <Router.Link to="/dashboard">Dashboard</Router.Link>
          <Router.Link to="/users">Users</Router.Link>
          <Router.Link to="/settings">Settings</Router.Link>
        </nav>
      </header>

      <main className="app-content">{children}</main>
    </div>
  );
});
