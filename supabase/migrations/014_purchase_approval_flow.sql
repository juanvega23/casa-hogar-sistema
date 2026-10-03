-- ============================================================
-- CASA HOGAR
-- MIGRACIÓN 014
-- FLUJO DE AUTORIZACIÓN DE COMPRAS
-- ============================================================


-- ============================================================
-- 1. AMPLIAR ESTADOS DE COMPRA
-- ============================================================

alter table public.compras
drop constraint if exists compras_estado_check;

alter table public.compras
add constraint compras_estado_check
check (
  estado in (
    'registrada',
    'autorizada',
    'recibida',
    'anulada'
  )
);


-- ============================================================
-- 2. DATOS DE AUTORIZACIÓN
-- ============================================================

alter table public.compras
add column if not exists autorizada_por uuid
references auth.users(id)
on delete set null;

alter table public.compras
add column if not exists autorizada_at timestamptz;


-- ============================================================
-- 3. MARCAR COMO RECIBIDAS LAS COMPRAS QUE YA TIENEN RECEPCIÓN
-- ============================================================

update public.compras c
set estado = 'recibida'
where c.estado = 'registrada'
  and exists (
    select 1
    from public.recepciones_compra rc
    where rc.compra_id = c.id
  );


-- ============================================================
-- 4. FUNCIÓN PARA AUTORIZAR COMPRA
-- ============================================================

create or replace function public.autorizar_compra(
  p_compra_id bigint
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_rol text;
  v_compra record;
begin

  -- ----------------------------------------------------------
  -- VALIDAR ROL
  -- ----------------------------------------------------------
  -- Permisos provisionales mientras se define la matriz final
  -- de actores y responsabilidades.

  v_rol := public.current_role_code();

  if coalesce(v_rol, '') not in (
    'administracion',
    'gerencia'
  ) then
    raise exception
      'No tiene permisos para autorizar compras.';
  end if;


  -- ----------------------------------------------------------
  -- OBTENER COMPRA
  -- ----------------------------------------------------------

  select
    c.id,
    c.numero,
    c.estado
  into v_compra
  from public.compras c
  where c.id = p_compra_id
  for update;


  if not found then
    raise exception
      'La compra indicada no existe.';
  end if;


  -- ----------------------------------------------------------
  -- VALIDAR ESTADO
  -- ----------------------------------------------------------

  if v_compra.estado = 'anulada' then
    raise exception
      'La compra % se encuentra anulada.',
      v_compra.numero;
  end if;


  if v_compra.estado = 'recibida' then
    raise exception
      'La compra % ya fue recibida.',
      v_compra.numero;
  end if;


  if v_compra.estado = 'autorizada' then
    raise exception
      'La compra % ya se encuentra autorizada.',
      v_compra.numero;
  end if;


  if v_compra.estado <> 'registrada' then
    raise exception
      'La compra % no puede autorizarse desde su estado actual.',
      v_compra.numero;
  end if;


  -- ----------------------------------------------------------
  -- AUTORIZAR
  -- ----------------------------------------------------------

  update public.compras
  set
    estado = 'autorizada',
    autorizada_por = auth.uid(),
    autorizada_at = now()
  where id = p_compra_id;

end;
$function$;


revoke all
on function public.autorizar_compra(bigint)
from public;

grant execute
on function public.autorizar_compra(bigint)
to authenticated;


-- ============================================================
-- 5. ACTUALIZAR RECEPCIÓN
-- ============================================================
-- Solo pueden recibirse compras previamente autorizadas.
-- Al confirmar recepción, la compra pasa a "recibida".

create or replace function public.registrar_recepcion_compra(
  p_compra_id bigint,
  p_items jsonb,
  p_fecha_recepcion date default current_date,
  p_observaciones text default null
)
returns table(
  recepcion_id bigint,
  numero text
)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_rol text;
  v_compra record;

  v_recepcion_id bigint;
  v_numero_recepcion text;

  v_item jsonb;

  v_producto_id bigint;
  v_cantidad_recibida numeric(14,2);
  v_cantidad_comprada numeric(14,2);

  v_producto_nombre text;
  v_unidad_medida text;

  v_existencia_actual numeric(12,2);
  v_existencia_nueva numeric(12,2);
begin

  -- ----------------------------------------------------------
  -- 1. VALIDAR ROL
  -- ----------------------------------------------------------

  v_rol := public.current_role_code();

  if coalesce(v_rol, '') not in (
    'almacen',
    'administracion'
  ) then
    raise exception
      'No tiene permisos para registrar recepciones de compra.';
  end if;


  -- ----------------------------------------------------------
  -- 2. OBTENER COMPRA
  -- ----------------------------------------------------------

  select
    c.id,
    c.numero,
    c.estado
  into v_compra
  from public.compras c
  where c.id = p_compra_id
  for update;


  if not found then
    raise exception
      'La compra indicada no existe.';
  end if;


  if v_compra.estado = 'anulada' then
    raise exception
      'La compra % se encuentra anulada.',
      v_compra.numero;
  end if;


  if v_compra.estado = 'recibida' then
    raise exception
      'La compra % ya fue recibida.',
      v_compra.numero;
  end if;


  if v_compra.estado <> 'autorizada' then
    raise exception
      'La compra % debe estar autorizada antes de registrarse su recepción.',
      v_compra.numero;
  end if;


  -- ----------------------------------------------------------
  -- 3. EVITAR DOBLE RECEPCIÓN
  -- ----------------------------------------------------------

  if exists (
    select 1
    from public.recepciones_compra rc
    where rc.compra_id = p_compra_id
  ) then
    raise exception
      'La compra % ya tiene una recepción registrada.',
      v_compra.numero;
  end if;


  -- ----------------------------------------------------------
  -- 4. VALIDAR ITEMS
  -- ----------------------------------------------------------

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception
      'La recepción debe contener al menos un producto.';
  end if;


  if exists (
    select 1
    from (
      select
        (item->>'producto_id')::bigint as producto_id,
        count(*) as cantidad_registros
      from jsonb_array_elements(p_items) as t(item)
      group by
        (item->>'producto_id')::bigint
      having count(*) > 1
    ) duplicados
  ) then
    raise exception
      'Un producto no puede repetirse dentro de la recepción.';
  end if;


  if jsonb_array_length(p_items) <>
     (
       select count(*)
       from public.detalle_compras dc
       where dc.compra_id = p_compra_id
     ) then
    raise exception
      'La recepción debe incluir todos los productos de la compra.';
  end if;


  -- ----------------------------------------------------------
  -- 5. VALIDAR CANTIDADES
  -- ----------------------------------------------------------

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    begin
      v_producto_id :=
        (v_item->>'producto_id')::bigint;

      v_cantidad_recibida :=
        (v_item->>'cantidad_recibida')::numeric;

    exception
      when others then
        raise exception
          'Existe un producto con datos inválidos en la recepción.';
    end;


    if v_producto_id is null then
      raise exception
        'Producto inválido.';
    end if;


    if v_cantidad_recibida is null
       or v_cantidad_recibida <= 0 then
      raise exception
        'La cantidad recibida debe ser mayor que cero.';
    end if;


    select
      dc.cantidad,
      p.nombre,
      p.unidad_medida
    into
      v_cantidad_comprada,
      v_producto_nombre,
      v_unidad_medida
    from public.detalle_compras dc
    join public.productos p
      on p.id = dc.producto_id
    where dc.compra_id = p_compra_id
      and dc.producto_id = v_producto_id;


    if not found then
      raise exception
        'El producto % no pertenece a la compra %.',
        v_producto_id,
        v_compra.numero;
    end if;


    if v_cantidad_recibida <> v_cantidad_comprada then
      raise exception
        'La cantidad recibida de % debe coincidir con la cantidad comprada. Comprada: %, recibida: %.',
        v_producto_nombre,
        v_cantidad_comprada,
        v_cantidad_recibida;
    end if;


    if lower(trim(v_unidad_medida)) = 'unidad'
       and v_cantidad_recibida <> trunc(v_cantidad_recibida) then
      raise exception
        'La cantidad recibida de % debe ser un número entero.',
        v_producto_nombre;
    end if;

  end loop;


  -- ----------------------------------------------------------
  -- 6. CREAR RECEPCIÓN
  -- ----------------------------------------------------------

  insert into public.recepciones_compra (
    compra_id,
    fecha_recepcion,
    observaciones,
    recibido_por
  )
  values (
    p_compra_id,
    coalesce(
      p_fecha_recepcion,
      current_date
    ),
    nullif(
      trim(
        coalesce(
          p_observaciones,
          ''
        )
      ),
      ''
    ),
    auth.uid()
  )
  returning
    id,
    recepciones_compra.numero
  into
    v_recepcion_id,
    v_numero_recepcion;


  -- ----------------------------------------------------------
  -- 7. DETALLE + INVENTARIO + KARDEX
  -- ----------------------------------------------------------

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    v_producto_id :=
      (v_item->>'producto_id')::bigint;

    v_cantidad_recibida :=
      (v_item->>'cantidad_recibida')::numeric;


    insert into public.detalle_recepciones_compra (
      recepcion_id,
      producto_id,
      cantidad_recibida
    )
    values (
      v_recepcion_id,
      v_producto_id,
      v_cantidad_recibida
    );


    insert into public.existencias (
      producto_id,
      cantidad
    )
    values (
      v_producto_id,
      0
    )
    on conflict (producto_id) do nothing;


    select e.cantidad
    into v_existencia_actual
    from public.existencias e
    where e.producto_id = v_producto_id
    for update;


    v_existencia_nueva :=
      v_existencia_actual +
      v_cantidad_recibida;


    update public.existencias
    set cantidad = v_existencia_nueva
    where producto_id = v_producto_id;


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
      v_producto_id,
      'entrada',
      v_cantidad_recibida,
      v_existencia_actual,
      v_existencia_nueva,
      'Recepción de compra ' ||
        v_compra.numero,
      v_numero_recepcion,
      auth.uid()
    );

  end loop;


  -- ----------------------------------------------------------
  -- 8. MARCAR COMPRA COMO RECIBIDA
  -- ----------------------------------------------------------

  update public.compras
  set estado = 'recibida'
  where id = p_compra_id;


  -- ----------------------------------------------------------
  -- 9. RESULTADO
  -- ----------------------------------------------------------

  return query
  select
    v_recepcion_id,
    v_numero_recepcion;

end;
$function$;