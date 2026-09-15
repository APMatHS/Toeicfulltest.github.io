-- V1.12d: remove direct anonymous access to administrative SECURITY DEFINER RPCs.
revoke all on function public.sync_profile_class_from_membership() from public,anon,authenticated;
revoke all on function public.staff_archive_test(uuid) from public,anon;
grant execute on function public.staff_archive_test(uuid) to authenticated;
revoke all on function public.staff_clone_test(uuid,jsonb) from public,anon;
grant execute on function public.staff_clone_test(uuid,jsonb) to authenticated;
revoke all on function public.staff_delete_test(uuid) from public,anon;
grant execute on function public.staff_delete_test(uuid) to authenticated;
revoke all on function public.staff_reset_attempt(uuid) from public,anon;
grant execute on function public.staff_reset_attempt(uuid) to authenticated;
revoke all on function public.update_own_profile(text) from public,anon;
grant execute on function public.update_own_profile(text) to authenticated;
