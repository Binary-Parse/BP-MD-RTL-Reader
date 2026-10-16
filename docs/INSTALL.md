# Install

This page shows how to choose a package, install BP MD RTL Reader, check your download, and later update or remove the app.

## Contents

- [Choose a package](#choose-a-package)
- [Check your download](#check-your-download)
- [Install on Windows](#install-on-windows)
- [Install on Linux](#install-on-linux)
- [Set up file association](#set-up-file-association)
- [Add the app to PATH](#add-the-app-to-path)
- [Silent install and uninstall](#silent-install-and-uninstall)
- [Update](#update)
- [Uninstall](#uninstall)

## Choose a package

Builds are on the [Releases page](https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases). In the file names below, `<version>` is the release number.

| You have | Download | Notes |
| -------- | -------- | ----- |
| Windows 10 or 11, x64 or ARM64 | `BP-MD-RTL-Reader-<version>-Windows-NSIS-multiarch.exe` | The standard installer. One file holds the x64 and the ARM64 build. |
| Windows 10 22H2 or 11, x64 | `BP-MD-RTL-Reader-<version>-Windows-Inno-x64.exe` | An alternative installer. x64 only. |
| Windows, no installation wanted | `BP-MD-RTL-Reader-<version>-Windows-Portable-multiarch.exe` | Runs from any folder. x64 and ARM64. |
| Linux, x64 | `BP-MD-RTL-Reader-<version>-Linux-x86_64.AppImage` or `…-Linux-amd64.deb` | |
| Linux, ARM64 | `BP-MD-RTL-Reader-<version>-Linux-arm64.AppImage` or `…-Linux-arm64.deb` | Built, but not run on real hardware. |
| macOS | None | Not built and not tested. |

32-bit Windows is not built.

The x64 Linux files were started and tested on Ubuntu under WSL 2. The project has not published test results for the Windows ARM64 build.

Each release also has a `SHA256SUMS.txt` file and an Inno `…source-manifest.json` file. You do not need the manifest to install.

## Check your download

> [!IMPORTANT]
> The release files are not code-signed. A checksum proves that your file is the one that was published. It does not replace a signature.

Every release ships `SHA256SUMS.txt`. Check your download against it before you run it.

On Windows, in PowerShell:

```powershell
(Get-FileHash .\BP-MD-RTL-Reader-<version>-Windows-NSIS-multiarch.exe -Algorithm SHA256).Hash
```

The value must equal the line for that file in `SHA256SUMS.txt`.

On Linux, with `SHA256SUMS.txt` in the same folder as the files you downloaded:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
```

Every file you downloaded should print `OK`.

## Install on Windows

### The standard installer

1. Run the NSIS installer. It asks for administrator permission, because it installs for all users.
2. Read and accept the license page. The text is in English and Arabic.
3. Choose the install folder. You can change the default.
4. Choose whether to add the app to PATH. See [Add the app to PATH](#add-the-app-to-path). The default is to leave PATH unchanged.
5. Finish. The installer adds a desktop shortcut and a Start menu shortcut, and offers to start the app.

If the app is already installed, the first page is a maintenance page. It shows the installed version and offers **upgrade** (the default), **repair** (when the versions match) or **remove**. For a downgrade, it defaults to exiting with a warning. **Remove** opens Windows **Installed apps** in Settings.

### The Inno installer

The Inno installer installs for all users by default and asks for administrator permission. You can choose to install for the current user only: pick that in the dialog, or start it with `/CURRENTUSER`. It offers an optional desktop icon and an "Open with" entry for Markdown files. See [Set up file association](#set-up-file-association).

### The portable file

Copy the file anywhere and run it. Nothing is installed. The app still keeps its settings in your profile folder, not next to the file. See [Files and limits](FILES_AND_LIMITS.md#the-profile-folder).

### SmartScreen warning

Windows shows "Windows protected your PC" (SmartScreen) because the file is not code-signed. After you have checked the download against `SHA256SUMS.txt`, choose **More info**, then **Run anyway**.

## Install on Linux

### AppImage

```bash
chmod +x BP-MD-RTL-Reader-<version>-Linux-x86_64.AppImage
./BP-MD-RTL-Reader-<version>-Linux-x86_64.AppImage
```

Nothing is installed. Move the file wherever you like.

### Debian package

```bash
sudo apt install ./BP-MD-RTL-Reader-<version>-Linux-amd64.deb
```

The package adds a menu entry and registers the app for `text/markdown` files. It also installs Chromium's sandbox helper. [The security policy](../SECURITY.md) explains why you should prefer the `.deb` over the AppImage when you can.

If the app does not start, see [Troubleshooting](TROUBLESHOOTING.md#the-appimage-does-not-start).

## Set up file association

File association lets you double-click a `.md` file to open it here.

| Package | What it does |
| ------- | ------------ |
| NSIS installer | Registers the app for `.md` and `.markdown` files. |
| Inno installer | A checkbox adds an "Open with BP MD RTL Reader" entry to `.md` and `.markdown` files. It is ticked by default. |
| Portable file | Does nothing. |
| `.deb` package | Registers the app for `text/markdown`. |
| AppImage | Does nothing by itself. |

An installer entry adds the app to the "Open with" list. To make it the default, use Windows **Settings → Apps → Default apps**, or right-click a `.md` file, choose **Open with**, then **Always**.

## Add the app to PATH

The NSIS installer has an optional **Add to PATH** choice on the page after the install folder. It adds the install folder to the system PATH, so you can start the app from a terminal. Open a new terminal after installing.

The uninstaller removes exactly that entry and leaves the rest of PATH alone.

## Silent install and uninstall

Run these from an elevated prompt.

| Installer | Switch | Effect |
| --------- | ------ | ------ |
| NSIS | `/S` | Install without any pages. An existing install is upgraded in place |
| NSIS | `/add-path` | With `/S`, also add the app to PATH |
| Inno | `/SILENT` or `/VERYSILENT` | Install without pages (standard Inno switches) |
| Inno | `/CURRENTUSER` | Install for the current user only |
| Inno | `/TASKS="desktopicon,associatemd"` | Add the desktop icon and the "Open with" entry (standard Inno switch) |

Uninstall switches differ by installer:

| Installer | Switch | Effect |
| --------- | ------ | ------ |
| NSIS | `/S` | Remove the app and keep your settings and app data |
| NSIS | `/S /DELETEUSERDATA` or `/S --delete-app-data` | Remove the app and delete the app data of the current Windows account |
| Inno | `/SILENT` or `/VERYSILENT` | Remove the app and keep your settings and app data |
| Inno | `/VERYSILENT /DELETEUSERDATA` | Remove the app and delete the app data of the current Windows account |

With either uninstaller, `/DELETEUSERDATA` without a silent switch skips the choice page and deletes the app data.

## Update

The app never updates itself and never downloads anything. To update:

1. Download the new release and check it against `SHA256SUMS.txt`.
2. Run the new installer over the old install. The NSIS maintenance page offers **upgrade**. For the portable file or an AppImage, replace the old file.

Your settings, highlights and recovery data stay in the profile folder, so they carry over.

To hear about new releases, turn on **Check for updates automatically** in Settings, or choose **Help → Check for Updates…**. The app then tells you when a newer release exists and opens the releases page. [Privacy](PRIVACY.md#network-access) describes exactly what it sends.

## Uninstall

### Windows

1. Open **Settings → Apps → Installed apps**, find **BP MD RTL Reader** and choose **Uninstall**. You can also run the uninstaller from the install folder.
2. Choose one of the two options, then click **Uninstall**:
   - **Remove app only.** This is the default. It keeps your settings and app data for a future reinstall.
   - **Remove app and all app data.** This also deletes the app data of your Windows account.
3. **Cancel** leaves everything as it was.

Your Markdown notes are never deleted. They stay wherever you saved them. [Privacy](PRIVACY.md#remove-the-app-data) lists the exact folders that **Remove app and all app data** deletes.

The portable file has no uninstaller. Delete the file, then delete the profile folder yourself if you want to remove the settings.

### Linux

Remove the package or delete the AppImage:

```bash
sudo apt remove bpmdrtlreader
```

This leaves the profile folder in place. To remove the app data, delete it yourself:

```bash
rm -r ~/.config/bpmdrtlreader
```
