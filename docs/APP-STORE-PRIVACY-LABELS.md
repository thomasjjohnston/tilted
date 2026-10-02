# App Store privacy labels (App Privacy section in App Store Connect)

Answer sheet for the "App Privacy" questionnaire. Must agree with
`apps/ios/Tilted/Tilted/PrivacyInfo.xcprivacy` and the policy at `/privacy`.

**Do you collect data from this app?** Yes.

| Data type | Collected | Linked to the user | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact Info → Name | Yes (if shared via Sign in with Apple) | Yes | No | App Functionality |
| Contact Info → Email Address | Yes (if shared; may be an Apple relay address) | Yes | No | App Functionality |
| Identifiers → User ID | Yes (Apple account identifier, our user id) | Yes | No | App Functionality |
| User Content → Gameplay Content | Yes (matches, hands, bets, pinned hands) | Yes | No | App Functionality |
| Usage Data → Product Interaction | Yes (app events such as sign-in, match started) | Yes | No | Analytics (first-party only) |

Everything else: **not collected**. In particular: no location, no contacts,
no purchases, no device identifiers for advertising, no diagnostics SDKs,
no third-party analytics, no tracking.

Notes for the questionnaire:

- "Analytics" here means our own server's event table, not a third-party
  service. Choose *Analytics* as the purpose and *No* for tracking.
- Push notification device tokens are not listed; Apple does not require
  declaring them.
- Data is deletable by the user in the app (Settings → Delete Account).
