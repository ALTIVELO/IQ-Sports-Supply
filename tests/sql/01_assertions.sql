-- Test helpers. assert_fails() distinguishes "the call was correctly refused"
-- from "the call succeeded", which a bare exception handler cannot do.
create or replace function assert_fails(sql text, label text) returns void
language plpgsql as $$
declare refused boolean := false; msg text;
begin
  begin
    execute sql;
  exception when others then
    refused := true; msg := sqlerrm;
  end;
  if refused then
    raise notice 'PASS  % — refused: %', label, msg;
  else
    raise exception 'FAIL  % — the call succeeded when it should have been refused', label;
  end if;
end $$;

create or replace function assert_eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is not distinct from expected then
    raise notice 'PASS  % (%)', label, actual;
  else
    raise exception 'FAIL  % — expected %, got %', label, expected, actual;
  end if;
end $$;
