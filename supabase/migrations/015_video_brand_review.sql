-- Stopped private Drive videos are held for an explicit brand decision.
-- Only the service role can transition review jobs back into the worker queue.
alter table public.google_drive_video_jobs
  drop constraint if exists google_drive_video_jobs_status_check;

alter table public.google_drive_video_jobs
  add constraint google_drive_video_jobs_status_check
  check (status in ('queued', 'processing', 'publishing', 'completed', 'partial', 'failed', 'review', 'stopped'));

create index if not exists google_drive_video_jobs_review_idx
  on public.google_drive_video_jobs (owner_user_id, updated_at desc)
  where status = 'review';
