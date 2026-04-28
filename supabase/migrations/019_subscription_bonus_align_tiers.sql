    -- Selaras `web/lib/tiers.ts` bonusCreditsOnSubscription (Starter 12, Creator 30, Pro 52).

    create or replace function public.admin_review_subscription(
      p_request_id uuid,
      p_approve boolean,
      p_admin_note text default null
    )
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      adm boolean;
      r record;
      new_quota int;
      new_expires timestamptz;
      current_expires timestamptz;
      bonus int := 0;
    begin
      select exists(
        select 1 from public.profiles pr
        where pr.user_id = auth.uid() and coalesce(pr.is_admin, false)
      ) into adm;

      if not adm then raise exception 'FORBIDDEN'; end if;

      select * into r from public.subscription_requests where id = p_request_id for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;

      if p_approve then
        new_quota := case r.requested_tier
          when 'starter' then 30
          when 'creator' then 90
          when 'pro' then 250
          else 0
        end;

        bonus := case r.requested_tier
          when 'starter' then 12
          when 'creator' then 30
          when 'pro' then 52
          else 0
        end;

        select pr.plan_expires_at into current_expires
          from public.profiles pr where pr.user_id = r.user_id;
        if current_expires is not null and current_expires > now() then
          new_expires := current_expires + (r.months || ' months')::interval;
        else
          new_expires := now() + (r.months || ' months')::interval;
        end if;

        update public.profiles pr
        set tier = r.requested_tier,
            plan_expires_at = new_expires,
            monthly_quota = new_quota,
            monthly_used = 0,
            monthly_reset_at = now(),
            credits_balance = pr.credits_balance + bonus,
            updated_at = now()
        where pr.user_id = r.user_id;

        if bonus > 0 then
          insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
          values (
            r.user_id,
            bonus,
            (select pr3.credits_balance from public.profiles pr3 where pr3.user_id = r.user_id),
            'subscription_bonus',
            'subscription_request',
            p_request_id
          );
        end if;

        update public.subscription_requests
        set status = 'approved',
            admin_note = p_admin_note,
            reviewed_at = now(),
            updated_at = now()
        where id = p_request_id;
      else
        update public.subscription_requests
        set status = 'rejected',
            admin_note = p_admin_note,
            reviewed_at = now(),
            updated_at = now()
        where id = p_request_id;
      end if;
    end;
    $$;

    revoke all on function public.admin_review_subscription(uuid, boolean, text) from public;
    grant execute on function public.admin_review_subscription(uuid, boolean, text) to authenticated;
