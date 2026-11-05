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

/*
 * Goods in the building.
 *
 * Nothing is allocated when an order is taken — everything is bought in for
 * the order it is sold on — so a test whose subject is further down the line
 * (splitting an invoice, packing, shipping) has to say that the goods are
 * here before it can get there. These say it the way the order screen does.
 */
create or replace function allocate_line(p_order text, p_sku text, p_qty integer)
returns void language plpgsql as $$
begin
  perform set_line_allocation(
    (select ol.id from order_lines ol join orders o on o.id = ol.order_id
      where o.number = p_order and ol.sku = p_sku), p_qty);
end $$;

create or replace function allocate_order_id(p_order uuid) returns void
language plpgsql as $$
declare r record;
begin
  for r in select ol.id, ol.qty from order_lines ol
            where ol.order_id = p_order and ol.product_id is not null loop
    perform set_line_allocation(r.id, r.qty);
  end loop;
end $$;

create or replace function allocate_order(p_order text) returns void
language plpgsql as $$
begin
  perform allocate_order_id((select id from orders where number = p_order));
end $$;
