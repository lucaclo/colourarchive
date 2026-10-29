# Getting the app

## The Mac app

Colour Archive is a normal Mac app. It needs no Terminal, Node, Chrome or certificate.

1. Download **Colour-Archive-arm64.dmg** from the **Get the app** page (`/get`), or from the
   [latest release](https://github.com/lucaclo/colourarchive/releases/latest).
2. Open it and drag **Colour Archive** into **Applications**.
3. Open it from Applications. The app isn't signed with an Apple Developer ID yet, so the
   first time macOS says it can't check it. Click **Done**, then go to
   **System Settings › Privacy & Security**, scroll down and click **Open Anyway**.
   On macOS 15 and later, right-click › Open no longer gets past this.
4. Choose where your photos should live. It suggests `~/Pictures/Colour Archive`.
   If you choose a folder that already holds an archive, it opens as it was.

After that it opens from Applications, the Dock or Launchpad like any other app, in its own
window. Quitting it stops everything it started.

It needs a Mac with Apple silicon (M1 or later). The first photos you add download the
models for search and Match (about 170 MB) into
`~/Library/Application Support/Colour Archive/models`, so you need to be online the first time.

### Open at login, and your iPad

Both are in the **Colour Archive** menu, and both are off until you switch them on.

- **Open at Login** adds the app to System Settings › General › Login Items. Opened that
  way, it starts without a window: the archive is served (and the iCloud inbox read) in the
  background, and clicking the Dock icon brings the window up.
- **Let My iPad In** serves the archive to your home network as well, at
  `https://<your-mac>.local:43443`. The iPad needs a secure address before it will keep the
  archive offline, so the app makes a certificate for this Mac the first time
  (in `~/Library/Application Support/Colour Archive/certs`). **Set Up iPad…** shows the
  address to open on the iPad, `http://<your-mac>.local:43280`, which walks through trusting
  that certificate once and then opens the archive to add to the Home Screen.

The iPad's home-screen app says **Can’t reach the Mac** when the Mac is asleep or the app is
closed, and shows the copy it saved. Anyone on the same Wi-Fi who knows the address can open
the archive while this is on, as they could with `npm run dev`.

### Your archive folder

```
Colour Archive/
  Photos/        your original photographs, never changed
  Inspiration/   the reference images you add to Match
  .archive/      everything worked out from them (hidden)
```

Keep the folder together. To move it, quit the app, move the whole folder, then use
**File › Choose Archive Folder…**. **File › Show Archive Folder in Finder** opens it.

### Building it

```
npm run app:build   # the server, built against an empty archive (desktop/build.mjs)
npm run app         # run the app from this checkout
npm run app:dist    # package desktop/dist/Colour-Archive-arm64.dmg
```

`app:build` refuses to finish if any photo id from this checkout's `src/data/photos.json`
turns up in the build, because the app goes to other people. The server's log is at
`~/Library/Logs/Colour Archive/server.log` (**Help › Show Server Log**).

## The development server

`npm run dev` serves this checkout's own archive at `https://localhost:4321`, and on the Wi-Fi
at `https://<your-mac>.local:4321`. Nothing starts it for you: the Chrome shortcut on the
Desktop only opens a window onto it, so run `npm run dev` first.

Chrome has to trust the certificate in `certs/` (not in git). Add `certs/rootCA.pem` in
Chrome itself: `chrome://certificate-manager` › **Local certificates** › **Installed by you** ›
**Trusted certificates** › **Import**, then quit and reopen Chrome. Trusting it only in
Keychain Access isn't enough for Chrome on this Mac.

## On your iPad or iPhone

The Mac has to be awake and on the same Wi-Fi, running the Mac app with **Let My iPad In**
switched on (see above), or `npm run dev`.

1. In **Safari**, go to the address **Set Up iPad…** shows on the Mac
   (`http://<your-mac>.local:43280`), or with the dev server **https://&lt;your-mac&gt;.local:4321/get**.
2. Tap **Install**, then follow the three steps. An arrow points at the button to tap.
3. The archive is now on your Home Screen. It opens in its own window, and it keeps
   working offline with the last version it saw.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| The Mac app says it couldn't start | Click **Show Log**, or open `~/Library/Logs/Colour Archive/server.log`. |
| The Mac app says your archive folder isn't there | Connect the drive it's on, or use **Choose Folder…** to find where it moved. |
| "localhost refused to connect" in the Chrome shortcut | The development server isn't running. Run `npm run dev`. |
| Chrome says **Not Secure** | Import the certificate into Chrome, as above. |
| The iPad can't reach the address | Check the Mac is awake, on the same Wi-Fi, and running the Mac app with **Let My iPad In** on (or `npm run dev`). |
| The iPad says the connection isn't private | Trust the certificate: on the iPad, **Settings › General › About › Certificate Trust Settings**. |
