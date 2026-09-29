-- Run with the Supabase test harness after applying the migration.
-- These assertions document the intended boundaries; role/user fixtures should be
-- created by the deployment team because auth.users UUIDs are environment-specific.

begin;

select has_table_privilege('anon', 'public.welfare_cases', 'select') = false as anon_cannot_read_welfare_cases;
select has_table_privilege('anon', 'public.audit_events', 'select') = false as anon_cannot_read_audit;
select has_table_privilege('authenticated', 'public.secure_records', 'select') = false as browser_cannot_read_secure_records;
select has_table_privilege('authenticated', 'public.welfare_cases', 'update') = true as authenticated_has_case_update_grant;
select has_table_privilege('authenticated', 'public.consents', 'update') = true as authenticated_has_consent_update_grant;

rollback;
