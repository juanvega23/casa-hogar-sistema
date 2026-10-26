-- ============================================================
-- CASA HOGAR
-- MIGRACIÓN 006
-- RELACIONES DE PRODUCTOS CON CATÁLOGOS
-- ============================================================


-- ============================================================
-- 1. MIGRAR UNIDADES DE MEDIDA EXISTENTES AL NUEVO CATÁLOGO
-- ============================================================

insert into public.unidades_medida (
  nombre
)
select distinct
  trim(unidad_medida)
from public.productos
where unidad_medida is not null
  and trim(unidad_medida) <> ''
on conflict (nombre) do nothing;


-- ============================================================
-- 2. AGREGAR RELACIONES A PRODUCTOS
-- ============================================================

alter table public.productos
add column if not exists marca_id bigint;

alter table public.productos
add column if not exists modelo_id bigint;

alter table public.productos
add column if not exists color_id bigint;

alter table public.productos
add column if not exists material_id bigint;

alter table public.productos
add column if not exists unidad_medida_id bigint;


-- ============================================================
-- 3. LLAVES FORÁNEAS
-- ============================================================

alter table public.productos
drop constraint if exists productos_marca_id_fkey;

alter table public.productos
add constraint productos_marca_id_fkey
foreign key (marca_id)
references public.marcas(id)
on delete set null;


alter table public.productos
drop constraint if exists productos_modelo_id_fkey;

alter table public.productos
add constraint productos_modelo_id_fkey
foreign key (modelo_id)
references public.modelos(id)
on delete set null;


alter table public.productos
drop constraint if exists productos_color_id_fkey;

alter table public.productos
add constraint productos_color_id_fkey
foreign key (color_id)
references public.colores(id)
on delete set null;


alter table public.productos
drop constraint if exists productos_material_id_fkey;

alter table public.productos
add constraint productos_material_id_fkey
foreign key (material_id)
references public.materiales(id)
on delete set null;


alter table public.productos
drop constraint if exists productos_unidad_medida_id_fkey;

alter table public.productos
add constraint productos_unidad_medida_id_fkey
foreign key (unidad_medida_id)
references public.unidades_medida(id)
on delete set null;


-- ============================================================
-- 4. RELACIONAR LAS UNIDADES EXISTENTES
-- ============================================================

update public.productos p
set unidad_medida_id = um.id
from public.unidades_medida um
where lower(trim(um.nombre))
    = lower(trim(p.unidad_medida))
  and p.unidad_medida is not null;


-- ============================================================
-- 5. ÍNDICES
-- ============================================================

create index if not exists idx_productos_marca_id
on public.productos(marca_id);

create index if not exists idx_productos_modelo_id
on public.productos(modelo_id);

create index if not exists idx_productos_color_id
on public.productos(color_id);

create index if not exists idx_productos_material_id
on public.productos(material_id);

create index if not exists idx_productos_unidad_medida_id
on public.productos(unidad_medida_id);