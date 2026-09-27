-- Normalization runs are snapshots: once computed, a run and its per-project and per-judge
-- rows never change. A new computation is a new run; publishing only moves a pointer on Event.
-- (Hand-written; Prisma can't express triggers.)
CREATE FUNCTION results_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is an immutable snapshot (% blocked); compute a new run instead', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER normalization_run_immutable BEFORE UPDATE OR DELETE ON "NormalizationRun" FOR EACH ROW EXECUTE FUNCTION results_immutable();
CREATE TRIGGER project_result_immutable BEFORE UPDATE OR DELETE ON "ProjectResult" FOR EACH ROW EXECUTE FUNCTION results_immutable();
CREATE TRIGGER judge_stat_immutable BEFORE UPDATE OR DELETE ON "JudgeStat" FOR EACH ROW EXECUTE FUNCTION results_immutable();
