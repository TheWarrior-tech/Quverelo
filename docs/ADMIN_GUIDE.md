# Easel Studio — IT Administrator Deployment Guide

Easel Studio is designed to be deployed to shared school and office computers with no per-user setup:

- **No accounts, no licence keys, no sign-in.**
- **No telemetry.** The app never contacts the internet on its own. The renderer process is blocked from all network requests. The only network call is *Help ▸ Check for Updates*, which runs only when a user clicks it and can be removed with `"disableUpdateCheck": true`.
- **No automatic updates.** You stay in control of versions; deploy new installers through your usual tooling.

## 1. Installers

| File | Use |
|---|---|
| `EaselStudio-<ver>-x64.msi`, `EaselStudio-<ver>-arm64.msi` | Windows per-machine install (Intune, SCCM/MECM, Group Policy software installation, PDQ). |
| `EaselStudio-Setup-<ver>-x64.exe`, `...-arm64.exe` | Windows NSIS installer; per-user or per-machine. |
| `EaselStudio-<ver>-mac-arm64.pkg`, `...-mac-x64.pkg` | macOS installer package for Jamf, Mosyle, Kandji, Munki or Apple Remote Desktop. Installs to `/Applications`. |
| `EaselStudio-<ver>-mac-arm64.dmg`, `...-mac-x64.dmg` | macOS drag-to-install disk image. |

Each release also includes `SHA256SUMS.txt` so you can verify downloads.

## 2. Silent installation

### Windows — MSI (recommended for managed fleets)
```bat
msiexec /i EaselStudio-0.1.0-x64.msi /qn /norestart
msiexec /i EaselStudio-0.1.0-x64.msi /qn /l*v "%TEMP%\easel-install.log"
:: uninstall
msiexec /x EaselStudio-0.1.0-x64.msi /qn
```
The MSI installs per-machine into `C:\Program Files\Easel Studio` and creates Start-menu and desktop shortcuts for all users.

### Windows — NSIS EXE
```bat
:: per-machine (all users), silent; requires elevation
EaselStudio-Setup-0.1.0-x64.exe /S /allusers
:: per-user, silent, no elevation
EaselStudio-Setup-0.1.0-x64.exe /S /currentuser
:: custom directory (must be the last argument, no quotes)
EaselStudio-Setup-0.1.0-x64.exe /S /allusers /D=D:\Apps\Easel Studio
:: silent uninstall (per-machine)
"C:\Program Files\Easel Studio\Uninstall Easel Studio.exe" /S /allusers
```

### Intune (Win32 app)
- Install command: `msiexec /i EaselStudio-0.1.0-x64.msi /qn`
- Uninstall command: `msiexec /x {product-code} /qn` (Intune detects the product code automatically from the MSI)
- Detection rule: MSI product code, or file `C:\Program Files\Easel Studio\Easel Studio.exe` exists.

### macOS
```sh
sudo installer -pkg EaselStudio-0.1.0-mac-arm64.pkg -target /
```
Releases are **not yet notarised**. Gatekeeper may block first launch for users; remove the quarantine attribute as part of your deployment script:
```sh
sudo xattr -dr com.apple.quarantine "/Applications/Easel Studio.app"
```
(Packages pushed by MDM are normally not quarantined.)

## 3. Policy file (`policy.json`)

A machine-wide JSON file lets you control behaviour for every user. Easel Studio reads it at launch.

| OS | Location |
|---|---|
| Windows | `%ProgramData%\EaselStudio\policy.json` (usually `C:\ProgramData\EaselStudio\policy.json`) |
| macOS | `/Library/Application Support/EaselStudio/policy.json` |
| Linux | `/etc/easel-studio/policy.json` |

Make the file read-only for standard users. Invalid keys are ignored and listed under *Help ▸ About* ("Policy warnings"), so a typo never stops the app from starting. An example ships inside the app at `resources/policy.example.json` and in this repository at [`docs/policy.example.json`](policy.example.json).

### Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `organizationName` | string \| null | `null` | Shown in the title bar, welcome screen and About box. |
| `defaultSaveDirectory` | string \| null | `null` (Documents) | Starting folder for Save, Export and Open dialogs. Supports `%USERPROFILE%`, `%USERNAME%`, `%DOCUMENTS%`, any `%ENV_VAR%`, `~` and `$USER`. |
| `lockSaveDirectory` | boolean | `false` | When `true`, users can only save/export inside `defaultSaveDirectory`, `allowedSaveDirectories` or `handInDirectory`. Requires `defaultSaveDirectory`. |
| `allowedSaveDirectories` | string[] | `[]` | Extra permitted folders when locked (e.g. a OneDrive folder or USB path). |
| `handInDirectory` | string \| null | `null` | Folder used by *File ▸ Hand In*. Work is copied to `<handInDirectory>\<Class>\<Student> - <Assignment> - <timestamp>.easel`. If unset, students choose a folder. |
| `templateDirectories` | string[] | `[]` | Folders containing `.easel` files shown as "School templates" on the welcome screen (network shares are fine; unavailable folders are skipped). |
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
  "defaultSaveDirectory": "H:\\Easel Work",
  "lockSaveDirectory": true,
  "allowedSaveDirectories": ["%USERPROFILE%\\OneDrive - Example Academy"],
  "handInDirectory": "\\\\fileserver\\handin$",
  "templateDirectories": ["\\\\fileserver\\templates$\\Easel"],
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
- **Group Policy Preferences:** *Computer Configuration ▸ Preferences ▸ Windows Settings ▸ Files* — copy `policy.json` to `%ProgramData%\EaselStudio\policy.json`.
- **Intune:** wrap a small PowerShell script: `New-Item -ItemType Directory -Force "$env:ProgramData\EaselStudio"; Copy-Item policy.json "$env:ProgramData\EaselStudio\policy.json" -Force`.
- **macOS MDM:** deliver the file with a script or package payload to `/Library/Application Support/EaselStudio/policy.json` (owner `root:wheel`, mode `644`).

## 4. Data locations

| Data | Windows | macOS |
|---|---|---|
| User settings, recent files | `%APPDATA%\Easel Studio\` | `~/Library/Application Support/Easel Studio/` |
| Crash-recovery autosaves | `%APPDATA%\Easel Studio\recovery\` | `~/Library/Application Support/Easel Studio/recovery/` |

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
