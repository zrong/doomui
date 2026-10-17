# Security policy

## Reporting a vulnerability

Please report security vulnerabilities privately to **zrongzrong@gmail.com**. Include the affected DoomUI version, the operating system and host versions, a description of the impact, and a minimal reproduction with synthetic data.

Do not post private designs, pairing codes, session tokens, personal information, or an unpatched exploit in a public GitHub issue. General support and non-sensitive bug reports can use [GitHub Issues](https://github.com/zrong/doomui/issues).

Reports are handled on a best-effort basis. This project does not promise a response deadline, a fix deadline, a bounty, or third-party security certification. The maintainer will review reproducible reports and coordinate fixes and disclosure where appropriate.

## Scope and architecture

Cocos Sync communicates only with the Figma Sync extension running in Cocos Creator on the same computer. The service listens on `127.0.0.1:38638`, and the Figma plugin permits only `http://localhost:38638`.

The plugin transfers explicitly selected design structures and required images to that local service. It uses a short-lived pairing code and a session token, stores local connection state in Figma clientStorage, and stores document mapping markers in plugin-data. Cocos project Profiles hold synchronization mappings and settings. There is no project-operated remote backend or analytics service.

Loopback communication uses HTTP; it is not a claim of end-to-end encrypted transport or protection against a compromised local computer. Preview does not write assets. Apply requires an explicit user action and uses the existing asset ownership and rollback rules.

## Versions and known limitations

Report against the latest tagged source release when possible. Older versions are not covered by a maintenance guarantee. Figma Community availability and Cocos/Figma runtime acceptance are recorded separately from automated test results.

Known dependency audit results and remaining host acceptance work are recorded in [the acceptance notes](docs/acceptance.md). Passing automated tests does not imply that all dependency vulnerabilities or host integration issues have been resolved.
