# BetterDrive

Your files, rebuilt beautiful.

![version](https://img.shields.io/github/v/release/bwinwho/betterdrive?label=version&color=e8c766)
![platform](https://img.shields.io/badge/platform-windows-blue)
![license](https://img.shields.io/badge/license-none%20yet-lightgrey)

Windows Explorer works fine, sure. It also looks like it was designed in 2004 and never told anyone the meeting ended. BetterDrive is a file manager for people who open their Downloads folder more than once a day and would like it to not hurt.

It's an Electron app. It's fast where it needs to be, pretty where it counts, and it naps when you're not looking at it so your battery doesn't file a complaint.

## What it actually does

- **Worlds instead of a sidebar.** Recent, Favourites, Downloads, Pictures, Documents, Cloud. Six tabs, bottom center, no clutter, no "add 47 more folders you'll never click again." They're fixed — Documents/Pictures/Downloads are live views of your actual Windows folders, not a copy, and there's no way to rename or delete your way into a mess.
- **Recent is actually recent.** Pulls real Windows Recent Items, not just files you happened to open inside the app.
- **Favourites with a gold border**, because starring something and having it look exactly like everything else is pointless. Star it from anywhere, find it in one place.
- **Cloud is your actual Google Drive**, full read/write, connected with one click, entirely opt-in. Star a file anywhere and it quietly syncs up to Drive in the background too, no extra step.
- **Color-coded file types** so you can tell a PDF from a zip from across the room, not just after reading the filename like it's 1997.
- **Color tags, your call.** Right-click anything, pick one of five dots (or clear it), and the card's border and hover-glow match. Yours to assign — not the automatic file-type tinting, a separate layer on top of it.
- **Photos fill the frame.** Image cards go edge-to-edge instead of a little inset thumbnail, with the filename sitting quietly at 30% opacity so it doesn't fight the photo — until you hover, then it's fully readable.
- **Pictures is actually a gallery.** Just images, at any depth — folders and whatever non-photo files wander in there get filtered out of view. Bigger, edge-to-edge, tightly packed thumbnails, filenames hidden until you hover, and a soft zoom-and-lift on each photo. Click one and it opens a full-screen viewer *inside* the app — dark, immersive, arrow-key or mouse-wheel navigation, a thumbnail strip along the bottom, Esc to close — with a smooth fade-slide between shots instead of a hard cut. Grid thumbnails are real, generated-small images (not the full-resolution photo squeezed down with CSS), load blurred-then-sharp (a "developing" reveal), and quietly release their memory when they scroll far off-screen — so even a folder of thousands stays smooth instead of stuttering.
- **Real Windows shell icons and real drive labels**, done through Electron's built-in icon API and a PowerShell call, not some 200mb native addon that breaks on every Electron update.
- **.exe runs, .zip extracts**, and then it drops you straight into the extracted folder instead of leaving you to go find it yourself like some kind of animal. Multi-select and zip a folder full of stuff the other direction, too.
- **Cut/copy without getting stuck.** Cut or copy a selection and the bottom bar swaps to a Paste-here button — navigate anywhere you want first, then paste, instead of being frozen on one screen.
- **Command palette.** Ctrl+K (or Ctrl+P) to jump to a world, run an action, or find a file without touching the mouse.
- **Keyboard-first if you want it.** Digits pick a world, the same digit again drops you into card-browsing where digits open cards, arrows move focus, `R` renames, `N` makes a folder, `/` jumps to search, `?` for the full list.
- **Browse PC…** — reach any file or folder anywhere on the machine and pull it into a world, without leaving the app.
- **Drag and drop with a spring to it.** Cards lift when you grab them, drop targets bounce back. Small thing. Feels good anyway.
- **Standby mode.** Click away for 45 seconds and it goes full "Taking a Power Nap ⚡" and lets your RAM breathe. Click back and it's instantly awake, no loading screen theatrics.
- **HideOut.** A PIN-gated secret vault, and it opens full-screen exactly like every other world — same card grid, same thumbnails and icons, not a cramped dialog. A lock icon next to the star on any file or folder moves it in; the HideOut button up top gets you back in, PIN required every single time, no "stay unlocked." Worth saying plainly: this is Windows' own hidden-file attribute plus an app-level PIN, not disk encryption. Anyone with "show hidden files" on or raw access to the drive can still find it.

## Design language

Dark, warm, quiet — and it'll switch to a light, warm-paper palette automatically if that's what Windows is set to, no toggle to hunt for. Near-black background (or warm ivory in light mode), cream text (or dark ink), hairline borders — accents only where they mean something specific: gold for favourited, red for destructive, purple for HideOut. Folder and file *names* are set in a serif (Cormorant Garamond) at real size, because a name is not a label; everything else — metadata, timestamps, buttons — is small-caps monospace, because chrome should read as chrome. Cards live in a responsive grid that reflows instead of a fixed column count, glow faintly where your cursor is, and animate in with the same soft ease-out everywhere (a springier bounce is reserved for drag-and-drop, so it actually stands out). No sidebar, ever — the world-switcher is a floating pill docked bottom-center instead, which is the one deliberate inversion of how every other file manager on the planet is laid out. Pictures' full-screen viewer stays dark regardless — same reason every photo app keeps its viewer dark, it's about the photo, not your theme.

## Why not just use Explorer

You can! Nobody's stopping you. This exists because Explorer has had the same bones since XP and adding features to it means Microsoft ships a whole new "Files" app instead of just, you know, fixing the one that exists. BetterDrive is one guy's opinion on what a file manager should feel like, and that opinion is: fast, quiet, a little bit pretty.

## Getting it

Grab the latest installer from [Releases](https://github.com/bwinwho/betterdrive/releases). Windows only for now, `.exe` installer, pick your install folder, done. No account, no cloud sync forced on you, Google Drive is opt in if you ever want it, not shoved down your throat on first launch.

## Running it from source

```
npm install
npm start
```

Needs a real Windows machine (or Windows VM) to get real shell icons and drive info out of it. It'll still run elsewhere, just won't feel as native.

Want the Cloud world working on your own build? Copy `.env.example` to `.env` and drop in your own Google OAuth client (type **Desktop app**, from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)). `.env` is gitignored on purpose, your keys never end up in git history. Skip this and Cloud just shows a "not configured" message instead of blowing up, everything else works fine without it.

## Building your own installer

```
npm run build
```

Spits out a signed-ish NSIS installer in `dist/`. `npm run build:dir` if you just want the unpacked folder to poke at.

## Stack

Electron, one big `index.html` doing double duty as the entire renderer, a `main.js` that talks to Windows through IPC and the occasional shelled-out PowerShell command when there's no reason to compile a native addon just to ask Windows what a drive is called. No React, no build step, no framework tax. It's held together by CSS transitions and spite.

## Status

Actively getting poked at. Things get fixed, versions get bumped, releases go out. If something's broken, it's probably already annoying me too.
