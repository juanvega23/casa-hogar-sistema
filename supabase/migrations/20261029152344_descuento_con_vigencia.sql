-- =========================================================
-- DESCUENTOS CON FECHA DE VIGENCIA
--
-- El Responsable Comercial puede indicar hasta qué fecha vale
-- el descuento de un producto. Pasada esa fecha (hora de
-- Managua) el descuento deja de aplicarse solo, sin que nadie
-- tenga que quitarlo: el producto vuelve a su precio normal y
-- sale de "Ofertas de la semana". Sin fecha, el descuento dura
-- hasta que se cambie, como antes.
--
-- No se borra nada: el porcentaje vencido queda guardado en el
-- producto y el historial conserva cada cambio.
--
-- Afecta:
--   productos.descuento_hasta            (columna nueva)
--   historial_precios                    (descuento_hasta anterior/nuevo)
--   descuento_vigente(numeric, date)     (función nueva)
--   actualizar_precio_producto(...)      (nuevo parámetro p_descuento_hasta)
--   catalogo_publico()                   (usa el descuento vigente y
--                                         devuelve descuento_hasta)
--   registrar_venta(...)                 (usa el descuento vigente)
--   registrar_pedido_web(...)            (usa el descuento vigente)
--   auditoria_sistema(...)               (muestra la fecha en el cambio)
-- convertir_pedido_web_en_venta() no cambia: llama a registrar_venta.
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. COLUMNAS NUEVAS
-- ---------------------------------------------------------

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS descuento_hasta date;

ALTER TABLE public.historial_precios
  ADD COLUMN IF NOT EXISTS descuento_hasta_anterior date,
  ADD COLUMN IF NOT EXISTS descuento_hasta_nuevo date;

-- descuento_hasta no entra en los GRANT UPDATE/INSERT por columna
-- de productos: solo se cambia con actualizar_precio_producto().


-- ---------------------------------------------------------
-- 2. DESCUENTO VIGENTE
-- Devuelve el porcentaje si no tiene fecha o si la fecha aún no
-- pasó (el último día de la oferta todavía aplica); si ya venció,
-- devuelve 0.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.descuento_vigente(
  p_porcentaje numeric,
  p_hasta date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_hasta IS NULL
      OR p_hasta >= (now() AT TIME ZONE 'America/Managua')::date
    THEN COALESCE(p_porcentaje, 0)
    ELSE 0
  END;
$$;

ALTER FUNCTION public.descuento_vigente(numeric, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.descuento_vigente(numeric, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.descuento_vigente(numeric, date) TO authenticated;


-- ---------------------------------------------------------
-- 3. CAMBIO DE PRECIO Y DESCUENTO
-- Igual que antes, con la fecha de vigencia:
--   - sin descuento, la fecha se ignora (queda NULL);
--   - la fecha no puede ser anterior a hoy.
-- ---------------------------------------------------------

DROP FUNCTION IF EXISTS public.actualizar_precio_producto(bigint, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.actualizar_precio_producto(
  p_producto_id bigint,
  p_precio_venta numeric,
  p_descuento_porcentaje numeric DEFAULT 0,
  p_motivo text DEFAULT NULL,
  p_descuento_hasta date DEFAULT NULL
)
RETURNS TABLE(
  producto_id bigint,
  precio_venta numeric,
  descuento_porcentaje numeric,
  descuento_hasta date,
  precio_final numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid := auth.uid();
  v_producto record;
  v_precio numeric(14,2);
  v_descuento numeric(5,2);
  v_hasta date;
  v_final numeric(14,2);
  v_motivo text := NULLIF(TRIM(COALESCE(p_motivo, '')), '');
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'responsable_comercial' THEN
    RAISE EXCEPTION 'Solo el Responsable Comercial puede cambiar precios y descuentos.';
  END IF;

  IF p_precio_venta IS NULL OR p_precio_venta <= 0 THEN
    RAISE EXCEPTION 'El precio de venta debe ser mayor que cero.';
  END IF;

  v_descuento := round(COALESCE(p_descuento_porcentaje, 0), 2);

  IF v_descuento < 0 OR v_descuento >= 100 THEN
    RAISE EXCEPTION 'El descuento debe estar entre 0 y 99 por ciento.';
  END IF;

  v_hasta := CASE WHEN v_descuento > 0 THEN p_descuento_hasta END;

  IF v_hasta IS NOT NULL
     AND v_hasta < (now() AT TIME ZONE 'America/Managua')::date THEN
    RAISE EXCEPTION 'La fecha de fin del descuento no puede ser anterior a hoy.';
  END IF;

  v_precio := round(p_precio_venta, 2);

  SELECT
    p.id,
    p.nombre,
    p.precio_compra,
    p.precio_venta,
    p.descuento_porcentaje,
    p.descuento_hasta
  INTO v_producto
  FROM public.productos p
  WHERE p.id = p_producto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto indicado no existe.';
  END IF;

  v_final := round(v_precio * (1 - v_descuento / 100), 2);

  IF v_final < COALESCE(v_producto.precio_compra, 0) THEN
    RAISE EXCEPTION
      'El precio final de % (C$%) queda por debajo de su costo (C$%). Sube el precio o baja el descuento.',
      v_producto.nombre,
      trim(to_char(v_final, 'FM999999990.00')),
      trim(to_char(v_producto.precio_compra, 'FM999999990.00'));
  END IF;

  IF v_precio = v_producto.precio_venta
     AND v_descuento = v_producto.descuento_porcentaje
     AND v_hasta IS NOT DISTINCT FROM v_producto.descuento_hasta THEN
    RAISE EXCEPTION 'El precio y el descuento no cambiaron.';
  END IF;

  UPDATE public.productos
  SET
    precio_venta = v_precio,
    descuento_porcentaje = v_descuento,
    descuento_hasta = v_hasta
  WHERE id = p_producto_id;

  INSERT INTO public.historial_precios (
    producto_id,
    precio_venta_anterior,
    precio_venta_nuevo,
    descuento_anterior,
    descuento_nuevo,
    descuento_hasta_anterior,
    descuento_hasta_nuevo,
    motivo,
    cambiado_por
  )
  VALUES (
    p_producto_id,
    v_producto.precio_venta,
    v_precio,
    v_producto.descuento_porcentaje,
    v_descuento,
    v_producto.descuento_hasta,
    v_hasta,
    v_motivo,
    v_usuario
  );

  RETURN QUERY
  SELECT p_producto_id, v_precio::numeric, v_descuento::numeric, v_hasta, v_final::numeric;
END;
$$;

ALTER FUNCTION public.actualizar_precio_producto(bigint, numeric, numeric, text, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.actualizar_precio_producto(bigint, numeric, numeric, text, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_precio_producto(bigint, numeric, numeric, text, date) TO authenticated;


-- ---------------------------------------------------------
-- 4. CATÁLOGO PÚBLICO
-- Mismo resultado que antes con el descuento vigente, más
-- descuento_hasta (solo cuando el descuento aplica) para que la
-- tienda diga hasta cuándo vale la oferta.
-- ---------------------------------------------------------

DROP FUNCTION IF EXISTS public.catalogo_publico();

CREATE OR REPLACE FUNCTION public.catalogo_publico()
RETURNS TABLE(
  id bigint,
  codigo text,
  nombre text,
  descripcion text,
  categoria text,
  precio numeric,
  disponible boolean,
  imagen_url text,
  precio_regular numeric,
  descuento_porcentaje numeric,
  unidad_medida text,
  pocas_unidades boolean,
  descuento_hasta date
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id,
    p.codigo,
    p.nombre,
    p.descripcion,
    coalesce(c.nombre, 'General') AS categoria,
    round(
      p.precio_venta *
      (1 - public.descuento_vigente(p.descuento_porcentaje, p.descuento_hasta) / 100),
      2
    ) AS precio,
    coalesce(e.cantidad, 0) > 0 AS disponible,
    p.imagen_url,
    p.precio_venta AS precio_regular,
    public.descuento_vigente(p.descuento_porcentaje, p.descuento_hasta) AS descuento_porcentaje,
    p.unidad_medida,
    coalesce(e.cantidad, 0) > 0
      AND coalesce(e.cantidad, 0) <= p.stock_minimo AS pocas_unidades,
    CASE
      WHEN public.descuento_vigente(p.descuento_porcentaje, p.descuento_hasta) > 0
      THEN p.descuento_hasta
    END AS descuento_hasta
  FROM public.productos p
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  LEFT JOIN public.existencias e ON e.producto_id = p.id
  WHERE p.activo = true
  ORDER BY c.nombre NULLS LAST, p.nombre;
$$;

ALTER FUNCTION public.catalogo_publico() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.catalogo_publico() FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_publico() TO anon;
GRANT EXECUTE ON FUNCTION public.catalogo_publico() TO authenticated;


-- ---------------------------------------------------------
-- 5. VENTAS Y PEDIDOS WEB
-- Definiciones vigentes; solo cambia el descuento que se lee
-- del producto (ahora el vigente).
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_venta(p_items jsonb, p_tipo_venta text DEFAULT 'contado'::text, p_cliente_id bigint DEFAULT NULL::bigint, p_cliente_nombre text DEFAULT NULL::text, p_cotizacion_id bigint DEFAULT NULL::bigint, p_fecha_vencimiento date DEFAULT NULL::date, p_referencia text DEFAULT NULL::text)
 RETURNS TABLE(venta_id bigint, numero text, total numeric, estado text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_venta_id bigint;
  v_numero text;
  v_estado text;

  v_item jsonb;
  v_producto_id bigint;
  v_cantidad numeric(14,2);

  v_producto_nombre text;
  v_unidad_medida text;
  v_precio_venta numeric(14,2);
  v_costo_unitario numeric(14,2);
  v_descuento_pct numeric(5,2);

  v_existencia_anterior numeric(14,2);
  v_existencia_nueva numeric(14,2);

  v_subtotal_linea numeric(14,2);
  v_descuento_linea numeric(14,2);
  v_total_linea numeric(14,2);

  v_subtotal numeric(14,2) := 0;
  v_descuento numeric(14,2) := 0;
  v_total numeric(14,2) := 0;

  v_nombre_cliente text;
  v_permite_credito boolean;

  v_estado_cotizacion text;
BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  
IF COALESCE(v_rol, '') NOT IN (
    'vendedor'
  ) THEN
    
    RAISE EXCEPTION
      'No tiene permisos para registrar ventas.';
  END IF;


  -- ==========================================================
  -- 3. VALIDAR TIPO DE VENTA
  -- ==========================================================

  p_tipo_venta :=
    LOWER(
      TRIM(
        COALESCE(
          p_tipo_venta,
          ''
        )
      )
    );

  IF p_tipo_venta NOT IN (
    'contado',
    'credito'
  ) THEN
    RAISE EXCEPTION
      'El tipo de venta debe ser contado o credito.';
  END IF;


  -- ==========================================================
  -- 4. VALIDAR ITEMS
  -- ==========================================================

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION
      'La venta debe contener al menos un producto.';
  END IF;


  -- No permitir productos repetidos
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        (item ->> 'producto_id')::bigint AS producto_id,
        COUNT(*) AS cantidad_registros
      FROM jsonb_array_elements(p_items) AS t(item)
      GROUP BY
        (item ->> 'producto_id')::bigint
      HAVING COUNT(*) > 1
    ) duplicados
  ) THEN
    RAISE EXCEPTION
      'Un producto no puede repetirse dentro de la misma venta.';
  END IF;


  -- ==========================================================
  -- 5. VALIDAR CLIENTE
  -- ==========================================================

  IF p_cliente_id IS NOT NULL THEN

    SELECT
      c.nombre,
      c.permite_credito
    INTO
      v_nombre_cliente,
      v_permite_credito
    FROM public.clientes c
    WHERE c.id = p_cliente_id
      AND c.activo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'El cliente no existe o se encuentra inactivo.';
    END IF;

  ELSE

    v_nombre_cliente :=
      NULLIF(
        TRIM(
          COALESCE(
            p_cliente_nombre,
            ''
          )
        ),
        ''
      );

    v_permite_credito := false;

  END IF;


  -- ==========================================================
  -- 6. VALIDACIONES PARA VENTA A CRÉDITO
  -- ==========================================================

  IF p_tipo_venta = 'credito' THEN

    IF p_cliente_id IS NULL THEN
      RAISE EXCEPTION
        'Las ventas a crédito deben estar asociadas a un cliente registrado.';
    END IF;

    IF COALESCE(v_permite_credito, false) = false THEN
      RAISE EXCEPTION
        'El cliente seleccionado no está autorizado para comprar a crédito.';
    END IF;

    IF p_fecha_vencimiento IS NULL THEN
      RAISE EXCEPTION
        'Debe indicar la fecha de vencimiento de la venta a crédito.';
    END IF;

    IF p_fecha_vencimiento < CURRENT_DATE THEN
      RAISE EXCEPTION
        'La fecha de vencimiento no puede ser anterior a la fecha actual.';
    END IF;

  END IF;


  -- ==========================================================
  -- 7. VALIDAR COTIZACIÓN SI EXISTE
  -- ==========================================================

  IF p_cotizacion_id IS NOT NULL THEN

    SELECT
      c.estado
    INTO
      v_estado_cotizacion
    FROM public.cotizaciones c
    WHERE c.id = p_cotizacion_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'La cotización indicada no existe.';
    END IF;

    IF v_estado_cotizacion NOT IN (
      'emitida',
      'aceptada'
    ) THEN
      RAISE EXCEPTION
        'La cotización no puede convertirse en venta desde su estado actual.';
    END IF;

  END IF;


  -- ==========================================================
  -- 8. VALIDAR PRODUCTOS, STOCK Y CALCULAR TOTAL
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP

    BEGIN

      v_producto_id :=
        (v_item ->> 'producto_id')::bigint;

      v_cantidad :=
        (v_item ->> 'cantidad')::numeric;

    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'Existe un producto con datos inválidos en la venta.';
    END;


    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION
        'Producto inválido.';
    END IF;


    IF v_cantidad IS NULL
       OR v_cantidad <= 0
    THEN
      RAISE EXCEPTION
        'La cantidad debe ser mayor que cero.';
    END IF;


    SELECT
      p.nombre,
      p.unidad_medida,
      p.precio_venta,
      p.precio_compra,
      public.descuento_vigente(p.descuento_porcentaje, p.descuento_hasta),
      e.cantidad
    INTO
      v_producto_nombre,
      v_unidad_medida,
      v_precio_venta,
      v_costo_unitario,
      v_descuento_pct,
      v_existencia_anterior
    FROM public.productos p
    JOIN public.existencias e
      ON e.producto_id = p.id
    WHERE p.id = v_producto_id
      AND p.activo = true
    FOR UPDATE OF e;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'El producto % no existe, está inactivo o no posee registro de existencia.',
        v_producto_id;
    END IF;


    IF LOWER(TRIM(v_unidad_medida)) = 'unidad'
       AND v_cantidad <> TRUNC(v_cantidad)
    THEN
      RAISE EXCEPTION
        'La cantidad de % debe ser un número entero.',
        v_producto_nombre;
    END IF;


    IF v_existencia_anterior < v_cantidad THEN
      RAISE EXCEPTION
        'Existencia insuficiente para %. Disponible: %, solicitado: %.',
        v_producto_nombre,
        v_existencia_anterior,
        v_cantidad;
    END IF;


    v_subtotal_linea :=
      ROUND(
        v_precio_venta * v_cantidad,
        2
      );


    v_descuento_linea :=
      ROUND(
        v_subtotal_linea *
        (
          COALESCE(v_descuento_pct, 0) / 100
        ),
        2
      );


    v_total_linea :=
      v_subtotal_linea -
      v_descuento_linea;


    v_subtotal :=
      v_subtotal +
      v_subtotal_linea;


    v_descuento :=
      v_descuento +
      v_descuento_linea;


    v_total :=
      v_total +
      v_total_linea;

  END LOOP;


  -- ==========================================================
  -- 9. DEFINIR ESTADO INICIAL
  -- ==========================================================

  IF p_tipo_venta = 'contado' THEN
    v_estado := 'pendiente_cobro';
  ELSE
    v_estado := 'con_saldo';
  END IF;


  -- ==========================================================
  -- 10. GENERAR NÚMERO DE VENTA
  -- ==========================================================

  v_numero :=
    'V-' ||
    LPAD(
      NEXTVAL(
        'public.ventas_numero_seq'
      )::text,
      6,
      '0'
    );


  -- ==========================================================
  -- 11. CREAR VENTA
  -- ==========================================================

  INSERT INTO public.ventas (
    numero,
    cliente_id,
    cliente_nombre,
    cotizacion_id,
    tipo_venta,
    subtotal,
    descuento,
    total,
    estado,
    referencia,
    creada_por
  )
  VALUES (
    v_numero,
    p_cliente_id,
    COALESCE(
      v_nombre_cliente,
      NULLIF(
        TRIM(
          COALESCE(
            p_cliente_nombre,
            ''
          )
        ),
        ''
      )
    ),
    p_cotizacion_id,
    p_tipo_venta,
    v_subtotal,
    v_descuento,
    v_total,
    v_estado,
    NULLIF(
      TRIM(
        COALESCE(
          p_referencia,
          ''
        )
      ),
      ''
    ),
    v_usuario
  )
  RETURNING id
  INTO v_venta_id;


  -- ==========================================================
  -- 12. GUARDAR DETALLE Y DESCONTAR INVENTARIO
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP

    v_producto_id :=
      (v_item ->> 'producto_id')::bigint;

    v_cantidad :=
      (v_item ->> 'cantidad')::numeric;


    SELECT
      p.nombre,
      p.precio_venta,
      p.precio_compra,
      public.descuento_vigente(p.descuento_porcentaje, p.descuento_hasta),
      e.cantidad
    INTO
      v_producto_nombre,
      v_precio_venta,
      v_costo_unitario,
      v_descuento_pct,
      v_existencia_anterior
    FROM public.productos p
    JOIN public.existencias e
      ON e.producto_id = p.id
    WHERE p.id = v_producto_id
    FOR UPDATE OF e;


    v_subtotal_linea :=
      ROUND(
        v_precio_venta * v_cantidad,
        2
      );


    v_descuento_linea :=
      ROUND(
        v_subtotal_linea *
        (
          COALESCE(v_descuento_pct, 0) / 100
        ),
        2
      );


    v_total_linea :=
      v_subtotal_linea -
      v_descuento_linea;


    INSERT INTO public.detalle_ventas (
      venta_id,
      producto_id,
      cantidad,
      precio_unitario,
      costo_unitario,
      descuento_porcentaje,
      subtotal
    )
    VALUES (
      v_venta_id,
      v_producto_id,
      v_cantidad,
      v_precio_venta,
      v_costo_unitario,
      COALESCE(
        v_descuento_pct,
        0
      ),
      v_total_linea
    );


    v_existencia_nueva :=
      v_existencia_anterior -
      v_cantidad;


    UPDATE public.existencias
    SET cantidad =
      v_existencia_nueva
    WHERE producto_id =
      v_producto_id;


    INSERT INTO public.movimientos_inventario (
      producto_id,
      tipo,
      cantidad,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      referencia,
      venta_id,
      creado_por
    )
    VALUES (
      v_producto_id,
      'salida',
      v_cantidad,
      v_existencia_anterior,
      v_existencia_nueva,
      'Venta ' || v_numero,
      v_numero,
      v_venta_id,
      v_usuario
    );

  END LOOP;


  -- ==========================================================
  -- 13. CREAR CUENTA POR COBRAR SI ES CRÉDITO
  -- ==========================================================

  IF p_tipo_venta = 'credito' THEN

    INSERT INTO public.cuentas_por_cobrar (
      venta_id,
      fecha_vencimiento,
      saldo_pendiente,
      estado
    )
    VALUES (
      v_venta_id,
      p_fecha_vencimiento,
      v_total,
      'pendiente'
    );

  END IF;


  -- ==========================================================
  -- 14. MARCAR COTIZACIÓN COMO CONVERTIDA
  -- ==========================================================

  IF p_cotizacion_id IS NOT NULL THEN

    UPDATE public.cotizaciones
    SET estado = 'convertida'
    WHERE id = p_cotizacion_id;

  END IF;


  -- ==========================================================
  -- 15. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_venta_id,
    v_numero,
    v_total,
    v_estado;

END;
$function$;


CREATE OR REPLACE FUNCTION public.registrar_pedido_web(p_items jsonb, p_modalidad_entrega text DEFAULT 'retiro'::text, p_direccion_entrega text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_metodo_pago text DEFAULT NULL::text)
 RETURNS TABLE(pedido_id bigint, numero text, total numeric, estado text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cliente public.clientes_web%ROWTYPE;
  v_modalidad text;
  v_metodo_pago text;
  v_item jsonb;
  v_producto_id bigint;
  v_cantidad numeric(14,2);
  v_producto public.productos%ROWTYPE;
  v_existencia numeric(14,2);
  v_precio numeric(14,2);
  v_subtotal numeric(14,2);
  v_total numeric(14,2) := 0;
  v_pedido_id bigint;
  v_numero text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión como cliente.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  SELECT * INTO v_cliente
  FROM public.clientes_web
  WHERE id = v_uid AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta de cliente no está activa.';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe contener productos.';
  END IF;

  v_modalidad := lower(trim(coalesce(p_modalidad_entrega, 'retiro')));

  IF v_modalidad NOT IN ('retiro', 'domicilio') THEN
    RAISE EXCEPTION 'Modalidad de entrega inválida.';
  END IF;

  IF v_modalidad = 'domicilio'
     AND nullif(trim(coalesce(p_direccion_entrega, v_cliente.direccion, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Debe indicar una dirección de entrega.';
  END IF;

  v_metodo_pago := nullif(lower(trim(coalesce(p_metodo_pago, ''))), '');

  IF v_metodo_pago IS NOT NULL
     AND v_metodo_pago NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION 'La forma de pago debe ser efectivo, tarjeta o transferencia.';
  END IF;

  v_numero := 'WEB-' ||
    lpad(nextval('public.pedido_web_numero_seq')::text, 6, '0');

  INSERT INTO public.pedidos_en_linea (
    numero,
    cliente_web_id,
    cliente_nombre,
    telefono,
    correo,
    modalidad_entrega,
    direccion_entrega,
    metodo_pago,
    subtotal,
    descuento,
    total,
    estado,
    observaciones
  )
  VALUES (
    v_numero,
    v_cliente.id,
    v_cliente.nombre,
    v_cliente.telefono,
    v_cliente.correo,
    v_modalidad,
    CASE
      WHEN v_modalidad = 'domicilio'
      THEN coalesce(
        nullif(trim(coalesce(p_direccion_entrega, '')), ''),
        v_cliente.direccion
      )
      ELSE NULL
    END,
    v_metodo_pago,
    0, 0, 0,
    'recibido',
    nullif(trim(coalesce(p_observaciones, '')), '')
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := nullif(v_item ->> 'producto_id', '')::bigint;
    v_cantidad := nullif(v_item ->> 'cantidad', '')::numeric;

    IF v_producto_id IS NULL OR v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Hay una cantidad inválida.';
    END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_producto_id AND activo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos ya no está disponible.';
    END IF;

    SELECT coalesce(cantidad, 0)
    INTO v_existencia
    FROM public.existencias
    WHERE producto_id = v_producto_id;

    v_existencia := coalesce(v_existencia, 0);

    IF v_existencia < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para %.', v_producto.nombre;
    END IF;

    v_precio := round(
      v_producto.precio_venta *
      (1 - public.descuento_vigente(v_producto.descuento_porcentaje, v_producto.descuento_hasta) / 100),
      2
    );

    v_subtotal := round(v_precio * v_cantidad, 2);

    INSERT INTO public.detalle_pedidos_en_linea (
      pedido_id, producto_id, cantidad, precio_unitario, subtotal
    )
    VALUES (
      v_pedido_id, v_producto_id, v_cantidad, v_precio, v_subtotal
    );

    v_total := v_total + v_subtotal;
  END LOOP;

  UPDATE public.pedidos_en_linea
  SET subtotal = round(v_total, 2),
      total = round(v_total, 2),
      updated_at = now()
  WHERE id = v_pedido_id;

  RETURN QUERY
  SELECT
    v_pedido_id,
    v_numero,
    round(v_total, 2),
    'recibido'::text;
END;
$function$;


-- ---------------------------------------------------------
-- 6. AUDITORÍA: el cambio de precio muestra la fecha de fin
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auditoria_sistema(p_limite integer DEFAULT 300)
 RETURNS TABLE(fecha timestamp with time zone, modulo text, accion text, referencia text, detalle text, usuario text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'soporte_ti' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar la auditoría.';
  END IF;

  RETURN QUERY
  WITH eventos AS (
    SELECT
      a.created_at AS fecha,
      'Usuarios'::text AS modulo,
      CASE a.accion
        WHEN 'crear_usuario' THEN 'Usuario creado'
        WHEN 'actualizar_usuario' THEN 'Usuario modificado'
        WHEN 'restablecer_clave' THEN 'Contraseña restablecida'
        ELSE a.accion
      END AS accion,
      COALESCE(pa.nombre_completo, pa.correo, 'Usuario eliminado') AS referencia,
      a.descripcion AS detalle,
      a.realizado_por AS actor
    FROM public.auditoria_usuarios a
    LEFT JOIN public.profiles pa
      ON pa.id = a.usuario_id

    UNION ALL

    SELECT
      v.anulada_at,
      'Ventas',
      'Venta anulada',
      v.numero,
      v.motivo_anulacion,
      v.anulada_por
    FROM public.ventas v
    WHERE v.estado = 'anulada'
      AND v.anulada_at IS NOT NULL

    UNION ALL

    SELECT
      d.updated_at,
      'Ventas',
      'Devolución anulada',
      d.numero,
      d.observaciones,
      NULL::uuid
    FROM public.devoluciones_venta d
    WHERE d.estado = 'anulada'

    UNION ALL

    SELECT
      c.autorizada_at,
      'Compras',
      'Compra autorizada',
      c.numero,
      'Total C$' || trim(to_char(c.total, 'FM999999990.00')),
      c.autorizada_por
    FROM public.compras c
    WHERE c.autorizada_at IS NOT NULL

    UNION ALL

    SELECT
      c.anulada_at,
      'Compras',
      'Compra anulada',
      c.numero,
      c.motivo_anulacion,
      c.anulada_por
    FROM public.compras c
    WHERE c.estado = 'anulada'
      AND c.anulada_at IS NOT NULL

    UNION ALL

    SELECT
      a.created_at,
      'Caja',
      'Diferencia en arqueo',
      s.numero,
      'Diferencia C$' || trim(to_char(a.diferencia, 'FM999999990.00')),
      a.realizado_por
    FROM public.arqueos_caja a
    JOIN public.sesiones_caja s
      ON s.id = a.sesion_caja_id
    WHERE a.diferencia <> 0

    UNION ALL

    -- Movimientos registrados manualmente (sin documento de origen).
    SELECT
      m.created_at,
      'Inventario',
      'Movimiento manual: ' || replace(m.tipo, '_', ' '),
      pr.codigo,
      pr.nombre || ' · ' ||
        trim(to_char(m.cantidad_anterior, 'FM999999990.##')) || ' → ' ||
        trim(to_char(m.cantidad_nueva, 'FM999999990.##')) ||
        COALESCE(' · ' || m.motivo, ''),
      m.creado_por
    FROM public.movimientos_inventario m
    JOIN public.productos pr
      ON pr.id = m.producto_id
    WHERE m.venta_id IS NULL
      AND m.recepcion_compra_id IS NULL
      AND m.devolucion_compra_id IS NULL
      AND m.devolucion_venta_id IS NULL

    UNION ALL

    -- Cambios de precio de venta o descuento (actualizar_precio_producto).
    SELECT
      h.created_at,
      'Productos',
      'Precio actualizado',
      pr.codigo,
      pr.nombre || ' · C$' ||
        trim(to_char(h.precio_venta_anterior, 'FM999999990.00')) || ' → C$' ||
        trim(to_char(h.precio_venta_nuevo, 'FM999999990.00')) ||
        CASE
          WHEN h.descuento_anterior <> h.descuento_nuevo THEN
            ' · descuento ' ||
            trim(to_char(h.descuento_anterior, 'FM990.##')) || ' % → ' ||
            trim(to_char(h.descuento_nuevo, 'FM990.##')) || ' %'
          ELSE ''
        END ||
        CASE
          WHEN h.descuento_nuevo > 0
           AND h.descuento_hasta_nuevo IS DISTINCT FROM h.descuento_hasta_anterior THEN
            ' · válido hasta ' ||
            COALESCE(to_char(h.descuento_hasta_nuevo, 'DD/MM/YYYY'), 'sin fecha')
          ELSE ''
        END ||
        COALESCE(' · ' || h.motivo, ''),
      h.cambiado_por
    FROM public.historial_precios h
    JOIN public.productos pr
      ON pr.id = h.producto_id
  )
  SELECT
    e.fecha,
    e.modulo,
    e.accion,
    e.referencia,
    e.detalle,
    COALESCE(pu.nombre_completo, pu.correo, '—')
  FROM eventos e
  LEFT JOIN public.profiles pu
    ON pu.id = e.actor
  ORDER BY e.fecha DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 300), 1000));
END;
$function$;

COMMIT;
