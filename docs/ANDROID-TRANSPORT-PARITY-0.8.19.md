# Android transport parity for 0.8.19

The common Android host and client transport now support pinned reverse-relay transport and ephemeral delegated authentication when an explicit backend verifier is supplied. The default verifier denies delegation. Core does not instantiate account registration, has no CloudSync class or account discovery settings, and its CAgent service does not start an account relay. This preserves the existing edition boundary and package identity.

Only the transport, authentication, and their TLS instrumentation tests were synchronized. MainActivity, the Core website UI, app ID, version and signing settings were not replaced with Pro files.

Validation: Core release Java and debug instrumentation Java compilation passed. Actual API 29/35 instrumentation execution is pending; compilation is not evidence of real device relay connectivity.
