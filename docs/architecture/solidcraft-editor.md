# SolidCraft editor in DiscoverMake (Lane B): status and the permission it needs

Lane A is live in code: SolidCraft's **engine** builds Make AI's models and the buyer's size changes
in the CAD worker (`text-to-cad.md`). Lane B would add SolidCraft's **editor** to the Build Workspace,
so a buyer or a maker can sketch and edit a model by hand in the browser, on the same design file.

## What was checked (2026-11-24)

| Check | Result |
|---|---|
| The hosted editor on a real GPU (Windows, Chrome) | Loads; its page API (`window.solidcraft`) built a 30 × 20 × 10 mm box measured at exactly 6,000 mm³ and 2,200 mm²; undo worked. `document.export` / `document.inspect` answer (the host-page methods an embed needs to hand the design back). |
| The v0.48.1 release's static web build | 198.5 MB wasm (65.6 MB gzipped): too big for a single Cloudflare file, fine for a host that serves large files or for chunking. Under headless software graphics it stopped by itself seconds after loading; on a real GPU it works. |
| `?embed=editor` | Present in SolidCraft's source: the editing embed without the app bar and start page, keeping no files itself. |

## Why it is not built yet: the brand licence

SolidCraft's code that models and computes geometry is MIT OR Apache-2.0. Its **interface** is not:
the UI kit, the look (icons, glyphs, themes), the theme tokens, and the SolidCraft name, logo and icon
are under the SolidCraft Brand and Interface Licence (`LICENSE-BRAND` in their repository). Using any
of it "in another program, product, service or library", or distributing it other than as part of
SolidCraft, needs the maintainers' **written permission first**. Their repository's agent rules also
say integrations with other platforms need the maintainer's yes. Embedding their editor in
DiscoverMake is that case, so Lane B waits for a written yes. Not legal advice.

What we may do without asking, and do: use the engine (Lane A); say a model was "built with the
open-source SolidCraft engine"; test their hosted app.

## The request (owner to send, from the owner's GitHub account)

Post as an issue on https://github.com/tangency-labs/solidcraft (or ask there for the right contact):

> **Title:** Permission request: embedding the SolidCraft editor (unmodified) in DiscoverMake
>
> Hi, I run DiscoverMake (discovermake.com), an on-demand manufacturing marketplace: a buyer
> describes or uploads a part, gets a binding price, and a partner shop makes and ships it.
>
> We already use the SolidCraft engine headless under MIT: `solidcraft-cli` 0.48.1 from your release,
> unmodified, builds models from command scripts in a sandboxed worker, and buyers change a model's
> named sizes through `run --in design.sc --param`. Thank you for the CLI and the MCP server; they
> made this straightforward. We use none of your interface, name or look.
>
> We would like to go one step further and let buyers and shops edit their part by hand, by
> embedding the SolidCraft web editor in our Build Workspace, as your `?embed=editor` mode and
> `document.export` / `document.import` are designed for:
>
> - the official web build, **unmodified**, served from our own host (or framed from yours, if you prefer);
> - shown as SolidCraft, with your name and look intact and a link to your project; nothing
>   rebranded, no fork distributed;
> - our page only keeps the design files (`document.export` / `document.import`) and runs its own
>   approval and pricing around them.
>
> Under LICENSE-BRAND section 3 this needs your written permission. Would you allow it, and on what
> conditions (attribution, which build or channel, framing from your domain vs self-hosting,
> anything else)? We are also glad to sponsor the project or report what we find.
>
> Thanks,
> Miquel McDonald, DiscoverMake

## When permission arrives

1. Record it (link and conditions) in `THIRD_PARTY_NOTICES.md` and `open-source-register.md`.
2. Vendor the official web build unmodified (the OPEN SOURCE ACTIONS `wasm-bundle` route: checksum-pinned, chunked under 24 MiB per file where the host needs it, its own service worker scope).
3. An "Edit by hand" tab in the Object View: `?embed=editor` in a same-origin frame, `document.import` of the version's `model.sc`, and "Save as a new version" through `document.export` -> the worker measures it -> a DRAFT version like any other.
4. Its own e2e at 390 and 1280 px, and a fallback message where the browser has no GPU.
