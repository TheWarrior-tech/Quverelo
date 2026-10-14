# Quvrelo — IT Administrator Deployment Guide

Quvrelo is designed to be deployed to shared school and office computers with no per-user setup:

- **No accounts, no licence keys, no sign-in.**
- **No telemetry.** The app never contacts the internet on its own. The renderer process is blocked from all network requests. The only network call is *Help ▸ Check for Updates*, which runs only when a user clicks it and can be removed with `"disableUpdateCheck": true`.
- **No automatic updates.** You stay in control of versions; deploy new installers through your usual tooling.

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
| `handInDirectory` | string \| null | `null` | Folder used by *File ▸ Hand In*. Work is copied to `<handInDirectory>\<Class>\<Student> - <Assignment> - <timestamp>.quvrelo`. If unset, students choose a folder. |
| `templateDirectories` | string[] | `[]` | Folders containing `.quvrelo` files shown as "School templates" on the welcome screen (network shares are fine; unavailable folders are skipped). |
| `disabledFeatures` | string[] | `[]` | Features to remove from the UI. See the list below. |
| `disableUpdateCheck` | boolean | `false` | Removes *Help ▸ Check for Updates*, so the app makes no network requests at all. |
| `autosaveIntervalSeconds` | number | `60` | Crash-recovery autosave interval (0–3600; `0` disables autosave). |
| `forceTheme` | `"dark"` \| `"light"` \| `"high-contrast"` \| null | `null` | Forces a theme for everyone. |
| `uiScale` | number | `1` | Default interface scale (0.75–2). |
| `lockUiScale` | boolean | `false` | Prevents users changing the interface scale. |
| `showWelcomeScreen` | boolean | `true` | Show the welcome screen at launch. |
| `maxUndoSteps` | number | `250` | Undo history length (10–2000) — lower it on low-memory machines. |

#### Feature IDs for `disabledFeatures`
`photo`, `vector`, `layout` (whole studios — at least one always stays enabled), `import-svg`, `import-images`, `export-png`, `export-jpg`, `export-svg`, `export-pdf`, `autosave`, `recent-files`, `external-links`, `update-check`, `local-fonts`, `assignments`.

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
- **Fully offline:** the network permission exists only for *Help ▸ Check for Updates*. To remove it as well as the menu item, set `"disableUpdateCheck": true` and run `sudo flatpak override --system --unshare=network com.quvrelo.app`.
- **Updates:** a bundle installed from a file does not update itself. Install the newer bundle over it with `sudo flatpak install --system -y --noninteractive --reinstall ./Quvrelo-<new>.flatpak`.
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
- Electron with `contextIsolation`, `sandbox` and no Node integration in the renderer.
- A session-level request filter cancels all non-local requests from the UI.
- Files are written atomically (temporary file + rename) to avoid corruption on network drives.
- The app does not install services, drivers, scheduled tasks or browser extensions.
