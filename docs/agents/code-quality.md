# Code Quality

- Make minimal, surgical changes.
- Keep type safety intact: no `any`, no non-null assertions, no type assertions.
- Make illegal states unrepresentable: prefer discriminated unions, branded types, and parsing at boundaries.
- Keep abstractions constrained. Extract only when reuse or clarity clearly improves.
- Search existing repo utilities and Effect APIs before adding new helpers.
- Fix LSP issues introduced by your change before stopping.
- Breaking changes are acceptable when they improve the API; avoid compatibility shims unless there is a real consumer need.
