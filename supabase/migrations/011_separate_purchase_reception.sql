-- ============================================================
-- CASA HOGAR
-- MIGRACIÓN 011
-- SEPARAR REGISTRO DE COMPRA DE RECEPCIÓN / INVENTARIO
-- ============================================================


-- ============================================================
-- 1. MARCAR COMO RECIBIDAS LAS COMPRAS ANTIGUAS VIGENTES
-- ============================================================
-- Las compras creadas antes de esta migración ya aumentaron
-- automáticamente el inventario.
-- Las registramos como recepciones históricas para conservar
-- la coherencia de los datos.

insert into public.recepciones_compra (
  compra_id,
  fecha_recepcion,
  observaciones
)
select
  c.id,
  c.fecha_compra,
  'Recepción histórica creada durante la migración del nuevo flujo de compras.'
from public.compras c
where c.estado = 'registrada'
  and not exists (
    select 1
    from public.recepciones_compra rc
    where rc.compra_id = c.id
  );


insert into public.detalle_recepciones_compra (
  recepcion_id,
  producto_id,
  cantidad_recibida
)
select
  rc.id,
  dc.producto_id,
  dc.cantidad
from public.recepciones_compra rc
join public.detalle_compras dc
  on dc.compra_id = rc.compra_id
where not exists (
  select 1
  from public.detalle_recepciones_compra drc
  where drc.recepcion_id = rc.id
    and drc.producto_id = dc.producto_id
);


-- ============================================================
-- 2. REEMPLAZAR registrar_compra()
-- ============================================================
-- La compra ahora SOLO registra encabezado + detalle.
-- NO modifica existencias.
-- NO genera movimientos de inventario.

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
  -- 8. GUARDAR DETALLE
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

  end loop;


  -- ==========================================================
  -- 9. RESULTADO
  -- ==========================================================

  return query
  select
    v_compra_id,
    v_numero,
    v_total;

end;
$function$;


-- ============================================================
-- 3. REEMPLAZAR anular_compra()
-- ============================================================
-- Si la compra todavía NO fue recibida:
--   puede anularse sin afectar inventario.
--
-- Si YA existe recepción:
--   no se permite anular directamente.
--   Posteriormente se gestionará mediante Devolución de compra.

create or replace function public.anular_compra(
  p_compra_id bigint,
  p_motivo text
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

  -- ==========================================================
  -- 1. VALIDAR AUTORIZACIÓN
  -- ==========================================================

  v_rol := public.current_role_code();

  if coalesce(v_rol, '') not in (
    'administracion',
    'gerencia'
  ) then
    raise exception
      'Solo Administración o Gerencia pueden anular una compra.';
  end if;


  -- ==========================================================
  -- 2. VALIDAR MOTIVO
  -- ==========================================================

  if p_motivo is null
     or length(trim(p_motivo)) < 3 then
    raise exception
      'Debe indicar un motivo válido para anular la compra.';
  end if;


  -- ==========================================================
  -- 3. OBTENER Y BLOQUEAR COMPRA
  -- ==========================================================

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
      'La compra % ya se encuentra anulada.',
      v_compra.numero;
  end if;


  -- ==========================================================
  -- 4. NO ANULAR COMPRAS YA RECIBIDAS
  -- ==========================================================

  if exists (
    select 1
    from public.recepciones_compra rc
    where rc.compra_id = p_compra_id
  ) then
    raise exception
      'La compra % ya tiene una recepción registrada. Debe gestionarse mediante una devolución de compra.',
      v_compra.numero;
  end if;


  -- ==========================================================
  -- 5. ANULAR COMPRA
  -- ==========================================================

  update public.compras
  set
    estado = 'anulada',
    motivo_anulacion = trim(p_motivo),
    anulada_por = auth.uid(),
    anulada_at = now()
  where id = p_compra_id;

end;
$function$;