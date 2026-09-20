# Civic Air

Affordable urban drone awareness, coordination, and accountability.

Civic Air is a hackathon prototype of a shared operating picture for low altitude
drone activity over a city. It shows registered and detected flights in one view,
raises alerts for restricted zone entry, unsafe altitude and lost signal, and puts
every access to identifying data behind a scoped, time limited, logged request.

All data in this build is simulated. No real drones, agencies, or individuals are
represented, and nothing here is a procurement quote or a compliance guarantee.

## What is in the demo

| Route | Screen | What it shows |
|---|---|---|
| `/` | Landing | The pitch, the cost comparison, and an explicit list of what the product is and is not |
| `/command-center` | Command Center | Live map, fleet list, layer toggles, per drone detail, and the permission wall on identifying data |
| `/alerts` | Alerts and Incidents | Alert triage, severity, acknowledgement, and incident notes |
| `/flight-history` | Flight History | Filterable flight log with retention state and scrubbed records |
| `/data-request` | Authorized Data Request | The narrow form a public safety agency fills in to request specific records |
| `/privacy-audit` | Privacy and Audit Center | Retention schedule, role based access, transparency reporting, and the audit trail |

The deliberate part of the demo is the last two screens. The Command Center will
refuse to show identifying details to an Operations Lead and say why, and the only
way through is a request that lands in the audit log.

## Running it

```bash
node server.mjs
```

Then open http://localhost:3000. There is nothing to install: no dependencies, no
build step, no database. `PORT` is read from the environment, which is what Railway
sets.

## How it is built

The screens were authored in a design tool that exports a single self extracting
HTML bundle. `build.mjs` unpacks that bundle, writes the web fonts out as real
files under a content hash, rewrites the opaque asset ids to paths, and emits one
plain page per screen.

`public/dc.js` is a small template runtime, about 200 lines, that reimplements the
handful of directives the exported markup uses: `{{value}}` interpolation, `sc-for`
repetition, `sc-if` conditionals, and the attribute prefixes the export uses for
camel cased attributes and for table tags. It renders by building a fresh tree and
morphing it onto the live one, so the Command Center's one second clock does not
cost focus, scroll position, or a selected row.

`public/motion.css` is the motion layer. The export carries almost no animation,
so entry, hover, focus and the marching geofence dashes are added on top, keyed
entirely off the classes the export already emits so a regenerated page keeps
them. Nothing in it animates layout, and the whole file switches off under
`prefers-reduced-motion`.

`server.mjs` is a static file server on `node:http`. Routes are clean paths rather
than `.html` so a link copied out of the address bar reads well in a demo. Paths
outside `public/` are refused, and `/healthz` answers the platform health check.

The generated pages are committed, so a deploy never depends on the export file
being present. To regenerate them after a new export:

```bash
node build.mjs /path/to/export.html
```

The build strips em dashes, en dashes, smart quotes and emoji from every page as it
writes, so none can reach the site from an export.

## Deploying

The repository deploys on Railway as is. `railway.json` pins the start command and
points the health check at `/healthz`.
