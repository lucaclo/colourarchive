# Getting the app

## On this Mac

**Double-click `Colour Archive` on your Desktop.**

It starts the archive and opens it in its own window. That's all there is to it.
The first open takes about ten seconds while the archive starts up. After that it's instant.

Want it in your Dock too? While it's open, right-click its Dock icon and choose
**Options › Keep in Dock**.

### One-time setup (already done if Chrome no longer says "Not Secure")

Chrome has to trust this Mac's own certificate. Open Terminal and paste:

```
security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db "$HOME/Desktop/Colour Archive/certs/rootCA.pem"
```

`certs/` isn't in git. The CA needs `basicConstraints CA:TRUE`, or Chrome rejects it
(`ERR_CERT_AUTHORITY_INVALID`) even though macOS accepts it.

Enter your Mac password when asked, then quit and reopen Chrome.

## On your iPad or iPhone

The Mac has to be on, with the archive open, on the same Wi-Fi.

1. In **Safari**, go to **https://&lt;your-mac&gt;.local:4321/get**. When you open the
   Desktop app, its notification shows the exact address.
2. Tap **Install**, then follow the three steps. An arrow points at the button to tap.
3. The archive is now on your Home Screen. It opens in its own window, and it keeps
   working offline with the last version it saw.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "The local server did not start" | Open Terminal in the `Colour Archive` folder and run `npm run dev`. The message it prints says why. |
| Chrome says **Not Secure** | Do the one-time setup above. |
| The window opens as a normal Chrome tab | Quit Chrome completely (⌘Q) and double-click the Desktop icon again. |
| The iPad can't reach the address | Check the Mac is awake and on the same Wi-Fi, and that the Desktop app is open. |
