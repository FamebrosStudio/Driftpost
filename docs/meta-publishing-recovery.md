# Recover Facebook and Instagram publishing access

Use this when a publish job says the Facebook profile must be a Page administrator, editor, or moderator, requires two-factor authentication, or lacks Page permissions. These errors come from Meta. A saved connection can still appear in Driftpost after its Page access changes.

1. In Meta Business Settings, check the **person who connected the account**. Give that Facebook profile access to each affected Page with the **Create content** task. A moderator-only assignment does not grant publishing. If the business requires two-factor authentication, enable it on that same Facebook profile and complete any security prompts. See Meta's [Page publishing requirements](https://developers.facebook.com/docs/graph-api/reference/page/feed/) and [Page task definitions](https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/pages/).
2. In Meta Developers, verify the Driftpost app has the permissions required for the people connecting: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. For public users, check Advanced Access/App Review. For Instagram's Login for Business configuration (`META_CONFIG_ID`), include the Page and Instagram permissions needed for the linked account. Changing the app configuration does not update saved tokens.
3. In Driftpost **Accounts**, reconnect **Facebook** and then **Instagram** for the affected Page/account. Approve access to the correct Pages and Instagram accounts in both Meta dialogs. These are separate connections with separate saved Page tokens.
4. Create one small test post to each affected destination. After both succeed, reschedule the failed posts from the screenshot. A failed job does not resume automatically.

Do not paste Page tokens, app secrets, or login codes into a support ticket. If the test still fails, record the exact new Meta error and which destination failed.
