-- ============================================================
-- CASA HOGAR
-- MIGRACIÓN 009
-- REGISTRAR COMPRA CON TIPO DE COMPRA
-- ============================================================

drop function if exists public.registrar_compra(
  bigint,
  jsonb,
  date,
  text,
  text
);


create or replace function public.registrar_compra(
  p_proveedor_id bigint,
  p_items jsonb,
  p_tipo_compra text default 'directa',
  p_fecha_compra date default current_date,
  p_referencia_documento text default null,
  p_observaciones text default null
)
returns table(
  compra_id bigint,
  numero text,
  total numeric
)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_rol text;

  v_compra_id bigint;
  v_numero text;
  v_total numeric(14,2) := 0;

  v_item jsonb;

  v_producto_id bigint;
  v_cantidad numeric(14,2);
  v_costo_unitario numeric(14,2);
  v_subtotal numeric(14,2);

  v_producto_nombre text;
  v_unidad_medida text;

  v_existencia_actual numeric(12,2);
  v_existencia_nueva numeric(12,2);

  v_tipo_compra text;
begin

  -- ==========================================================
  -- 1. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  if coalesce(v_rol, '') not in (
    'almacen',
    'administracion',
    'gerencia'
  ) then
    raise exception
      'No tiene permisos para registrar compras.';
  end if;


  -- ==========================================================
  -- 2. VALIDAR TIPO DE COMPRA
  -- ==========================================================

  v_tipo_compra :=
    lower(
      trim(
        coalesce(
          p_tipo_compra,
          ''
        )
      )
    );

  if v_tipo_compra not in (
    'directa',
    'cotizacion',
    'licitacion'
  ) then
    raise exception
      'El tipo de compra no es válido.';
  end if;


  -- ==========================================================
  -- 3. VALIDAR PROVEEDOR
  -- ==========================================================

  perform 1
  from public.proveedores
  where id = p_proveedor_id
    and activo = true;

  if not found then
    raise exception
      'El proveedor no existe o se encuentra inactivo.';
  end if;


  -- ==========================================================
  -- 4. VALIDAR DETALLE
  -- ==========================================================

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then

    raise exception
      'La compra debe contener al menos un producto.';
  end if;


  -- ==========================================================
  -- 5. NO PERMITIR PRODUCTOS REPETIDOS
  -- ==========================================================

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
      'Un producto no puede repetirse dentro de la misma compra.';
  end if;


  -- ==========================================================
  -- 6. VALIDAR PRODUCTOS Y CALCULAR TOTAL
  -- ==========================================================

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    begin

      v_producto_id :=
        (v_item->>'producto_id')::bigint;

      v_cantidad :=
        (v_item->>'cantidad')::numeric;

      v_costo_unitario :=
        (v_item->>'costo_unitario')::numeric;

    exception
      when others then
        raise exception
          'Existe un producto con datos inválidos dentro de la compra.';
    end;


    if v_producto_id is null then
      raise exception
        'Producto inválido.';
    end if;


    if v_cantidad is null
       or v_cantidad <= 0 then
      raise exception
        'La cantidad de compra debe ser mayor que cero.';
    end if;


    if v_costo_unitario is null
       or v_costo_unitario < 0 then
      raise exception
        'El costo unitario no puede ser negativo.';
    end if;


    select
      p.nombre,
      p.unidad_medida
    into
      v_producto_nombre,
      v_unidad_medida
    from public.productos p
    where p.id = v_producto_id
      and p.activo = true;

    if not found then
      raise exception
        'El producto % no existe o se encuentra inactivo.',
        v_producto_id;
    end if;


    if lower(trim(v_unidad_medida)) = 'unidad'
       and v_cantidad <> trunc(v_cantidad) then

      raise exception
        'La cantidad de % debe ser un número entero porque se maneja por unidad.',
        v_producto_nombre;
    end if;


    v_subtotal :=
      round(
        v_cantidad * v_costo_unitario,
        2
      );

    v_total :=
      v_total + v_subtotal;

  end loop;


  -- ==========================================================
  -- 7. CREAR COMPRA
  -- ==========================================================

  insert into public.compras (
    proveedor_id,
    fecha_compra,
    referencia_documento,
    observaciones,
    total,
    estado,
    tipo_compra,
    creado_por
  )
  values (
    p_proveedor_id,
    coalesce(
      p_fecha_compra,
      current_date
    ),
    nullif(
      trim(
        coalesce(
          p_referencia_documento,
          ''
        )
      ),
      ''
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
    v_total,
    'registrada',
    v_tipo_compra,
    auth.uid()
  )
  returning
    id,
    compras.numero
  into
    v_compra_id,
    v_numero;


  -- ==========================================================
  -- 8. DETALLE + INVENTARIO
  -- TEMPORALMENTE CONSERVA EL COMPORTAMIENTO ACTUAL
  -- ==========================================================

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    v_producto_id :=
      (v_item->>'producto_id')::bigint;

    v_cantidad :=
      (v_item->>'cantidad')::numeric;

    v_costo_unitario :=
      (v_item->>'costo_unitario')::numeric;

    v_subtotal :=
      round(
        v_cantidad * v_costo_unitario,
        2
      );


    insert into public.detalle_compras (
      compra_id,
      producto_id,
      cantidad,
      costo_unitario,
      subtotal
    )
    values (
      v_compra_id,
      v_producto_id,
      v_cantidad,
      v_costo_unitario,
      v_subtotal
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
      v_cantidad;


    update public.existencias
    set cantidad =
      v_existencia_nueva
    where producto_id =
      v_producto_id;


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
      v_cantidad,
      v_existencia_actual,
      v_existencia_nueva,
      'Entrada por compra ' ||
        v_numero,
      v_numero,
      auth.uid()
    );

  end loop;


  return query
  select
    v_compra_id,
    v_numero,
    v_total;

end;
$function$;


revoke all
on function public.registrar_compra(
  bigint,
  jsonb,
  text,
  date,
  text,
  text
)
from public;


grant execute
on function public.registrar_compra(
  bigint,
  jsonb,
  text,
  date,
  text,
  text
)
to authenticated;