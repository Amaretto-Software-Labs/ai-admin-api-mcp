# Pass-Through Gateway Contract

Version 0.1 implements static credential mode only. `pass_through` and `hybrid` are documented contracts for operator-supplied gateway adapters and fail fast in this runtime build.

## Responsibility Boundary

The MCP server owns:

- read-only MCP tools and resources
- provider modules
- normalized result shapes
- static credential refs
- redaction and validation

The gateway owns:

- tenant identity
- caller authorization
- provider credential storage
- credential envelope signing or encryption
- audit logs
- request policy

## Expected Flow

1. The MCP client calls the gateway, not the raw shared server.
2. The gateway authenticates the caller and selects a provider credential based on tenant, provider, tool, and policy.
3. The gateway attaches an out-of-band credential envelope or broker token to the MCP HTTP request.
4. The MCP runtime validates that envelope against the tool name, provider, and `credential_ref`.
5. The provider module uses the credential only for that request and never persists or returns it.

## Credential Ref

`credential_ref` is an opaque selector, not a secret. It can appear in MCP tool arguments:

```json
{
  "credential_ref": "credential:openai:prod-admin"
}
```

The actual provider secret must never appear as a tool argument. A gateway implementation must reject a request when the tool input `credential_ref` differs from the out-of-band envelope credential reference.

## Current Runtime Behavior

The current runtime supports:

- `AI_ADMIN_CREDENTIAL_MODE=static`
- `credential:openai:static`
- `credential:anthropic:static`

The current runtime rejects:

- `AI_ADMIN_CREDENTIAL_MODE=pass_through`
- `AI_ADMIN_CREDENTIAL_MODE=hybrid`

This avoids silently running a shared deployment with static-mode semantics.
