-- After creating a Supabase Auth user, run this in the Supabase SQL editor.
-- Replace the UUID and display name.
insert into public.user_roles (user_id, role, display_name)
values ('00000000-0000-0000-0000-000000000000', 'officer', 'Welfare Officer')
on conflict (user_id) do update
set role = excluded.role,
    display_name = excluded.display_name,
    active = true,
    updated_at = now();

-- Allowed values: officer, commander, personnel
