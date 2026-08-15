Generate one deterministic static map from normalized, current-request location evidence.

Every plotted longitude/latitude pair must include at least one consulted source URL, source name,
observation time, and coordinate-supporting claim. Keep unresolved locations in the input so they
remain visible in the textual evidence; they are never plotted. Use `metro` or `approximate` for
representative metro coordinates and `inferred` for indirect conclusions. Never use model memory as
coordinate evidence.

The default OpenStreetMap basemap fetches only viewport tiles outside Chrome and falls back to a
schematic map. The generated PNG is published through the canonical media service in this same tool
call. Do not call `display_media` afterward. No user-visible files are created unless `savePath` is
provided; saving writes matching `.png` and `.geojson` files and requires `overwrite=true` when
either target already exists.
