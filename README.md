# BetterDrive

Your files, rebuilt beautiful.

![version](https://img.shields.io/github/v/release/bwinwho/betterdrive?label=version&color=e8c766)
![platform](https://img.shields.io/badge/platform-windows-blue)
![license](https://img.shields.io/badge/license-none%20yet-lightgrey)

Windows Explorer works fine, sure. It also looks like it was designed in 2004 and never told anyone the meeting ended. BetterDrive is a file manager for people who open their Downloads folder more than once a day and would like it to not hurt.

It's an Electron app. It's fast where it needs to be, pretty where it counts, and it naps when you're not looking at it so your battery doesn't file a complaint.

## What it actually does

- **Worlds instead of a sidebar.** Recent, Favourites, Downloads, Pictures, Documents, Cloud. Six tabs, bottom center, no clutter, no "add 47 more folders you'll never click again."
- **Recent is actually recent.** Pulls real Windows Recent Items, not just files you happened to open inside the app.
- **Cloud is your actual Google Drive**, full read/write, connected with one click. Star a file anywhere and it quietly syncs up to Drive in the background too, no extra step.
- **Favourites with a gold border**, because starring something and having it look exactly like everything else is pointless.
- **Full screen everything.** Images get a proper viewer with arrow-key navigation. Video, audio, text, and PDFs open full screen instead of squinting at a sidebar.
- **.exe runs, .zip extracts**, and then it drops you straight into the extracted folder instead of leaving you to go find it yourself like some kind of animal.
- **Color-coded file types** so you can tell a PDF from a zip from across the room, not just after reading the filename like it's 1997.
- **Drag and drop with a spring to it.** Cards lift when you grab them, drop targets bounce back. Small thing. Feels good anyway.
- **Standby mode.** Click away for 45 seconds and it goes full "Taking a Power Nap ⚡" and lets your RAM breathe. Click back and it's instantly awake, no loading screen theatrics.
- **Real Windows shell icons and real drive labels**, done through Electron's built in icon API and a PowerShell call, not some 200mb native addon that breaks on every Electron update.
- **Color tags, your call.** Right-click anything, pick one of five dots (or clear it), and the card's border and hover-glow match. Yours to assign — not the automatic file-type tinting, a separate layer on top of it.
- **HideOut.** A PIN-gated vault for the files you don't want showing up in a casual scroll — or in Windows Explorer at all. Lock icon next to the star on any file or folder moves it in; the HideOut button up top gets you back in, PIN required every time. Worth saying plainly: this is Windows' own hidden-file attribute plus an app-level PIN, not disk encryption. Anyone with "show hidden files" on or raw access to the drive can still find it.

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
