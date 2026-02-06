import { Component } from "trygg";
import * as Router from "trygg/router";

export default Component.gen(function* () {
  return <Router.Outlet />;
});
