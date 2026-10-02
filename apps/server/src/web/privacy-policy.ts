import { SUPPORT_EMAIL } from './contact.js';

/** Bump whenever the text changes; shown on the page. */
export const PRIVACY_POLICY_UPDATED = '2026-10-02';

const h2 = (t: string) => `<h2 style="font-family:Georgia,serif;font-weight:400;font-size:1.3rem;margin-top:2rem">${t}</h2>`;
const p = (t: string) => `<p style="text-align:left">${t}</p>`;

export const PRIVACY_POLICY_HTML = `
<h1>Privacy policy</h1>
<p><small>Last updated ${PRIVACY_POLICY_UPDATED}</small></p>
${p('Tilted is a poker game for iPhone played between friends with play chips. This policy explains what information the app collects, why, and what you can do about it. It is written to be read, not skimmed; it is short because the app collects little.')}

${h2('Who is responsible')}
${p(`Tilted is operated by an individual developer in the United States. Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`)}

${h2('What we collect')}
${p('<strong>Account.</strong> You sign in with Apple. Apple gives us a unique identifier for your account and, if you choose to share them, your name and email address. If you hide your name, we give you a generated nickname instead. If you hide your email, we receive Apple\'s private relay address.')}
${p('<strong>Gameplay.</strong> The matches, rounds, hands, cards and bets in your games, who you played, and which hands you pinned. This is the game; without it there is nothing to show you.')}
${p('<strong>Notifications.</strong> If you allow notifications, a device token so we can tell you it is your turn. You can turn notifications off in iOS Settings at any time.')}
${p('<strong>Invites and blocks.</strong> Invite codes you create or use, and the players you block.')}
${p('<strong>Usage events.</strong> Basic events such as "signed in", "match started" or "hand completed", tied to your account id, used to find bugs and understand whether the game works. No advertising identifiers.')}

${h2('What we do not do')}
${p('We do not sell or share your information with anyone for their own purposes. There are no ads, no third-party analytics or tracking SDKs, and no real-money play. We do not read your contacts: when you invite a friend, the system share sheet does the sending and we never see who you chose.')}

${h2('Who can see what')}
${p('Your opponents see your display name and, for hands that reach showdown, your cards. The person you invited sees your first name on the invite page. Nobody else can see you: there is no public list of players or search.')}

${h2('Where it is kept')}
${p('Data is stored on servers in the United States (hosting by Fly.io and Neon). Connections between the app and the server are encrypted. Apple handles notification delivery.')}

${h2('How long we keep it')}
${p('For as long as you have an account. When you delete your account (Settings → Delete Account) we immediately remove your Apple identifier, name, email, notification token, sign-in sessions and pinned hands, and end any matches in progress. Hands you played remain in your opponents\' history, attributed to "Deleted Player", because they are part of their game too. Backups are kept for operational safety and age out over time.')}

${h2('Your choices')}
${p('Delete your account in the app. Revoke Tilted\'s access to your Apple ID in your Apple ID settings; we are told when you do and treat it as deletion. Turn notifications off in iOS Settings. Block any player you have played. For anything else, including a copy of your data, email us.')}

${h2('Children')}
${p('Tilted is a simulated-gambling game rated for adults and is not directed to children under 17. We do not knowingly collect information from children.')}

${h2('Changes')}
${p('If this policy changes, the date at the top changes and the new version appears at this address.')}
`;
