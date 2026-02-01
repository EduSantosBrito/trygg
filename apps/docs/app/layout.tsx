import "../styles.css";
import { Component, DevMode } from "trygg";
import * as Router from "trygg/router";
import { ApiClientLive } from "trygg/api";

export default Component.gen(function* () {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>trygg app</title>
        <meta name="description" content="Built with trygg - Effect-native UI framework" />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-800">
        <DevMode />

        <aside className="fixed top-0 left-0 bottom-0 w-60 bg-white border-r border-gray-200 overflow-y-auto z-40">
          <div className="px-5 py-5 border-b border-gray-100">
            <Router.Link
              to="/"
              className="text-lg font-semibold text-gray-900 no-underline hover:text-blue-600"
            >
              trygg
            </Router.Link>
            <p className="m-0 mt-1 text-xs text-gray-400">App</p>
          </div>

          <nav className="px-3 py-4 flex flex-col gap-5">
            <div>
              <h3 className="nav-heading">Pages</h3>
              <Router.Link to="/" className="nav-link">
                Home
              </Router.Link>
              <Router.Link to="/about" className="nav-link">
                About
              </Router.Link>
              <Router.Link to="/resource" className="nav-link">
                Resource Demo
              </Router.Link>
            </div>
          </nav>
        </aside>

        <main className="ml-60 min-h-screen">
          <div className="max-w-215 px-10 py-8">
            <Router.Outlet />
          </div>
        </main>
      </body>
    </html>
  );
}).provide(ApiClientLive);
