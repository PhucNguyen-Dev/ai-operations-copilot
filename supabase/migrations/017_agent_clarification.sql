do $$ begin alter type agent_run_status add value if not exists 'clarification_required'; exception when duplicate_object then null; end $$;
