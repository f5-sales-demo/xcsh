Salesforce onboarding wizard via sf CLI. Check installation, detect authentication, guide login, extract user profile.

<instruction>
Actions: "check" (verify sf installed), "status" (auth + default org + profile), "login" (detect auth and prompt user with login command), "list_orgs" (show all orgs), "set_default" (switch default org), "profile" (extract and cache user profile via SOQL).

When the user first asks about Salesforce, pipeline, cases, or accounts and no org is authenticated, run this sequence:

1. check — verify sf CLI is installed
2. status — check for authenticated orgs
3. If not authenticated, use login — show the user the exact command to run:
   - Workstation: sf org login web --set-default --alias SFDC
   - Container: echo "$SFDX_AUTH_URL" | sf org login sfdx-url --sfdx-url-stdin=- --set-default --alias f5
4. After auth confirmed, use profile — extract user data and cache it

The login action does NOT execute authentication. It detects state and tells the user what command to run.
The profile action runs a SOQL query against the User object and caches results as xcsh.user.* keys in ~/.sf/config.json.
</instruction>
