/**
 * Root Layout — Document Owner
 *
 * Renders the full <html>/<head>/<body> structure.
 * Docs-style layout with fixed sidebar navigation and scrollable content area.
 */
import "../styles.css";

import { Component, DevMode } from "trygg";
import * as Router from "trygg/router";
import { ApiClientLive } from "./api";

export default Component.gen(function* () {
  return (
    <html lang="en">
      <head>
        <title>trygg examples</title>
        <meta name="description" content="Effect-native UI framework examples" />
        <link rel="icon" href="/favicon.svg" />
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
            <p className="m-0 mt-1 text-xs text-gray-400">Examples</p>
          </div>

          <nav className="px-3 py-4 flex flex-col gap-5">
            <div>
              <h3 className="nav-heading">Basics</h3>
              <Router.Link to="/counter" className="nav-link">
                Counter
              </Router.Link>
              <Router.Link to="/suspend" className="nav-link">
                Suspend
              </Router.Link>
              <Router.Link to="/resource" className="nav-link">
                Resource
              </Router.Link>
            </div>

            <div>
              <h3 className="nav-heading">State & Forms</h3>
              <Router.Link to="/todo" className="nav-link">
                Todo List
              </Router.Link>
              <Router.Link to="/form" className="nav-link">
                Form Validation
              </Router.Link>
              <Router.Link to="/theme" className="nav-link">
                Theme (DI)
              </Router.Link>
            </div>

            <div>
              <h3 className="nav-heading">Routing</h3>
              <Router.Link to="/dashboard" className="nav-link">
                Dashboard
              </Router.Link>
              <Router.Link to="/users" className="nav-link">
                Users
              </Router.Link>
              <Router.Link to="/settings" className="nav-link">
                Settings
              </Router.Link>
            </div>

            <div>
              <h3 className="nav-heading">Auth</h3>
              <Router.Link to="/login" className="nav-link">
                Login
              </Router.Link>
              <Router.Link to="/protected" className="nav-link">
                Protected
              </Router.Link>
            </div>

            <div>
              <h3 className="nav-heading">Error Handling</h3>
              <Router.Link to="/error-boundary" className="nav-link">
                Error Boundary
              </Router.Link>
              <Router.Link to="/error-demo" className="nav-link">
                Error Demo
              </Router.Link>
            </div>

            <div>
              <h3 className="nav-heading">Advanced</h3>
              <Router.Link to="/nested-provide" className="nav-link">
                Nested Provide
              </Router.Link>
              <Router.Link to="/portal" className="nav-link">
                Portal
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
