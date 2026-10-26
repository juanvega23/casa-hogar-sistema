-- ============================================================
-- CASA HOGAR
-- MIGRACIÓN 013
-- SEGURIDAD Y LECTURA DE RECEPCIONES DE COMPRA
-- ============================================================

alter table public.recepciones_compra
enable row level security;

alter table public.detalle_recepciones_compra
enable row level security;


-- ============================================================
-- PERMISOS BASE
-- ============================================================

grant select
on public.recepciones_compra
to authenticated;

grant select
on public.detalle_recepciones_compra
to authenticated;


-- ============================================================
-- POLÍTICAS DE LECTURA
-- ============================================================

drop policy if exists
"recepciones_compra_select"
on public.recepciones_compra;

create policy
"recepciones_compra_select"
on public.recepciones_compra
for select
to authenticated
using (
  public.current_role_code() in (
    'almacen',
    'administracion',
    'gerencia'
  )
);


drop policy if exists
"detalle_recepciones_compra_select"
on public.detalle_recepciones_compra;

create policy
"detalle_recepciones_compra_select"
on public.detalle_recepciones_compra
for select
to authenticated
using (
  public.current_role_code() in (
    'almacen',
    'administracion',
    'gerencia'
  )
);