# ai-sdk-byok

Core bring-your-own-key credential lifecycle helpers for AI SDK applications.

```ts
import { cachedStorage, createByokManager } from 'ai-sdk-byok';
```

Use `keys.getById({ userId, keyId })` when a browser submits a selected metadata id, and derive `userId` from trusted server-side auth. The returned credential record includes safe metadata for provider selection plus proxy-wrapped `{ apiKey }` credentials.

`cachedStorage` is an optional adapter-agnostic wrapper for app-owned credential caches. Cache values contain plaintext credential records, require an explicit TTL, and must stay in server-only trusted infrastructure such as an app-wired Redis deployment. Metadata/list caching is out of scope.

Documentation:

- [Repository README](https://github.com/Xyri1/ai-sdk-byok#readme)
- [Quickstart](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/quickstart.md)
- [Architecture](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/architecture.md)
- [Threat model](https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/threat-model.md)
