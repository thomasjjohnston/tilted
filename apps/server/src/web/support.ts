import { SUPPORT_EMAIL } from './contact.js';

export const SUPPORT_HTML = `
<h1>Tilted support</h1>
<p style="text-align:left">Tilted is heads-up Texas Hold'em between friends: ten hands at once, one shared stack of play chips. No real money, no prizes.</p>

<h2 style="font-family:Georgia,serif;font-weight:400;font-size:1.3rem;margin-top:2rem">How to play</h2>
<ol>
  <li><strong>Start a match</strong> by inviting a friend (send them your link), rematching someone you've played, or playing Untilted, the house bot.</li>
  <li><strong>Each round deals ten hands</strong> between you and your opponent. You both start the match with 2,000 chips.</li>
  <li><strong>Every chip you put in any hand comes out of the same stack.</strong> Bet big on one hand and you have less for the other nine.</li>
  <li><strong>Take your turn in all ten hands</strong>, then it's your opponent's turn. You'll get a notification when it's yours again.</li>
  <li><strong>The match ends</strong> when one player runs out of chips.</li>
</ol>

<h2 style="font-family:Georgia,serif;font-weight:400;font-size:1.3rem;margin-top:2rem">Common questions</h2>
<p style="text-align:left"><strong>My friend didn't get my invite.</strong> Invites work once and expire after 7 days. Send a fresh one from <em>New game → Invite a friend</em>. If they don't have the app yet, the link shows them how to install it; after installing, they tap the link again or type the code.</p>
<p style="text-align:left"><strong>My opponent isn't taking their turn.</strong> Tap <em>Ping</em> on the match to nudge them. There's no time limit at the moment.</p>
<p style="text-align:left"><strong>How do I stop someone playing me?</strong> Press and hold their match on Home, or swipe them in the New game list, and choose <em>Block</em>. Any match between you ends with no winner. Unblock from <em>Settings → Blocked players</em>.</p>
<p style="text-align:left"><strong>How do I delete my account?</strong> <em>Settings → Delete Account</em>. This removes your name, email, sign-in and pinned hands immediately. Hands you played stay in your opponents' history under "Deleted Player".</p>

<h2 style="font-family:Georgia,serif;font-weight:400;font-size:1.3rem;margin-top:2rem">Contact</h2>
<p>Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Tilted is made by one person, so replies can take a few days.</p>
<p><small><a href="/privacy">Privacy policy</a></small></p>
`;
