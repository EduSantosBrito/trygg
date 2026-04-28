---
title: Generated API Client
version: "0.3.0-canary.0"
summary: Introduces a generated API client with type-safe request builders and runtime validation using Effect Schema.
---

## Overview

The new generated API client eliminates hand-written HTTP boilerplate. Every endpoint is typed from the OpenAPI spec and validated at runtime.

## What's new

- Type-safe request builders for every endpoint
- Runtime request and response validation via Effect Schema
- Automatic error mapping to typed failures
- First-class streaming support for SSE endpoints

## Usage

Import the client and call endpoints directly:

```ts
import { ApiClient } from "@trygg/api";

const program = Effect.gen(function* () {
  const client = yield* ApiClient;
  const user = yield* client.users.getById({ id: "123" });
  return user;
});
```

## Configuration

Set the base URL and default headers in your Layer:

```json
{
  "baseUrl": "https://api.example.com",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

## Migration guide

- Replace hand-written fetch calls with generated client methods
- Map existing error handling to `Effect.catchTag` patterns
- Update tests to use the provided `TestClient` layer

## Known issues

- Nested array parameters in query strings require manual encoding
- File upload progress events are not yet typed
