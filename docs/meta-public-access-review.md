# Meta public access ? remaining requirements

Checked 2026-11-10 in the existing owner Chrome session.

## Verified
- Drift Post app 1943691209643572 is published.
- Fame Bros business 1535169256935206 is verified.
- Railway HTTPS OAuth callback is in Valid OAuth redirect URIs; Client OAuth and Web OAuth are enabled.
- Instagram inbound DM, public comment reply and comment-triggered private reply were confirmed by the owner using live events.
- Facebook Page automation code and platform selector are deployed; live Facebook delivery remains to be verified.
- Facebook Business Login configuration: 1121175107503577. Instagram configuration: 2011692929787113.

## Public onboarding remains unverified
Meta shows the permissions as Ready for testing and App Review as Not submitted. The review submission button is disabled until the required sections are complete. Other users reported Feature unavailable. No code change grants Advanced Access or bypasses Meta review.

## Required owner answers ? not supplied
- Confirm the prefilled controller identity: Famebros Studio (sole proprietorship), India.
- Confirm whether Meta user data has been disclosed in response to national-security requests in the past 12 months.
- Identify actual public-authority-request policies: legality review, challenging unlawful requests, minimum disclosure, documentation, or none.
- Review the processor list against actual data flows; prefilled entries included Railway, Supabase and OpenAI. Vercel also hosts the frontend and must be assessed by the owner.

Do not assume answers or attest to policies solely from implementation.

## Reviewer walkthrough to record truthfully
1. Open https://driftpostpage.vercel.app and sign in through Google.
2. Open Accounts and connect the relevant Facebook Page or Instagram professional account through the matching Business Login flow.
3. Show Page/account discovery and the selected account in Driftpost.
4. Demonstrate publishing only for permissions being requested for publishing.
5. In Auto DM select platform/account, save an actual rule, and show a fresh customer comment/message with the actual reply.
6. Show disconnect/data-deletion controls.

Record real actions, provide reviewer access through an owner-approved account, and submit only after all evidence and owner answers are complete. A developer/administrator test does not prove public onboarding works.
