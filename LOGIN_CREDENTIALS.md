# Local SIH demo credentials

These credentials work only when `DEMO_AUTH_ENABLED=true`.
They are not production credentials.

| Workspace | Username | Password |
|---|---|---|
| Welfare Officer | welfare.officer@sentinel.local | Sentinel@123 |
| Commander | commander@sentinel.local | Sentinel@123 |
| Personnel | personnel@sentinel.local | Sentinel@123 |

Before any public deployment:

- set `DEMO_AUTH_ENABLED=false`;
- set `VITE_DEMO_AUTH=false`;
- create real Supabase Auth users;
- assign each user a row in `public.user_roles`.
