# Research: React + Bun IDE, resource editors and SVG motion

Checked 2026-09-23. Primary sources below explain library capabilities; the decisions are ours.
This is not evidence that the whole Saturn application or a particular rendering benchmark passed.

## React DOM and a real terminal renderer

[Bun fullstack dev server](https://bun.com/docs/bundler/fullstack) supports an HTML entry with
bundled TSX/CSS and development HMR alongside server routes. Keep that existing host; adding
Next.js or a separate frontend server solely for this IDE would not solve the shared Shell model.

[OpenTUI React](https://opentui.com/docs/bindings/react/) documents createCliRenderer/createRoot,
React hooks, text/box/input/textarea/select/scrollbox and a React-aware testRender helper.
[Release v0.5.12](https://github.com/anomalyco/opentui/releases/tag/v0.5.12) and the upstream
packages/react/package.json were inspected; core and React packages are pinned together.
The React peer requirement is >=19.2. Terminal files use a local @jsxImportSource pragma, so
browser components keep React DOM's JSX runtime. We do not adopt OpenTUI's runtime plugin API
as Saturn's extension lifecycle.

The alternative [Ink](https://github.com/vadimdemedes/ink) also provides React for CLIs. For this
Bun-first implementation OpenTUI is chosen for its documented editing, keyboard and test-renderer
facilities. This is a scoped choice, not a claim that it is faster or universally superior to Ink.
We share semantic state and commands, not try to make browser CSS and terminal cells identical.

## One document, several editors

[VS Code Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)
separates a document from its visual editors; multiple views can share one source document.
The useful abstraction is Resource + Document + Editor, not cloning VS Code's extension runtime.
[File icon themes](https://code.visualstudio.com/api/extension-guides/file-icon-theme) also keep
file-class icons distinct from general product/action icons.

Applied in Saturn: a device is one resource entry with the actual source path. The source is
normal TS; Diagram, Source and Signals are choices of view. Reports, copied plugins and PLC
members use the same opening/search/tab rules. Source buffers are shared by path, even when
legacy code declares several objects in one file. Identity uses domain ID, not display label.
The resource index is disposable and does not become a second authored Project.

## CSS for a resizable workbench

[CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)
respond to a containing pane rather than only the entire viewport. Use the existing semantic
color/spacing tokens, Grid/Flex for layout and named inline-size containers for explorer/workbench.
Our resource tree/tab CSS adds container queries without introducing another design-system theme.
Custom split-pane/keyboard/drag behavior still requires host interaction code; CSS is not an
application-state model.

## Device class icons

[Pictogrammers MDI](https://pictogrammers.com/library/mdi/) includes pump, storage tank, valve,
chip and source/plugin/report symbols. [License](https://pictogrammers.com/docs/general/license/)
and [@mdi/js package](https://github.com/Templarian/MaterialDesign-JS/blob/master/package.json)
were inspected: 7.4.47, Apache-2.0. Import named SVG path constants rather than downloading icons
at runtime or depending on an icon font. Terminal class labels such as [PMP], [PLC], [EXT]
remain readable over SSH. A tiny navigation icon does not replace the process-equipment drawing.

## SVG techniques and where they belong

[requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
provides frame timestamps; velocity/phase must be integrated using elapsed time, not frame count.
For telemetry-driven animation, one clock per visible scene can update cached SVG nodes outside
React's structural render path. Cache node references when geometry changes; do not query every
rotor/pipe or create media queries every frame. Explicitly release listeners/frames on teardown.

[clipPath](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/clipPath) keeps animated
liquid inside the original vessel silhouette. Keep the shell, highlights and scale static; update
fluid level/surface only. Existing Saturn symbols already use this idea; they are retained.

[stroke-dashoffset](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dashoffset)
and [pathLength](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/pathLength)
allow path-based flow indicators and normalized reveal progress. Actual volumetric flow is not
inferred from animation speed. A closed valve/stale signal cannot continue a healthy-looking flow;
a cable cannot inherit a pipe's liquid animation. Current implementation retains measured dash
motion; normalized reveal effects are guidance, not claimed as a shipped feature.

[SVG use](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/use) and symbol/defs can
reuse static geometry, with instance-specific IDs for masks/gradients/clips. Avoid IDs shared by
independent windows or devices. Keep large blurs/displacement filters away from hundreds of live
symbols until profiled; moving an entire detailed body when only its rotor changes is unnecessary.

[prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
is a user preference, not a reason to hide state. Values and quality labels stay visible while
motion pauses. Our new SVG host caches references, preserves phase and pauses its frame schedule
when hidden/reduced; no new equipment anatomy or 3D material edits are included in this pass.

CSS transforms or SVG animation APIs do not guarantee GPU compositing or a particular frame rate.
Visual quality/performance requires actual recordings, known states, browser profiling and human
comparison with approved Saturn references. Those unexecuted checks remain explicit.
