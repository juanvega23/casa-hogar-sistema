-- ============================================================
-- CASA HOGAR
-- MIGRACIÓN 007
-- SEGURIDAD RLS PARA CATÁLOGOS DE PRODUCTOS
-- ============================================================


-- ============================================================
-- 1. HABILITAR RLS
-- ============================================================

alter table public.marcas enable row level security;
alter table public.modelos enable row level security;
alter table public.colores enable row level security;
alter table public.materiales enable row level security;
alter table public.unidades_medida enable row level security;


-- ============================================================
-- 2. MARCAS
-- ============================================================

drop policy if exists marcas_select_roles_autorizados
on public.marcas;

create policy marcas_select_roles_autorizados
on public.marcas
for select
to authenticated
using (
  public.current_role_code() in (
    'gerencia',
    'administracion',
    'ventas',
    'almacen'
  )
);


drop policy if exists marcas_insert_administracion_almacen
on public.marcas;

create policy marcas_insert_administracion_almacen
on public.marcas
for insert
to authenticated
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


drop policy if exists marcas_update_administracion_almacen
on public.marcas;

create policy marcas_update_administracion_almacen
on public.marcas
for update
to authenticated
using (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
)
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


-- ============================================================
-- 3. MODELOS
-- ============================================================

drop policy if exists modelos_select_roles_autorizados
on public.modelos;

create policy modelos_select_roles_autorizados
on public.modelos
for select
to authenticated
using (
  public.current_role_code() in (
    'gerencia',
    'administracion',
    'ventas',
    'almacen'
  )
);


drop policy if exists modelos_insert_administracion_almacen
on public.modelos;

create policy modelos_insert_administracion_almacen
on public.modelos
for insert
to authenticated
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


drop policy if exists modelos_update_administracion_almacen
on public.modelos;

create policy modelos_update_administracion_almacen
on public.modelos
for update
to authenticated
using (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
)
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


-- ============================================================
-- 4. COLORES
-- ============================================================

drop policy if exists colores_select_roles_autorizados
on public.colores;

create policy colores_select_roles_autorizados
on public.colores
for select
to authenticated
using (
  public.current_role_code() in (
    'gerencia',
    'administracion',
    'ventas',
    'almacen'
  )
);


drop policy if exists colores_insert_administracion_almacen
on public.colores;

create policy colores_insert_administracion_almacen
on public.colores
for insert
to authenticated
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


drop policy if exists colores_update_administracion_almacen
on public.colores;

create policy colores_update_administracion_almacen
on public.colores
for update
to authenticated
using (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
)
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


-- ============================================================
-- 5. MATERIALES
-- ============================================================

drop policy if exists materiales_select_roles_autorizados
on public.materiales;

create policy materiales_select_roles_autorizados
on public.materiales
for select
to authenticated
using (
  public.current_role_code() in (
    'gerencia',
    'administracion',
    'ventas',
    'almacen'
  )
);


drop policy if exists materiales_insert_administracion_almacen
on public.materiales;

create policy materiales_insert_administracion_almacen
on public.materiales
for insert
to authenticated
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


drop policy if exists materiales_update_administracion_almacen
on public.materiales;

create policy materiales_update_administracion_almacen
on public.materiales
for update
to authenticated
using (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
)
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


-- ============================================================
-- 6. UNIDADES DE MEDIDA
-- ============================================================

drop policy if exists unidades_medida_select_roles_autorizados
on public.unidades_medida;

create policy unidades_medida_select_roles_autorizados
on public.unidades_medida
for select
to authenticated
using (
  public.current_role_code() in (
    'gerencia',
    'administracion',
    'ventas',
    'almacen'
  )
);


drop policy if exists unidades_medida_insert_administracion_almacen
on public.unidades_medida;

create policy unidades_medida_insert_administracion_almacen
on public.unidades_medida
for insert
to authenticated
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


drop policy if exists unidades_medida_update_administracion_almacen
on public.unidades_medida;

create policy unidades_medida_update_administracion_almacen
on public.unidades_medida
for update
to authenticated
using (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
)
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);


-- ============================================================
-- 7. PERMISOS DE TABLA
-- ============================================================

grant select, insert, update
on public.marcas
to authenticated;

grant select, insert, update
on public.modelos
to authenticated;

grant select, insert, update
on public.colores
to authenticated;

grant select, insert, update
on public.materiales
to authenticated;

grant select, insert, update
on public.unidades_medida
to authenticated;