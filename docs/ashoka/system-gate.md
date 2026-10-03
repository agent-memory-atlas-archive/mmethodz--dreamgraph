# Ashoka offline system gate

Run from a credential-free repository checkout after locked root, Explorer and VS Code dependencies are installed:

```sh
ASHOKA_BROWSER_EXECUTABLE=/absolute/path/to/chromium ASHOKA_BROWSER_VERSION=151.0.7922.34 npm run ashoka:system:check -- --out /new/output/directory
```

On PowerShell, set the same two environment variables before the npm command. `npm run ashoka:system:check -- --describe` lists its steps without a browser, build, graph, model call or output directory. The runner refuses local .env files, strips provider secrets from child environments, requires an explicit browser identity, creates a new output directory and never overwrites an earlier run. Ordinary tests declare local provider fixtures and allocations; this command does not authorize a real-model canary.

The gate builds the server/workspaces, Explorer and companion; checks generated contracts, provider capabilities, MCP catalog, metric definitions, configuration and frozen Ashoka baseline; runs the full compiled editor suite and every discovered root test file with two workers; then runs the compiled isolated-browser qualification CLI. Heavy suites finish before Stop-latency qualification. Full source hashes before/after reject concurrent source changes. Failed steps retain their logs and failed result; an unknown or cancelled child cannot become a pass. Root skips are limited to the two explicitly retired particle assertions. Compiled editor skips/cancellation and missing root files fail. The earlier four-worker Windows failure remains recorded; reducing suite contention does not alter production Stop bounds or establish stress-load qualification.

The [workflow](../../.github/workflows/ashoka.yml) defines independent Windows/Linux/macOS jobs on Node20.20.2 and Node24. Its actions pin the commits read back from official [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0) and [upload-artifact v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1). It follows [Playwright's CI installation model](https://playwright.dev/docs/ci-intro) with exact Playwright1.62.1 and a disposable downloaded Chromium. Workflow presence is not evidence that these remote jobs have run. No workflow dispatch/push is part of local implementation.

Each result qualifies its actual host, Node, source hashes, commands, counts and isolated browser. Compiled editor tests use declared VS Code host/DOM boundaries; root tests separately exercise actual daemon/SDK/browser/source/graph joins. This gate does not qualify native desktops, CLI/provider computer facilities or physical VS Code. It does not migrate the owner's live graph, run paid/model comparisons, accept a whole Ashoka slice, bump versions or install/restart Windows. Those remaining review and release gates stay explicit in the unified plan.
