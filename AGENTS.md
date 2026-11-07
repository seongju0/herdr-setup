# Developing herdr-setup

This repository owns reusable native Herdr customizations, not a snapshot of a user's Herdr home.

- Edit source under customizations/, never shipped Herdr mods or generated guidance/types.
- Keep team/workspace settings and credentials local; public docs, fixtures and previews use synthetic data only.
- Preserve existing layouts, settings and conflicting files. Installation copies resources; git pulls must not hot-change live mods.
- Mods use Herdr's native GPUI JavaScript and installed API definitions. No webview, React, server or build pipeline is required.
- Tests use Node's native test runner, temporary install targets and stubbed external HTTP; no real Linear mutations.
- Do not publish, create remote repositories, or restart Herdr/core without authorization.
- Never extract or reuse credentials from Pi's MCP caches. Keep credentials and local team/workspace configuration outside this repository.
