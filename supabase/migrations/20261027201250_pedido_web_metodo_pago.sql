-- =========================================================
-- PEDIDOS WEB · FORMA DE PAGO ELEGIDA POR EL CLIENTE
--
-- El cliente elige en el carrito cómo va a pagar (efectivo,
-- tarjeta o transferencia) para que caja no tenga que llamarle
-- a preguntar, sobre todo en pedidos a domicilio.
--
-- Caja no puede leer pedidos_en_linea (su RLS es solo para los
-- roles comerciales), así que al convertir el pedido en venta el
-- método se copia a ventas.metodo_pago_preferido. Es una
-- preferencia: cobrar_venta() no cambia y caja puede registrar
-- otro método si el cliente cambia de idea al pagar.
--
-- Afecta:
--   pedidos_en_linea.metodo_pago        (columna nueva)
--   ventas.metodo_pago_preferido        (columna nueva)
--   registrar_pedido_web(...)           (recibe p_metodo_pago)
--   mis_pedidos_web()                   (devuelve metodo_pago)
--   convertir_pedido_web_en_venta(...)  (copia el método a la venta)
-- Políticas RLS y privilegios de tabla: sin cambios.
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. COLUMNAS
-- ---------------------------------------------------------

ALTER TABLE public.pedidos_en_linea
  ADD COLUMN IF NOT EXISTS metodo_pago text
    CONSTRAINT pedidos_en_linea_metodo_pago_check
    CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia'));

ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS metodo_pago_preferido text
    CONSTRAINT ventas_metodo_pago_preferido_check
    CHECK (metodo_pago_preferido IN ('efectivo', 'tarjeta', 'transferencia'));

COMMENT ON COLUMN public.pedidos_en_linea.metodo_pago IS
  'Forma de pago elegida por el cliente en la tienda. NULL en pedidos anteriores a esta opción.';

COMMENT ON COLUMN public.ventas.metodo_pago_preferido IS
  'Forma de pago que el cliente eligió en su pedido web. Solo orienta a caja; el pago real está en pagos_venta.';

-- ---------------------------------------------------------
-- 2. registrar_pedido_web: nuevo parámetro p_metodo_pago
--
-- Se elimina la versión de 4 parámetros para no dejar dos
-- funciones con el mismo nombre (PostgREST no sabría cuál usar).
-- p_metodo_pago tiene DEFAULT NULL para que la versión anterior
-- del frontend siga registrando pedidos mientras se despliega.
-- ---------------------------------------------------------

DROP FUNCTION IF EXISTS public.registrar_pedido_web(jsonb, text, text, text);

CREATE OR REPLACE FUNCTION public.registrar_pedido_web(
  p_items jsonb,
  p_modalidad_entrega text DEFAULT 'retiro',
  p_direccion_entrega text DEFAULT NULL,
  p_observaciones text DEFAULT NULL,
  p_metodo_pago text DEFAULT NULL
)
RETURNS TABLE (pedido_id bigint, numero text, total numeric, estado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
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
      (1 - coalesce(v_producto.descuento_porcentaje, 0) / 100),
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
$$;

ALTER FUNCTION public.registrar_pedido_web(jsonb, text, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.registrar_pedido_web(jsonb, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_pedido_web(jsonb, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------
-- 3. mis_pedidos_web: devuelve también la forma de pago
--    (cambia el tipo de retorno, por eso DROP + CREATE)
-- ---------------------------------------------------------

DROP FUNCTION IF EXISTS public.mis_pedidos_web();

CREATE FUNCTION public.mis_pedidos_web()
RETURNS TABLE (
  id bigint,
  numero text,
  created_at timestamp with time zone,
  modalidad_entrega text,
  total numeric,
  estado text,
  direccion_entrega text,
  observaciones text,
  motivo_estado text,
  metodo_pago text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.numero,
    p.created_at,
    p.modalidad_entrega,
    p.total,
    p.estado,
    p.direccion_entrega,
    p.observaciones,
    p.motivo_estado,
    p.metodo_pago
  FROM public.pedidos_en_linea p
  WHERE p.cliente_web_id = auth.uid()
  ORDER BY p.created_at DESC;
END;
$$;

ALTER FUNCTION public.mis_pedidos_web() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.mis_pedidos_web() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mis_pedidos_web() TO authenticated;

-- ---------------------------------------------------------
-- 4. convertir_pedido_web_en_venta: copia la forma de pago
--    elegida por el cliente a la venta que cobrará caja
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.convertir_pedido_web_en_venta(p_pedido_id bigint)
RETURNS TABLE (pedido_id bigint, venta_id bigint, venta_numero text, venta_total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid;
  v_rol text;
  v_pedido record;
  v_items jsonb;
  v_venta_id bigint;
  v_venta_numero text;
  v_venta_total numeric(14,2);
BEGIN

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') <> 'vendedor' THEN
    RAISE EXCEPTION 'Solo el vendedor puede convertir pedidos en venta.';
  END IF;


  SELECT
    p.id,
    p.numero,
    p.estado,
    p.cliente_id,
    p.cliente_nombre,
    p.venta_id,
    p.metodo_pago
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF v_pedido.venta_id IS NOT NULL THEN
    RAISE EXCEPTION 'El pedido % ya fue convertido en venta.', v_pedido.numero;
  END IF;

  IF v_pedido.estado NOT IN ('confirmado', 'preparado') THEN
    RAISE EXCEPTION
      'El pedido % debe estar confirmado o preparado para convertirse en venta (estado actual: %).',
      v_pedido.numero,
      v_pedido.estado;
  END IF;


  -- Agrupar por producto: registrar_venta no admite repetidos.
  SELECT jsonb_agg(
    jsonb_build_object(
      'producto_id', x.producto_id,
      'cantidad', x.cantidad
    )
  )
  INTO v_items
  FROM (
    SELECT
      d.producto_id,
      SUM(d.cantidad) AS cantidad
    FROM public.detalle_pedidos_en_linea d
    WHERE d.pedido_id = p_pedido_id
    GROUP BY d.producto_id
  ) x;

  IF v_items IS NULL THEN
    RAISE EXCEPTION 'El pedido % no contiene productos.', v_pedido.numero;
  END IF;


  SELECT
    r.venta_id,
    r.numero,
    r.total
  INTO
    v_venta_id,
    v_venta_numero,
    v_venta_total
  FROM public.registrar_venta(
    v_items,
    'contado',
    v_pedido.cliente_id,
    v_pedido.cliente_nombre,
    NULL,
    NULL,
    v_pedido.numero
  ) AS r;


  -- Forma de pago elegida en la tienda: orienta a caja al cobrar.
  UPDATE public.ventas
  SET metodo_pago_preferido = v_pedido.metodo_pago
  WHERE id = v_venta_id;


  UPDATE public.pedidos_en_linea
  SET
    estado = 'convertido',
    venta_id = v_venta_id,
    gestionado_por = v_usuario,
    gestionado_at = now()
  WHERE id = p_pedido_id;


  RETURN QUERY
  SELECT
    v_pedido.id::bigint,
    v_venta_id,
    v_venta_numero,
    v_venta_total;
END;
$$;

COMMIT;
