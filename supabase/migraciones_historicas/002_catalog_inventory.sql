-- ============================================================
-- CASA HOGAR SISTEMA
-- MIGRACIÓN 002
-- CATÁLOGO E INVENTARIO
-- ============================================================

-- ============================================================
-- 1. FUNCIÓN PARA OBTENER EL ROL DEL USUARIO ACTUAL
-- ============================================================

create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.codigo
  from public.profiles p
  join public.roles r
    on r.id = p.role_id
  where p.id = auth.uid()
    and p.activo = true
  limit 1;
$$;

grant execute
on function public.current_role_code()
to authenticated;


-- ============================================================
-- 2. FUNCIÓN GENERAL PARA UPDATED_AT
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- 3. TABLA DE CATEGORÍAS
-- ============================================================

create table public.categorias (
  id bigint generated always as identity primary key,

  nombre text not null,
  descripcion text,

  activo boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint categorias_nombre_no_vacio
    check (length(trim(nombre)) > 0)
);

create unique index categorias_nombre_unique_idx
on public.categorias (lower(nombre));

create index categorias_activo_idx
on public.categorias (activo);

create trigger categorias_set_updated_at
before update on public.categorias
for each row
execute function public.set_updated_at();


-- ============================================================
-- 4. TABLA DE PRODUCTOS
-- ============================================================

create table public.productos (
  id bigint generated always as identity primary key,

  codigo text not null,
  codigo_barras text,

  nombre text not null,
  descripcion text,

  categoria_id bigint
    references public.categorias(id)
    on delete restrict,

  unidad_medida text not null default 'unidad',

  precio_compra numeric(12,2) not null default 0,
  precio_venta numeric(12,2) not null default 0,

  stock_minimo numeric(12,2) not null default 0,

  activo boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint productos_codigo_no_vacio
    check (length(trim(codigo)) > 0),

  constraint productos_nombre_no_vacio
    check (length(trim(nombre)) > 0),

  constraint productos_precio_compra_valido
    check (precio_compra >= 0),

  constraint productos_precio_venta_valido
    check (precio_venta >= 0),

  constraint productos_stock_minimo_valido
    check (stock_minimo >= 0)
);

create unique index productos_codigo_unique_idx
on public.productos (lower(codigo));

create unique index productos_codigo_barras_unique_idx
on public.productos (codigo_barras)
where codigo_barras is not null;

create index productos_nombre_idx
on public.productos (nombre);

create index productos_categoria_idx
on public.productos (categoria_id);

create index productos_activo_idx
on public.productos (activo);

create trigger productos_set_updated_at
before update on public.productos
for each row
execute function public.set_updated_at();


-- ============================================================
-- 5. TABLA DE EXISTENCIAS
-- Una fila por producto.
-- Guarda la existencia actual.
-- ============================================================

create table public.existencias (
  producto_id bigint primary key
    references public.productos(id)
    on delete cascade,

  cantidad numeric(12,2) not null default 0,

  updated_at timestamptz not null default now(),

  constraint existencias_cantidad_valida
    check (cantidad >= 0)
);

create index existencias_cantidad_idx
on public.existencias (cantidad);

create trigger existencias_set_updated_at
before update on public.existencias
for each row
execute function public.set_updated_at();


-- ============================================================
-- 6. CREAR EXISTENCIA AUTOMÁTICAMENTE
-- AL CREAR UN PRODUCTO
-- ============================================================

create or replace function public.crear_existencia_producto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.existencias (
    producto_id,
    cantidad
  )
  values (
    new.id,
    0
  )
  on conflict (producto_id) do nothing;

  return new;
end;
$$;

create trigger productos_crear_existencia
after insert on public.productos
for each row
execute function public.crear_existencia_producto();


-- ============================================================
-- 7. TABLA DE MOVIMIENTOS DE INVENTARIO
-- ============================================================

create table public.movimientos_inventario (
  id bigint generated always as identity primary key,

  producto_id bigint not null
    references public.productos(id)
    on delete restrict,

  tipo text not null,

  cantidad numeric(12,2) not null,

  cantidad_anterior numeric(12,2) not null,
  cantidad_nueva numeric(12,2) not null,

  motivo text,
  referencia text,

  creado_por uuid
    references auth.users(id)
    on delete set null,

  created_at timestamptz not null default now(),

  constraint movimientos_tipo_valido
    check (
      tipo in (
        'entrada',
        'salida',
        'ajuste_positivo',
        'ajuste_negativo'
      )
    ),

  constraint movimientos_cantidad_valida
    check (cantidad > 0),

  constraint movimientos_cantidad_anterior_valida
    check (cantidad_anterior >= 0),

  constraint movimientos_cantidad_nueva_valida
    check (cantidad_nueva >= 0)
);

create index movimientos_producto_idx
on public.movimientos_inventario (producto_id);

create index movimientos_tipo_idx
on public.movimientos_inventario (tipo);

create index movimientos_fecha_idx
on public.movimientos_inventario (created_at desc);

create index movimientos_usuario_idx
on public.movimientos_inventario (creado_por);


-- ============================================================
-- 8. FUNCIÓN SEGURA PARA REGISTRAR MOVIMIENTOS
--
-- Esta función:
-- 1. Verifica el rol.
-- 2. Bloquea temporalmente la existencia del producto.
-- 3. Calcula la nueva cantidad.
-- 4. Evita inventario negativo.
-- 5. Actualiza existencias.
-- 6. Registra el movimiento.
--
-- La aplicación NO debe modificar existencias directamente.
-- ============================================================

create or replace function public.registrar_movimiento_inventario(
  p_producto_id bigint,
  p_tipo text,
  p_cantidad numeric,
  p_motivo text default null,
  p_referencia text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
  v_existencia_actual numeric(12,2);
  v_existencia_nueva numeric(12,2);
  v_movimiento_id bigint;
begin

  -- ----------------------------------------------------------
  -- Obtener rol actual
  -- ----------------------------------------------------------

  v_rol := public.current_role_code();

  if v_rol is null then
    raise exception
      'Usuario sin rol válido o usuario inactivo.';
  end if;


  -- ----------------------------------------------------------
  -- Solamente Administración y Almacén pueden realizar
  -- movimientos manuales de inventario en este segmento.
  -- ----------------------------------------------------------

  if v_rol not in (
    'administracion',
    'almacen'
  ) then
    raise exception
      'No tiene autorización para registrar movimientos de inventario.';
  end if;


  -- ----------------------------------------------------------
  -- Validaciones
  -- ----------------------------------------------------------

  if p_tipo not in (
    'entrada',
    'salida',
    'ajuste_positivo',
    'ajuste_negativo'
  ) then
    raise exception
      'Tipo de movimiento no válido.';
  end if;

  if p_cantidad is null
     or p_cantidad <= 0 then
    raise exception
      'La cantidad debe ser mayor que cero.';
  end if;


  -- ----------------------------------------------------------
  -- Verificar producto
  -- ----------------------------------------------------------

  if not exists (
    select 1
    from public.productos
    where id = p_producto_id
      and activo = true
  ) then
    raise exception
      'El producto no existe o está inactivo.';
  end if;


  -- ----------------------------------------------------------
  -- Asegurar existencia del producto
  -- ----------------------------------------------------------

  insert into public.existencias (
    producto_id,
    cantidad
  )
  values (
    p_producto_id,
    0
  )
  on conflict (producto_id) do nothing;


  -- ----------------------------------------------------------
  -- Bloquear fila mientras se realiza el movimiento
  -- ----------------------------------------------------------

  select cantidad
  into v_existencia_actual
  from public.existencias
  where producto_id = p_producto_id
  for update;


  -- ----------------------------------------------------------
  -- Calcular nueva existencia
  -- ----------------------------------------------------------

  case p_tipo

    when 'entrada' then
      v_existencia_nueva :=
        v_existencia_actual + p_cantidad;

    when 'ajuste_positivo' then
      v_existencia_nueva :=
        v_existencia_actual + p_cantidad;

    when 'salida' then
      v_existencia_nueva :=
        v_existencia_actual - p_cantidad;

    when 'ajuste_negativo' then
      v_existencia_nueva :=
        v_existencia_actual - p_cantidad;

  end case;


  -- ----------------------------------------------------------
  -- Nunca permitir inventario negativo
  -- ----------------------------------------------------------

  if v_existencia_nueva < 0 then
    raise exception
      'Existencia insuficiente. Disponible: %, solicitado: %.',
      v_existencia_actual,
      p_cantidad;
  end if;


  -- ----------------------------------------------------------
  -- Actualizar existencia
  -- ----------------------------------------------------------

  update public.existencias
  set cantidad = v_existencia_nueva
  where producto_id = p_producto_id;


  -- ----------------------------------------------------------
  -- Registrar historial
  -- ----------------------------------------------------------

  insert into public.movimientos_inventario (
    producto_id,
    tipo,
    cantidad,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    referencia,
    creado_por
  )
  values (
    p_producto_id,
    p_tipo,
    p_cantidad,
    v_existencia_actual,
    v_existencia_nueva,
    nullif(trim(p_motivo), ''),
    nullif(trim(p_referencia), ''),
    auth.uid()
  )
  returning id
  into v_movimiento_id;


  return v_movimiento_id;

end;
$$;

grant execute
on function public.registrar_movimiento_inventario(
  bigint,
  text,
  numeric,
  text,
  text
)
to authenticated;


-- ============================================================
-- 9. ACTIVAR ROW LEVEL SECURITY
-- ============================================================

alter table public.categorias
enable row level security;

alter table public.productos
enable row level security;

alter table public.existencias
enable row level security;

alter table public.movimientos_inventario
enable row level security;


-- ============================================================
-- 10. RLS - CATEGORÍAS
-- ============================================================

create policy "categorias_select_roles_autorizados"
on public.categorias
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

create policy "categorias_insert_administracion_almacen"
on public.categorias
for insert
to authenticated
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);

create policy "categorias_update_administracion_almacen"
on public.categorias
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
-- 11. RLS - PRODUCTOS
-- ============================================================

create policy "productos_select_roles_autorizados"
on public.productos
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

create policy "productos_insert_administracion_almacen"
on public.productos
for insert
to authenticated
with check (
  public.current_role_code() in (
    'administracion',
    'almacen'
  )
);

create policy "productos_update_administracion_almacen"
on public.productos
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
-- 12. RLS - EXISTENCIAS
--
-- No se habilitan INSERT / UPDATE / DELETE directos.
-- El inventario debe modificarse utilizando
-- registrar_movimiento_inventario().
-- ============================================================

create policy "existencias_select_roles_autorizados"
on public.existencias
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


-- ============================================================
-- 13. RLS - MOVIMIENTOS
--
-- Los movimientos se insertan únicamente por medio
-- de registrar_movimiento_inventario().
-- ============================================================

create policy "movimientos_select_roles_autorizados"
on public.movimientos_inventario
for select
to authenticated
using (
  public.current_role_code() in (
    'gerencia',
    'administracion',
    'almacen'
  )
);


-- ============================================================
-- 14. PERMISOS BÁSICOS
-- ============================================================

grant select
on public.categorias
to authenticated;

grant select
on public.productos
to authenticated;

grant select
on public.existencias
to authenticated;

grant select
on public.movimientos_inventario
to authenticated;

grant insert, update
on public.categorias
to authenticated;

grant insert, update
on public.productos
to authenticated;


-- ============================================================
-- FIN MIGRACIÓN 002
-- ============================================================