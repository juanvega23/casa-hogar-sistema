-- ============================================================
-- CASA HOGAR
-- MIGRACIÓN 008
-- TIPO DE COMPRA
-- ============================================================

alter table public.compras
add column if not exists tipo_compra text
not null
default 'directa';

alter table public.compras
drop constraint if exists compras_tipo_compra_check;

alter table public.compras
add constraint compras_tipo_compra_check
check (
  tipo_compra in (
    'directa',
    'cotizacion',
    'licitacion'
  )
);