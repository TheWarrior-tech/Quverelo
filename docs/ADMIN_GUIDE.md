# Quvrelo — IT Administrator Deployment Guide

Quvrelo is designed to be deployed to shared school and office computers with no per-user setup:

- **No accounts, no licence keys, no sign-in.**
- **No telemetry.** The renderer process is blocked from all network requests. The only network traffic is the update check (see [Updates](#7-updates)): it downloads a small `latest*.yml` file from the update feed and sends nothing about the user or their work. Turn it off completely with `"disableUpdateCheck": true`. The controls behind this, with source locations and tests, are listed in [OFFLINE.md](OFFLINE.md) for security and data-protection reviews.
- **Updates are yours to control.** Out of the box Quvrelo updates itself from GitHub Releases. For managed fleets either point it at your own server (`updateFeedUrl`) or turn updates off and deploy new installers through your usual tooling.

## 1. Installers

| File | Use |
|---|---|
| `Quvrelo-<ver>-x64.msi`, `Quvrelo-<ver>-arm64.msi` | Windows per-machine install (Intune, SCCM/MECM, Group Policy software installation, PDQ). |
| `Quvrelo-Setup-<ver>-x64.exe`, `...-arm64.exe` | Windows NSIS installer; per-user or per-machine. |
| `Quvrelo-<ver>-mac-arm64.pkg`, `...-mac-x64.pkg` | macOS installer package for Jamf, Mosyle, Kandji, Munki or Apple Remote Desktop. Installs to `/Applications`. |
| `Quvrelo-<ver>-mac-arm64.dmg`, `...-mac-x64.dmg` | macOS drag-to-install disk image. |
| `Quvrelo-<ver>-x86_64.AppImage` | Linux, any distribution, no install needed. |
| `Quvrelo-<ver>-amd64.deb` | Debian, Ubuntu, Mint (apt). |
| `Quvrelo-<ver>-x86_64.rpm` | Fedora, RHEL, Rocky, openSUSE (dnf/zypper). |
| `Quvrelo-<ver>.flatpak` | Any distribution with Flatpak (x86_64), sandboxed. See [Linux deployment](#linux-deployment). |

Each release also includes `SHA256SUMS.txt` so you can verify downloads.

## 2. Silent installation

### Windows — MSI (recommended for managed fleets)
```bat
msiexec /i Quvrelo-0.1.0-x64.msi /qn /norestart
msiexec /i Quvrelo-0.1.0-x64.msi /qn /l*v "%TEMP%\quvrelo-install.log"
:: uninstall
msiexec /x Quvrelo-0.1.0-x64.msi /qn
```
The MSI installs per-machine into `C:\Program Files\Quvrelo` and creates Start-menu and desktop shortcuts for all users.

### Windows — NSIS EXE
```bat
:: per-machine (all users), silent; requires elevation
Quvrelo-Setup-0.1.0-x64.exe /S /allusers
:: per-user, silent, no elevation
Quvrelo-Setup-0.1.0-x64.exe /S /currentuser
:: custom directory (must be the last argument, no quotes)
Quvrelo-Setup-0.1.0-x64.exe /S /allusers /D=D:\Apps\Quvrelo
:: silent uninstall (per-machine)
"C:\Program Files\Quvrelo\Uninstall Quvrelo.exe" /S /allusers
```

### Intune (Win32 app)
- Install command: `msiexec /i Quvrelo-0.1.0-x64.msi /qn`
- Uninstall command: `msiexec /x {product-code} /qn` (Intune detects the product code automatically from the MSI)
- Detection rule: MSI product code, or file `C:\Program Files\Quvrelo\Quvrelo.exe` exists.

### macOS
```sh
sudo installer -pkg Quvrelo-0.1.0-mac-arm64.pkg -target /
```
Releases are **not yet notarised**. Gatekeeper may block first launch for users; remove the quarantine attribute as part of your deployment script:
```sh
sudo xattr -dr com.apple.quarantine "/Applications/Quvrelo.app"
```
(Packages pushed by MDM are normally not quarantined.)

## 3. Policy file (`policy.json`)

A machine-wide JSON file lets you control behaviour for every user. Quvrelo reads it at launch.

| OS | Location |
|---|---|
| Windows | `%ProgramData%\Quvrelo\policy.json` (usually `C:\ProgramData\Quvrelo\policy.json`) |
| macOS | `/Library/Application Support/Quvrelo/policy.json` |
| Linux | `/etc/quvrelo/policy.json` |

Make the file read-only for standard users. Invalid keys are ignored and listed under *Help ▸ About* ("Policy warnings"), so a typo never stops the app from starting. An example ships inside the app at `resources/policy.example.json` and in this repository at [`docs/policy.example.json`](policy.example.json).

### Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `organizationName` | string \| null | `null` | Shown in the title bar, welcome screen and About box. |
| `defaultSaveDirectory` | string \| null | `null` (Documents) | Starting folder for Save, Export and Open dialogs. Supports `%USERPROFILE%`, `%USERNAME%`, `%DOCUMENTS%`, any `%ENV_VAR%`, `~` and `$USER`. |
| `lockSaveDirectory` | boolean | `false` | When `true`, users can only save/export inside `defaultSaveDirectory`, `allowedSaveDirectories` or `handInDirectory`. Requires `defaultSaveDirectory`. |
| `allowedSaveDirectories` | string[] | `[]` | Extra permitted folders when locked (e.g. a OneDrive folder or USB path). |
| `handInDirectory` | string \| null | `null` | Folder used by *File ▸ Hand In*. Each hand-in is written to `<handInDirectory>\<Class>\<Student> - <Assignment> - <YYYY-MM-DD HH.MM>.zip` (see [Classroom assignments and hand-in](#classroom-assignments-and-hand-in)). If unset, students choose a folder. |
| `handInIncludePreview` | boolean | `true` | Hand-in bundles include a PDF preview of every page so work can be marked on any computer. `false`: the bundle holds only the work file and its manifest (smaller files on slow shares). |
| `templateDirectories` | string[] | `[]` | Folders containing `.quvrelo` files shown as "School templates" on the welcome screen (network shares are fine; unavailable folders are skipped). |
| `disabledFeatures` | string[] | `[]` | Features to remove from the UI. See the list below. |
| `disableUpdateCheck` | boolean | `false` | Turns off every update check (automatic and *Help ▸ Check for Updates*, which is removed), so the app makes no network requests at all. |
| `updateFeedUrl` | string \| null | `null` (GitHub Releases) | Your own update server (`http://` or `https://`). See [Updates](#7-updates). |
| `autoDownload` | boolean \| null | `null` (user choice, on) | `false`: never download in the background; users see "Update available" and click *Download*. `true`: always download. Either value locks the Preferences toggle. |
| `autoInstall` | boolean \| null | `null` (on) | `false`: a downloaded update is installed only when the user clicks *Restart*, never silently when the app quits. |
| `updateChannel` | `"stable"` \| `"beta"` \| null | `null` (user choice, stable) | Locks the update channel. |
| `autosaveIntervalSeconds` | number | `60` | Crash-recovery autosave interval (0–3600; `0` disables autosave). |
| `forceTheme` | `"dark"` \| `"light"` \| `"high-contrast"` \| null | `null` | Forces a theme for everyone. |
| `uiScale` | number | `1` | Default interface scale (0.75–2). |
| `lockUiScale` | boolean | `false` | Prevents users changing the interface scale. |
| `showWelcomeScreen` | boolean | `true` | Show the welcome screen at launch. |
| `disableOnboarding` | boolean | `false` | Hides first-run onboarding for every user: the *Get started* checklist on the welcome screen (create a document, place an image, select a subject, add text, export). Useful for staff machines or exam rooms. Progress is stored per user in `settings.json` (`onboarding`), so turning the key off again shows the checklist only to users who have not finished or closed it. |
| `maxUndoSteps` | number | `250` | Undo history length (10–2000) — lower it on low-memory machines. |

#### Feature IDs for `disabledFeatures`
`photo`, `vector`, `layout` (whole studios — at least one always stays enabled), `import-svg`, `import-images`, `export-png`, `export-jpg`, `export-svg`, `export-pdf`, `autosave`, `recent-files`, `external-links`, `update-check`, `local-fonts`, `assignments`, `import-psd`, `import-ai`, `import-idml`, `export-psd`, `scripting`.

Files from other apps and automation (see [INTEROP.md](INTEROP.md) and [SCRIPTING.md](SCRIPTING.md)):

| ID | What disabling it removes |
|---|---|
| `import-psd` | Opening and placing Photoshop `.psd` / `.psb` files. |
| `import-ai` | Opening Illustrator `.ai` files and PDFs as editable documents (both use the PDF importer). |
| `import-idml` | Opening InDesign `.idml` files. |
| `export-psd` | *File ▸ Export Photoshop PSD…* and the PSD entry in the Export menu. |
| `scripting` | The Scripts panel, *View ▸ Scripts* and every script command. Scripts run in a sandbox with no file, network or clipboard access, but you may still want them off in exam rooms or for younger pupils. |
| `assignments` | *Assignment Details*, *Save Assignment Pack*, *Hand In*, and opening assignment packs and hand-in bundles. |

A disabled file type disappears from the Open dialog's filters and the menus. If such a file is opened anyway (from the command line, a file association or the recent list), Quvrelo says the administrator has turned it off instead of opening it.

### Example: secondary school
```json
{
  "organizationName": "Example Academy",
  "defaultSaveDirectory": "H:\\Quvrelo Work",
  "lockSaveDirectory": true,
  "allowedSaveDirectories": ["%USERPROFILE%\\OneDrive - Example Academy"],
  "handInDirectory": "\\\\fileserver\\handin$",
  "templateDirectories": ["\\\\fileserver\\templates$\\Quvrelo"],
  "disableUpdateCheck": true,
  "disableOnboarding": false,
  "autosaveIntervalSeconds": 45
}
```

### Example: primary school (simpler interface)
```json
{
  "organizationName": "Example Primary",
  "disabledFeatures": ["photo", "import-svg", "export-svg"],
  "uiScale": 1.2,
  "disableUpdateCheck": true
}
```

### Classroom assignments and hand-in

The whole workflow is file-based and offline: no learning platform, accounts or server software is needed, only a shared folder.

**Teacher: set an assignment**

1. Open or create the starting document (a worksheet, a poster template, a photo to edit).
2. *File ▸ Assignment Details…*: enter the title, class, teacher, due date and instructions. They are stored inside the document.
3. *File ▸ Save Assignment Pack…* writes `<Class> - <Title>.quvrelo-assignment`: a zip holding `assignment.json` (the brief), `template.quvrelo` (the starting document) and a short `README.txt`. Student-specific fields (name, hand-in time) are always stripped from the pack.
4. Share the pack however suits you: a read-only network folder, a folder listed in `templateDirectories` (it then appears on the welcome screen), your learning platform, or email.

**Student: work and hand in**

1. Opening the pack (double-click it; the installers register the `.quvrelo-assignment` file type) starts a **new, untitled** document from the template with the brief attached. The pack itself is never changed, so the whole class can open the same file.
2. *File ▸ Hand In…* (also in the **▾** next to Export) asks for their name and writes one bundle, `<Student> - <Assignment> - <YYYY-MM-DD HH.MM>.zip`, into `<handInDirectory>\<Class>\`. It contains:
   - `<Student> - <Assignment>.quvrelo`, the editable work;
   - `<Student> - <Assignment>.pdf`, a preview of every page for marking on any computer (omitted when `"handInIncludePreview": false`, and skipped rather than blocking the hand-in if it cannot be made);
   - `manifest.json`: student, class, assignment, teacher, due date, hand-in time, app version, page count and the SHA-256 of the work file.
3. An earlier hand-in is never overwritten: a second one gets a new timestamp, or ` (2)`, ` (3)`… if made in the same minute. The bundle is written to a temporary file and renamed, so a dropped network connection never leaves a half-written file under the final name.

**Teacher: mark**

- Open the `.zip` in Quvrelo (*File ▸ Open*; the dialog has a *Hand-in bundle* filter). Quvrelo opens the work as a document and shows who handed it in and when. If the work file does not match the checksum in the manifest, it says so.
- Or open the PDF preview from the zip in any PDF viewer.

**IT: set up the folders**

- Create one hand-in share and set `handInDirectory` to it, for example `"\\\\fileserver\\handin$"`. Quvrelo creates the `<Class>` subfolders as needed, using the class name from the assignment.
- Give students **create files** (and create folders, for new class folders) but not read or modify rights on others' files, so the share works as a drop box; give teachers read access. On macOS and Linux the equivalent is a write-only (`-wx`) directory for students.
- If you use `lockSaveDirectory`, the hand-in folder is always allowed in addition to the save folders.
- With `handInDirectory` unset, students pick a folder each time (useful for USB sticks or a OneDrive folder synced to the teacher).
- Turn the whole workflow off with `"disabledFeatures": ["assignments"]`.

### Deploying the policy
- **Group Policy Preferences:** *Computer Configuration ▸ Preferences ▸ Windows Settings ▸ Files* — copy `policy.json` to `%ProgramData%\Quvrelo\policy.json`.
- **Intune:** wrap a small PowerShell script: `New-Item -ItemType Directory -Force "$env:ProgramData\Quvrelo"; Copy-Item policy.json "$env:ProgramData\Quvrelo\policy.json" -Force`.
- **macOS MDM:** deliver the file with a script or package payload to `/Library/Application Support/Quvrelo/policy.json` (owner `root:wheel`, mode `644`).

### Linux
See [Linux deployment](#linux-deployment) below for AppImage, deb/rpm and Flatpak roll-out, including the policy file.

## Linux deployment

All Linux packages read the same machine-wide policy file, `/etc/quvrelo/policy.json` (same keys as above). Install it before or after the app:
```sh
sudo install -D -o root -g root -m 644 policy.json /etc/quvrelo/policy.json
```
Keep it root-owned and not writable by users. Check it took effect under *Help ▸ About* (policy source and any warnings). For a one-off test you can point a single launch at another file with `QUVRELO_POLICY_PATH=/path/to/policy.json quvrelo`.

### deb / rpm (recommended for managed fleets)
```sh
# Debian / Ubuntu / Mint — unattended
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ./Quvrelo-0.1.0-amd64.deb
sudo apt-get remove -y quvrelo            # uninstall

# Fedora / RHEL / Rocky
sudo dnf install -y ./Quvrelo-0.1.0-x86_64.rpm
sudo dnf remove -y quvrelo                # uninstall

# openSUSE
sudo zypper --non-interactive install --allow-unsigned-rpm ./Quvrelo-0.1.0-x86_64.rpm
```
The packages install to `/opt/Quvrelo`, add a `/usr/bin/quvrelo` launcher, a desktop entry (Graphics menu), hicolor icons (16–512 px) and register the `.quvrelo` MIME type (`application/vnd.quvrelo+zip`, alias `application/x-quvrelo`) and the legacy `.easel` type. Packages are not yet signed, so host them in your own repository (aptly, reprepro, Pulp, Satellite, Landscape) or push the file with Ansible/Puppet/Salt, for example:
```yaml
- ansible.builtin.apt:
    deb: /srv/pkgs/Quvrelo-0.1.0-amd64.deb
- ansible.builtin.copy:
    src: policy.json
    dest: /etc/quvrelo/policy.json
    owner: root
    group: root
    mode: "0644"
```

### AppImage (no root, any distribution)
```sh
sudo install -D -m 755 Quvrelo-0.1.0-x86_64.AppImage /opt/quvrelo/Quvrelo.AppImage
/opt/quvrelo/Quvrelo.AppImage
```
The AppImage is self-contained and needs no installation; it can also run from a shared or network folder. It does not add a menu entry or MIME type by itself, so prefer the deb/rpm on managed machines. It needs FUSE 2 (`libfuse2` / `libfuse2t64` on Ubuntu 24.04+); without it, run `Quvrelo.AppImage --appimage-extract-and-run`. If Electron's sandbox is unavailable (some hardened or container kernels), launch with `--no-sandbox`.

### Flatpak
The Flatpak is a single-file bundle built on the Flathub Electron runtime. Installing it system-wide fetches `org.freedesktop.Platform` 25.08 from Flathub the first time, so the machine needs Flathub access (or a local mirror) for that step.
```sh
# once per machine
sudo flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
# install / upgrade (system-wide, non-interactive)
sudo flatpak install --system -y --noninteractive ./Quvrelo-0.1.0.flatpak
# run / uninstall
flatpak run com.quvrelo.app
sudo flatpak uninstall --system -y com.quvrelo.app
```
- **App ID:** `com.quvrelo.app` (desktop entry `com.quvrelo.app.desktop`, AppStream metadata so GNOME Software / KDE Discover show a description and screenshots).
- **Policy:** the Flatpak reads the host's `/etc/quvrelo/policy.json`; it is granted a read-only view of the host `/etc` (`--filesystem=host-etc:ro`) for this, so *Help ▸ About* shows the path as `/run/host/etc/quvrelo/policy.json`. Do not remove that permission if you use a policy file.
- **File access:** home folders, `/media`, `/mnt`, `/run/media` and GVFS mounts (`smb://` shares opened in the file manager). If `defaultSaveDirectory`, `handInDirectory` or `templateDirectories` point elsewhere (for example `/srv/handin`), grant it machine-wide:
  ```sh
  sudo flatpak override --system --filesystem=/srv/handin com.quvrelo.app
  ```
- **Fully offline:** the network permission exists only for the update check. To remove it, set `"disableUpdateCheck": true` and run `sudo flatpak override --system --unshare=network com.quvrelo.app`.
- **Updates:** the Flatpak never replaces itself. It tells the user a new version exists and shows `flatpak update com.quvrelo.app`. A bundle installed from a file is updated by installing the newer bundle over it: `sudo flatpak install --system -y --noninteractive --reinstall ./Quvrelo-<new>.flatpak`.
- User data for the Flatpak lives in `~/.var/app/com.quvrelo.app/config/Quvrelo/` rather than `~/.config/Quvrelo/`.

## 4. Data locations

| Data | Windows | macOS | Linux |
|---|---|---|---|
| User settings, recent files | `%APPDATA%\Quvrelo\` | `~/Library/Application Support/Quvrelo/` | `~/.config/Quvrelo/` (Flatpak: `~/.var/app/com.quvrelo.app/config/Quvrelo/`) |
| Crash-recovery autosaves | `%APPDATA%\Quvrelo\recovery\` | `~/Library/Application Support/Quvrelo/recovery/` | `~/.config/Quvrelo/recovery/` (Flatpak: under `~/.var/app/com.quvrelo.app/config/`) |

Recovery files are deleted when a document is saved or closed without saving. Nothing is written outside these folders and the locations users choose to save to.

## 5. Accessibility
- Full keyboard operation: every command has a menu item; tools have single-key shortcuts; panels and dialogs are tab-navigable with visible focus rings; dialogs trap focus and close with Esc.
- High-contrast theme, interface scaling up to 200%, dyslexia-friendly interface font (OpenDyslexic/Atkinson Hyperlegible), reduce-motion option.
- Screen-reader labels on toolbar buttons, panels and canvas controls.

## 6. Network & security summary
Full audit evidence, with source locations and tests: [OFFLINE.md](OFFLINE.md).

- Electron with `contextIsolation`, `sandbox` and no Node integration in the renderer.
- A Content Security Policy and a session-level request filter both cancel all non-local requests from the UI. In installed (packaged) builds that includes `localhost` and WebSockets; the development-server exception exists only in unpackaged developer runs.
- Fonts, the subject-selection model and its WebAssembly runtime are bundled; nothing is downloaded at runtime. On Linux, spell-check dictionaries are read from `resources/dictionaries/` and never downloaded.
- Links open in the system browser only for `http(s)` URLs and only while `external-links` is enabled.
- Scripts run in a WebAssembly (QuickJS) sandbox with no file, network or clipboard access ([SCRIPTING.md](SCRIPTING.md)); `"disabledFeatures": ["scripting"]` removes them.
- The update check runs in the main process; it is the only outbound traffic and `disableUpdateCheck` removes it.
- Files are written atomically (temporary file + rename) to avoid corruption on network drives.
- The app does not install services, drivers, scheduled tasks or browser extensions.

## 7. Updates

Quvrelo uses [electron-updater](https://www.electron.build/auto-update) (MIT). It checks **30 seconds after launch and then every 4 hours**, downloads in the background, verifies the download's **SHA-512** against the feed's `latest*.yml` (and, on macOS, the code signature), and then shows *"Quvrelo x.y.z is ready — Restart"*. If the user doesn't restart, the update installs when they quit. Restarting never loses work: an unsaved document gets the normal *Save / Don't Save / Cancel* prompt first, and *Cancel* keeps the app open. Users can also open *Help ▸ Check for Updates* at any time, and choose **Stable** or **Beta** and turn off background downloads in *Preferences ▸ General*.

### What each installer does

| Installed with | Behaviour |
|---|---|
| Windows **NSIS** (`Quvrelo-Setup-*.exe`) | Full automatic update, delta download (`.blockmap`). Per-user installs update silently. Per-machine installs (`/allusers`) show a UAC prompt when installing the update; on managed machines use the MSI or `disableUpdateCheck`. |
| Windows **MSI** | Notify only: "Download Update" opens the release page. Deploy the new MSI with your tooling. |
| Windows portable / unpacked folder | Off. |
| macOS **DMG / PKG**, signed and notarised | Full automatic update through Squirrel.Mac (uses the `.zip` + delta `.blockmap`). |
| macOS, **unsigned** build | Notify only: "Download Update" opens the release page. Squirrel.Mac refuses to update an app without a Developer ID signature, and Quvrelo detects this at launch (`codesign`). Current CI builds are unsigned until the signing secrets are added (below). |
| Linux **AppImage** | Full automatic update (the AppImage file is replaced; delta download from its embedded blockmap). The AppImage's folder must be writable by the user. |
| Linux **deb / rpm** | Notify only, because installing needs root. The dialog shows the command, e.g. `sudo apt install ./Quvrelo-x.y.z-amd64.deb` / `sudo dnf install ./Quvrelo-x.y.z-x86_64.rpm`, and a *Download Package* button. Manage versions with your package repository. |
| Linux **Flatpak** | Notify only; shows `flatpak update com.quvrelo.app`. |
| Development builds | Off. |

### Policy keys

See the [key table](#keys): `disableUpdateCheck`, `updateFeedUrl`, `autoDownload`, `autoInstall`, `updateChannel`. Locked settings are shown greyed out in *Preferences ▸ General* with "Set by your organisation". Example for a school that hosts its own updates and wants to choose when they install:

```json
{
  "updateFeedUrl": "https://deploy.school.example/quvrelo/",
  "autoDownload": true,
  "autoInstall": false,
  "updateChannel": "stable"
}
```

### Disabling per platform

The policy file is per machine, so deploy `{"disableUpdateCheck": true}` only to the machines (or OS images) that should not update: e.g. through Intune/GPO to Windows, a configuration profile/MDM script to Macs, or your Linux config management to `/etc/quvrelo/policy.json`. MSI, deb, rpm and Flatpak installs never replace themselves anyway; they only tell the user a new version exists. To silence even that, set `disableUpdateCheck`.

### Hosting updates on an internal server

Any static web server works (IIS, nginx, Apache, a NAS share served over HTTP). Set `updateFeedUrl` to the folder. Copy **every asset of a GitHub release** into it, keeping the file names; the client requests `<updateFeedUrl>/<channel file>` and then the files it lists:

```
https://deploy.school.example/quvrelo/
├── latest.yml                        Windows (NSIS)
├── latest-mac.yml                    macOS (x64 + arm64)
├── latest-linux.yml                  Linux x64 (AppImage, deb, rpm)
├── latest-linux-arm64.yml            Linux arm64 (if you ship it)
├── Quvrelo-Setup-x.y.z.exe   + .exe.blockmap
├── Quvrelo-x.y.z-mac-x64.zip + .zip.blockmap
├── Quvrelo-x.y.z-mac-arm64.zip + .zip.blockmap
├── Quvrelo-x.y.z-mac-*.dmg   (+ .blockmap)
├── Quvrelo-x.y.z-x86_64.AppImage
├── Quvrelo-x.y.z-amd64.deb, Quvrelo-x.y.z-x86_64.rpm
└── beta.yml, beta-mac.yml, beta-linux.yml   only if you offer the Beta channel
```

- Copy the installers **before** the `.yml` files, so clients never see metadata that points at a file that isn't there yet.
- Keep the previous version's files for a while: delta downloads read the old version's blockmap.
- Beta: prerelease builds (`vX.Y.Z-beta.N`) ship `beta*.yml`. Clients on the Beta channel read only `beta*.yml` from a generic feed, so when you publish a stable release also copy its `latest*.yml` to the matching `beta*.yml` names (otherwise Beta users stay on the last beta).
- Use HTTPS where you can. The SHA-512 in the `.yml` protects against corrupted downloads; HTTPS (and, on Windows/macOS, code signing) protects against a tampered feed.
- The server needs no special configuration. Byte-range requests (supported by every common web server) make delta downloads efficient.

### The public feed and the private repository

Without `updateFeedUrl` the app reads GitHub Releases of `TheWarrior-tech/Quverelo`: the release Atom feed and the `latest*.yml` assets, **anonymously**. No GitHub token is, or ever will be, embedded in the app. **While the repository is private, clients cannot read it, so automatic updates do not work** (the dialog says no published update was found). Updates start working as soon as the repository is public, or immediately for machines with an `updateFeedUrl`.

### Release side (maintainers)

CI (`.github/workflows/build.yml`) builds on `v*` tags and uploads, for every platform, the installers plus `latest*.yml` and the `.blockmap` files (macOS also gets the `.zip` targets that Squirrel.Mac needs; the x64 and arm64 metadata are merged into one `latest-mac.yml`). The release job fails if any platform's metadata, a file it references or a delta blockmap is missing. Tags with a hyphen (`v0.3.0-beta.1`) are published as **prereleases**, which only the Beta channel sees.

**macOS signing** (needed for macOS auto-update): add repository secrets `MAC_CSC_LINK` (base64 Developer ID Application `.p12`), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. CI then signs with the hardened runtime and notarises; without them the mac build stays unsigned and those users get "Download Update" instead. **Windows signing** is optional for updates (the SHA-512 is always checked) but avoids SmartScreen warnings; once the NSIS installer is signed, electron-updater also verifies the publisher of each update.

## Further reading

- [OFFLINE.md](OFFLINE.md): offline operation, audit evidence for security and data-protection reviews.
- [INTEROP.md](INTEROP.md): what Quvrelo keeps and what it changes when opening Photoshop, Illustrator/PDF and InDesign files, and the route for Affinity files.
- [SCRIPTING.md](SCRIPTING.md): the scripting API, its sandbox and limits.
- [BENCHMARKS.md](BENCHMARKS.md): performance on large photos and long documents, useful for sizing classroom hardware.
