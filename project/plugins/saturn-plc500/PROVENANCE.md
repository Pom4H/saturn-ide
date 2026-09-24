# Saturn PLC 500 vendor kit provenance

Ported from Pom4H/saturn at 90da21a1885a72022b7a2d1b45cb36993bee1597.

- front-panel SVG: `plant/vendor/saturn/src/view.ts`
- Firmverse compiler/runtime: `plant/vendor/firmverse`
- HMI frame + React projection: `plant/hmi-frame.ts`, `plant/hmi-react.ts`

Firmverse license files are kept verbatim under `vendor/firmverse`.
The kit is project-owned source. Saturn IDE core must not special-case `saturn.plc500`.
