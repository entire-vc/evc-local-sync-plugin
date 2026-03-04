# Security Policy

  ## Supported Versions

  | Version | Supported          |
  | ------- | ------------------ |
  | 1.1.x   | Yes                |
  | < 1.1   | No                 |

  ## Reporting a Vulnerability

  If you discover a security vulnerability in this plugin, please report it responsibly.

  **Email:** [security@entire.vc](mailto:security@entire.vc)

  Please include:
  - Description of the vulnerability
  - Steps to reproduce
  - Potential impact
  - Suggested fix (if any)

  We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

  ## Scope

  This plugin runs entirely locally and does not transmit any data over the network. Security concerns are primarily related to:
  - File system access and permissions
  - Path traversal prevention
  - Safe handling of file operations between mapped directories
