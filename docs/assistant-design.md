# Assistant design

The Assistant is a Shell surface over the same project context as the rest of Saturn. It is not a
second project model and it does not receive runtime command authority.

## Context

The client may send a bounded conversation, selected resource identities and explicitly attached
metadata. Secrets, runtime credentials and arbitrary workspace contents are not implicit context.

Answers are advisory. Source changes go through typed proposals or normal editor/importer flows,
then through the same check, Git, publish and apply lifecycle as human-authored changes.

## Operator and engineer modes

Operator mode focuses on explanation, alarms, observations and handoff notes. Engineer mode may
discuss source and migration diagnostics. Neither mode turns a chat response into a checked build.

Publishing a note to an external collaboration system is a separate explicit action owned by the
integration layer.

## Migration

The Assistant does not implement external SCADA formats. Project-owned `ScadaImporter`
extensions parse their own formats locally and return generated Saturn source plus diagnostics.
The Assistant may explain that result, but core and AI code do not contain format-specific parsers,
file signatures, compatibility tables or product URLs.

## AI integration boundary

Remote model access, authentication, billing, model selection and collaboration delivery belong to
an integration layer outside Saturn IDE. The IDE exposes a narrow Assistant service contract and
continues to work when no AI service is configured.

The model never receives shell/runtime tools merely because the Assistant panel is open. Any future
write-capable workflow must remain explicit, reviewable and constrained by the normal project
lifecycle.
