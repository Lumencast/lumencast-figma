# Security policy

## Supported versions

Lumencast Figma is pre-1.0. Until the plugin reaches v1.0.0, only the latest released version receives security advisories.

| Component                       | Supported                           |
| ------------------------------- | ----------------------------------- |
| `lumencast-figma` (this repo)   | latest released version             |
| `lumencast-protocol` (LSML 1.1) | tracked separately at the spec repo |

## Reporting a vulnerability

**Do not file public issues for security vulnerabilities.**

Send a report to **[security@lumencast.dev]** (placeholder until domain is registered — until then, file a private security advisory on GitHub).

Include :

- A description of the issue
- Steps to reproduce
- Affected components and versions
- Any proof-of-concept code (privately)

You will receive an acknowledgement within 72 hours and a triage update within 7 days.

## Scope

Security issues we treat as in-scope :

| Area           | Examples                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| Plugin sandbox | Code execution outside the Figma sandbox, escalation to the host environment       |
| Plugin data    | Cross-document leak of `lumencast.*` plugin data, bypass of namespace isolation    |
| Bundle output  | LSML scene that triggers unsafe rendering in any conformant Lumencast runtime      |
| Asset handling | Path traversal in `assets/` write paths, malicious image content surfacing as code |
| Import path    | LSML file that crashes Figma, hangs the plugin, or executes arbitrary Figma API    |

Out of scope (file as regular issues) :

- Bugs in third-party tools that consume the produced `.lsml`
- Performance issues without a security impact
- Style or convention disagreements
- Issues in Figma itself (report to Figma)

## Disclosure timeline

| Day  | Action                                                        |
| ---- | ------------------------------------------------------------- |
| 0    | Report received                                               |
| ≤ 3  | Acknowledgement, initial triage                               |
| ≤ 14 | Severity assessment, fix plan published privately to reporter |
| ≤ 90 | Fix released and CVE published if applicable                  |

We may extend timelines for hard problems but will keep the reporter informed.

## Network policy

The plugin's `manifest.json` declares `networkAccess.allowedDomains: ["none"]`. The plugin **MUST NOT** make outbound network requests under any code path.

Any change that would require network access (e.g. uploading assets to a CDN) requires :

- An ADR in `docs/adr/`
- An explicit user opt-in in the plugin UI
- A `manifest.json` update with the targeted domain whitelisted and a clear `reasoning` string
- A version bump signalling the new permission to existing users

## Plugin data hygiene

All persisted plugin data lives under the `lumencast.*` namespace. Reading or writing under any other namespace is forbidden. The `OperatorInput` component's pluginData is the only sanctioned cross-document state and follows the same prefix.

## Trust boundaries (recap)

```
Figma host  ←  TRUSTED (the user's Figma account)
   │
   │ Plugin sandbox (no DOM, restricted Figma API)
   ▼
lumencast-figma main  ←  RUNS WITH USER PRIVILEGE
   │
   │ figma.ui.postMessage / parent.postMessage
   ▼
lumencast-figma ui    ←  IFRAME, NO FIGMA API, NO NETWORK
```

A version of the plugin that reaches outside the sandbox, leaks plugin data across documents, or makes network calls without the manifest declaring it is a vulnerability.
