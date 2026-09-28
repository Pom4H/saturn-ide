# UX consistency audit — 27 September 2026

This audit follows an engineer's task: open a project, edit a physical connection,
inspect observations, review source changes, check a build, and prepare a release.
It also checks the operator's narrower path through object status, alarms and
reports. The Codex screenshots supplied by the user inform the spatial pattern
of **navigation → workspace → optional review**; they are not a source of Saturn
domain behavior.

## Shared interface rules

| Concept | One meaning throughout the interface |
| --- | --- |
| Project source | Editable TypeScript files and Git working tree. A preview shows the exact files to write; creating an HMI or importing a SCADA project writes source. |
| Checked | A build checked from saved project source. An unsaved editor draft and a failed later check do not replace it. |
| Published | A separately released, immutable build. |
| Applied | The build owned by the runtime. The simulator may refresh its development preview under the documented conditions; saving source does not itself deploy to a plant. |
| Observation | A measured or simulated value with timestamp, quality and source. A last known value, stale value, stopped driver and missing value have different labels. |
| Connection | One typed physical topology, shown in 2D and 3D. During drag the candidate route is provisional; after drop validation and source persistence determine its status. |
| Signal policy | Exchange cadence and archive retention belong to the authored signal. Monitoring explains the effective setting and the provenance of actual samples. |

The global rail selects the work area; the contextual sidebar selects a resource;
tabs hold working surfaces; review is an inspectable, dismissible pane. Bottom
runtime tools stay available without becoming the primary navigation. At 390 px,
the bottom panel starts collapsed so the selected work remains visible.

## Findings and changes in this pass

| User-facing break | Correction |
| --- | --- |
| Source, Checked, Published and Applied were scattered or presented as though a successful check had also changed runtime. | Environment and Review now show the identities together with consistent stage names. Docs no longer claims agreement with Applied when no Applied build exists. Creation/import copy names the file write and separate release step. |
| Route diagnostics turned red while a port was still being dragged. The same route could be valid on drop. | Candidate connection feedback is provisional. Both 2D and 3D use the shared compatibility check, while final validation still checks the complete authored project. Saved 2D/3D frames and browser assertions cover the same rewired ports. |
| A fast edit followed by deployment-plan preview could show the prior command. | The argv field is controlled and locally validated; invalid JSON blocks preview/create, and the displayed workflow uses the latest edit. |
| Monitoring mixed the current sample, historical archive and frozen pause state. A narrow time range could draw an empty chart despite valid samples. | The dashboard names observation quality/source and archive coverage separately, freezes its as-of values on pause, and uses actual sample bounds for auto scale. Narrow and offline states were checked in Chromium. |
| Signal details could say a stale or expired value was reliable. | Properties and monitoring share health labels. Project policy and effective Applied/runtime state remain distinct. |
| Git buttons and importer/HMI actions used generic verbs that hid their effect. | Git fetch, fast-forward pull and push are named by action; source creation previews the affected files. Importer completion directs the engineer to Git review. |
| The assistant had a literal newline artifact and mixed Russian/English copy. | Messages, suggestions, status/error text and New chat reset follow the selected locale. |
| Review showed a faulted runtime while the global mode badge and rail stayed green. | Runtime mode remains visible, while its status tone and description now follow the faulted phase. Loss of connection takes priority over the last known fault. |
| A new Checked report could appear in the sidebar before Apply, but opening it selected a different Applied report. New Checked equipment was absent from the HMI authoring form and lacked an honest Properties state. | Authoring views use Checked resources where appropriate, runtime views use Applied, and pending application is explicit. No action runs a different report as a fallback. |
| A changed signal showed its Checked contract in the center but an older Applied contract in Properties. A Checked-only signal could still trigger an archive request from the bottom panel. | Signals list the Checked and Applied stages per row. The center and Properties show the Checked contract with a clear changed/pending label; observations, commands and history use only the Applied definition. The bottom panel shows a pending state for Checked-only signals and devices. Host history and report generation reject requests when no build is Applied. |
| Multi-device operator HMI required paging through each item before comparing observations or opening its controls. | Screens with more than four devices start in a system overview. Each equipment card shows up to four read-only observations with current/unavailable status; selecting it opens the existing diagram and commands. Detail view has an explicit return to overview. One-device and small HMI screens retain their direct detail view. |
| A full build hash consumed four lines of the phone Environment; Review exposed only a hover title. | Both places show a short ID and reveal the selectable full ID and copy action on tap. |
| The same word “source” denoted a diagnosed protocol connection and the producer of one observation. | The dashboard names protocol connections and observation source separately. |

The real browser checks cover desktop and 390 px layouts, light/dark where relevant,
and empty, offline, failed or closed states. The image artifacts and command results
are recorded in [verification.md](verification.md); a source test alone is not
evidence of visual correctness.

## Detail and density rules for future surfaces

1. The first screen answers **which project/asset, which lifecycle state, what needs
   attention, what action is possible**. Protocol internals, raw hashes and long
   diagnostic lists are available on inspection, without displacing that answer.
2. Use one noun for an entity across the sidebar, page heading, search, review and
   empty state. Local headings should add context rather than repeat the open tab.
3. The same quality semantics must drive cards, charts, equipment details and
   report coverage. A line across missing history must not fabricate continuity.
4. A preview is read-only until its explicit write action. A source write, check,
   publish and apply each have different verbs and feedback.
5. On phone widths, keep the current task visible and permit navigation/review to
   collapse. Do not shrink an engineering editor into unreadable cards solely to
   preserve desktop columns.

## Remaining product gaps

- The current 3D view still needs reference-frame review against the old Saturn
  for good, stale, failed and closed states; these new screenshots establish route
  behavior, not visual parity.
- Port candidate validation currently runs full project validation per candidate
  at drag start. A synthetic 514-port controller took about 83 ms on this macOS
  machine. A contract-preserving incremental check or static-context cache is
  needed for very large cabinets.
- Replay/checkpoint parity, derived expressions/dimensions, fully custom
  equipment visuals/targets, and production host isolation remain open in
  [capabilities.md](capabilities.md). A more coherent interface does not complete
  those capabilities.
- The adjacent SaaS and public sites still need separate release ownership. A local
  polish pass fixed responsive navigation and copy on the corporate and engineering
  sites, but no site was published. Twelve external evidence URLs in the public
  engineering radar returned HTTP 404 on 27 September 2026; the site labels that
  dated state instead of sending visitors to a broken destination. The URLs must
  be checked again before publication.
