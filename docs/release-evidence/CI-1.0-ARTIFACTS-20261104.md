# 1.0.0 native build provenance

All 22 final native jobs completed successfully. Release publication remains a separate operation.

| Edition | Component | GitHub Actions run | Actual source |
| --- | --- | --- | --- |
| Pro | CAgent, five native platforms | 41820873305 | 9f8ce21414fda60e447876a734c7504c7b32a8a8 |
| Open source | CAgent, five native platforms | 41820883532 | cc19c42595fef394ff79e681a827b548e7610ca8 |
| Pro | Desktop, five native platforms | 41823420346 | 776c7067e5a85660ea1743c0f67afd8b9a188952 |
| Open source | Desktop, five native platforms | 41823424644 | 94290b058ee8a3dca7129790165dd9012afc9308 |
| Pro | Android | 41824491011 | 8c9cbf32d91037ccd4dc11b7113e8d230f1f0fdd |
| Open source | Android | 41824496134 | c3d57ae8b4d4815a3b20817cad8190129e7e170b |

Native platforms: Windows x64, macOS x64/arm64, Linux x64/arm64. Desktop Linux jobs produce both DEB and AppImage. Each edition has 13 application packages plus one SHA256SUMS.txt, explicitly enumerated in `services/update-edge/verified-{opensource,pro}-100.json`.

The two editions build from separate branches. Open-source preflight rejects private account-bridge/cloud files and requires hardcoded open-source build flags. Pro jobs cannot produce open-source assets. No Pro source was merged into open-source main.

Every downloaded Actions ZIP was compared with its GitHub SHA-256 digest. Each extracted release attachment was independently hashed and its size recorded in the release plan. The eight CAgent tarballs' internal build-info files were checked for version, edition, platform, architecture and independent Node runtime. Windows CAgent installers passed native packaged-runtime smoke tests in CI. Android verification checks all four VPN library ABIs, package ID, version and the persistent signing certificate, and both complete lint jobs passed.

CAgent sources were reused because subsequent changes affect desktop React/i18n, Android, release documentation and publication tooling only. Desktop sources were reused after the Android-only manifest/VPN-view/back-navigation fix. Plans preserve actual per-asset source SHA and run ID instead of claiming every file was built at the release target SHA.

Earlier failed Android attempts were superseded, not hidden: SDK manager discovery was corrected, obsolete SDK `tools` installation was removed, then five real lint errors were fixed without suppressing lint globally. Old desktop candidates preceding the final English navigation fix are excluded.

Successful native build and package tests do not constitute macOS signing/notarization or every-platform physical-device validation. Those limitations remain in release notes.
