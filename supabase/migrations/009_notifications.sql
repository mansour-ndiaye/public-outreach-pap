-- 009_notifications.sql
-- Notification system for managers/admins when supervisors submit EOD reports

CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_id    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  type         text        NOT NULL DEFAULT 'eod_submitted',
  title        text        NOT NULL DEFAULT '',
  message      text        NOT NULL DEFAULT '',
  metadata     jsonb       NOT NULL DEFAULT '{}',
  read         boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast per-user notification queries (most recent first)
CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications(recipient_id, created_at DESC);

-- Partial index for unread count queries
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications(recipient_id)
  WHERE read = false;

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "Users can view own notifications"
  ON public.notifications
  FOR SELECT
  USING (recipient_id = auth.uid());

-- Any authenticated user can insert (supervisors notify managers/admins on EOD submit)
CREATE POLICY "Authenticated users can insert notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Users can mark their own notifications as read
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- Enable realtime for live notification delivery
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
