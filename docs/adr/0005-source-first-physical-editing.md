# ADR 0005 — Source-first physical editing

Status: accepted interaction contract; implementation is incremental, **not feature completion**.

The authored TypeScript project remains the only source of truth. Diagram and 3D are
projections of the same equipment, ports and physical connections. Editing a drawing
must not create an independent scene, an invisible connection registry, or an implicit
command to running hardware.

## Interaction contract

A pipe or cable is a physical object with its own stable identity and two ends. An end
can be attached to a compatible port, or free at an authored world-space position.
Detaching one end does not delete the connection; both ends must eventually support
being free. Equipment mounted along a connection retains the identity of that connection.

In Editor, picking an end lifts the connector, suppresses camera controls, highlights
compatible available ports, and follows the pointer. The pointer-to-object offset is
preserved. Near a port, screen-space snapping with hysteresis is used; an occluded,
incompatible or occupied port is never silently selected. Dropping on a compatible port
reconnects that end. Dropping into free space places it there. Elevation is adjustable;
the same XYZ position is used by picking, preview, routing and authored source. Escape,
pointer cancellation, capture loss or loss of window focus cancels the entire gesture.
A failed save or version conflict restores a truthful state and reports the error.

One gesture is one source transaction and one undo entry. There is no save per pointer
move. A preview survives a delayed successful save until its source revision is confirmed;
late telemetry cannot pull the end back to a previous pose. Port occupancy and compatibility
belong to the domain validator, not a second collection of UI-only rules.

Pipes and cables share the end interaction, not their physical appearance. Pipes retain
rigid segments and elbows; cables use flexible bends with configured clearance and bend
radius. Animation communicates pickup, movement and insertion. It must not imply a verified
mechanical simulation, allow cable-like bending of a rigid pipe, or delay pointer tracking.
Reduced-motion mode keeps all editing affordances and removes secondary animation.

## Editing the code

Removing the destination expression from a connection must produce a free/unresolved end
in the Editor projection, rather than deleting the whole route or clearing the scene.
This applies to the actual project DSL, including object-form `pipe(id, { from, to, flow })`;
`pipe(tank, …)` is an interaction example, not permission to introduce a competing DSL.
Completing or changing the endpoint expression and a visual reconnect must converge on the
same canonical connection. Known geometry is retained while the user is between tokens.
A missing argument and a syntactically incomplete expression are distinct cases.

The final canonical connection model must represent attachment versus free placement
explicitly. Do not extend the existing cable-only `unplugged` flag with more switches for
pipes, both-end disconnection, comments and mounting. Do not fabricate an endpoint that
still references equipment from which it has been detached. Migration of current cable
source must be explicit and covered by round-trip tests.

Workspace owns tolerant TypeScript parsing and binding resolution. Its draft projection
uses the existing canonical equipment/connection types plus diagnostics and source ranges;
it is generated output, never another authoring format. Only understood source expressions
are editable. Aliases, imports, comments, spreads and computed expressions must not be
rewritten by regex or guessed from a device label. Source edits use the current document
version and preserve unrelated text.

## Commented equipment and connectors

Recognized commented declarations remain as muted, clearly inactive ghosts in **Editor
only**. They can be selected to navigate to or restore their source, but they do not reserve
ports, participate in routing obstacles or acquisition, emit telemetry, receive commands,
enter a build, or appear in the operator workspace.

Comments are never executed to discover geometry. A static, binding-aware parser may
recover a declaration whose meaning is known. Ordinary prose, examples in documentation
comments and strings containing code are not ghosts. Unknown/dynamic declarations get an
honest source-linked placeholder or diagnostic instead of a fabricated model. Cold reload,
multiple commented declarations, line/block comments, comment toggling and missing imports
must be tested; relying solely on the previous in-memory scene is not sufficient.

## Stable routing and resource lifetime

Retain the existing valid corridor while a device or free end moves. First repair terminal
stubs and adjacent segments, preserving authored waypoints; run a new search only when the
repair is obstructed. An explicit reroute/optimize operation may find a shorter path after
editing. Do not switch the side of an obstacle because two routes exchange length by one
unit, and do not defer all routing until drop.

The complete router must reserve 3D clearance volumes for already routed pipes/cables,
respect equipment envelopes, port directions and bend radii, and use deterministic lane
selection with bounded work. XY crossings at different elevations are not physical
intersections. A crossing does not create connectivity. If constraints cannot be met,
show the collision/unrouted state and permit authored control points; never return
`valid: true` for a diagonal shortcut through an obstacle. Rounded rendering must not
silently invalidate the clearance checked on the canonical route.

Equipment geometry, display drivers, textures and animation phases are retained on
pose-only edits. Only affected route geometry changes; updates are coalesced to at most
one synchronization per animation frame. Camera and selection survive movement. A frame
loop does not create media queries or rebuild the complete equipment tree.

## Runtime boundary

Source, checked, published and applied remain distinct. Removing an argument, commenting
an object, dragging a pipe or experimenting with a free cable changes the draft. It does
not disconnect hardware or replace an applied build. Broken drafts and ghosts never enter
runtime through the visual editor. Simulation is explicit; live activation remains subject
to validation and the existing publish/apply controls.

## Implementation status and acceptance

The initial implementation fixes world-space cable picking, pointer/camera arbitration,
Escape/capture/blur cancellation, screen-space compatible port snapping, cable elevation
adjustment, retained 3D equipment geometry, phase preservation, local corridor repair and
obstacle-aware routing of existing loose cable ends. Tests cover these narrowly; they do
not establish complete gameplay-like physical editing.

Still required before closing this capability:

- One explicit end-state model and source transaction for both pipes and cables, including
  two free ends, imported/named/local bindings and undo/redo across delayed or failed saves.
- Source-to-scene projection for missing endpoint expressions and syntactically incomplete
  edits, with no promotion of invalid source to runtime.
- Comment ghosts after cold reload, selection/uncomment behavior and operator exclusion.
- Mounting along pipes/cables with longitudinal position and an unambiguous branch/elevation
  parameter, retained during rerouting.
- Connection-to-connection 3D clearance, bend-radius verification, collision diagnostics,
  stable authored waypoints and deterministic reproduction after reload.
- Actual browser recordings of pickup, detachment, placement, reconnection and cancellation;
  acceptance of their visual quality, together with frame/lifecycle regression checks.

Existing cable-only editing and a green unit suite must not be advertised as completion
of the above contract.
