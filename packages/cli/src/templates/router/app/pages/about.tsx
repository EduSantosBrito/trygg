import { Component } from "trygg";
import * as Router from "trygg/router";

export default Component.gen(function* () {
  return (
    <main>
      <h1>About</h1>
      <p>Built with trygg.</p>
      <Router.Link to="/">← Home</Router.Link>
    </main>
  );
});
