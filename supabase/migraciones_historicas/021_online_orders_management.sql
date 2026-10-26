-- =========================================================
-- 021 · PEDIDOS EN LÍNEA · GESTIÓN INTERNA Y CUENTA DEL CLIENTE
--
-- Antes: pedidos_en_linea y detalle_pedidos_en_linea tenían
-- RLS activo SIN políticas, por lo que ningún trabajador podía
-- ver los pedidos de la tienda, y no existía forma de
-- confirmarlos, rechazarlos ni convertirlos en venta.
--
-- Flujo:
--
--   Cliente web
--     → registrar_pedido_web()              estado: recibido
--     → cancelar_mi_pedido_web()            (solo si recibido)
--
--   Vendedor / Marketing digital
--     → cambiar_estado_pedido_web()
--         recibido   → confirmado | rechazado
--         confirmado → preparado  | cancelado
--         preparado  → cancelado
--
--   Vendedor
--     → convertir_pedido_web_en_venta()     estado: convertido
--         Reutiliza registrar_venta(): descuenta inventario,
--         genera Kardex y deja la venta pendiente de cobro
--         para el Módulo Caja.
--
--   Responsable comercial / Gerencia
--     → consulta
-- =========================================================

BEGIN;


-- =========================================================
-- 1. TRAZABILIDAD DE LA GESTIÓN
-- =========================================================

ALTER TABLE public.pedidos_en_linea
  ADD COLUMN IF NOT EXISTS motivo_estado text,
  ADD COLUMN IF NOT EXISTS gestionado_por uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gestionado_at timestamptz;


DROP TRIGGER IF EXISTS trg_pedidos_en_linea_updated_at
ON public.pedidos_en_linea;

CREATE TRIGGER trg_pedidos_en_linea_updated_at
BEFORE UPDATE ON public.pedidos_en_linea
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


-- =========================================================
-- 2. CONSULTA PARA EL PERSONAL COMERCIAL
-- =========================================================

DROP POLICY IF EXISTS pedidos_en_linea_select_comercial
ON public.pedidos_en_linea;

CREATE POLICY pedidos_en_linea_select_comercial
ON public.pedidos_en_linea
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'vendedor',
    'responsable_comercial',
    'marketing_digital',
    'gerencia'
  )
);


GRANT SELECT ON TABLE public.detalle_pedidos_en_linea TO authenticated;

DROP POLICY IF EXISTS detalle_pedidos_en_linea_select_comercial
ON public.detalle_pedidos_en_linea;

CREATE POLICY detalle_pedidos_en_linea_select_comercial
ON public.detalle_pedidos_en_linea
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'vendedor',
    'responsable_comercial',
    'marketing_digital',
    'gerencia'
  )
);


-- =========================================================
-- 3. MIS PEDIDOS (CLIENTE WEB)
-- Se agregan columnas al resultado. Cambiar el tipo de
-- retorno exige eliminar y volver a crear la función.
-- =========================================================

DROP FUNCTION IF EXISTS public.mis_pedidos_web();

CREATE FUNCTION public.mis_pedidos_web()
RETURNS TABLE (
  id bigint,
  numero text,
  created_at timestamptz,
  modalidad_entrega text,
  total numeric,
  estado text,
  direccion_entrega text,
  observaciones text,
  motivo_estado text
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
    p.motivo_estado
  FROM public.pedidos_en_linea p
  WHERE p.cliente_web_id = auth.uid()
  ORDER BY p.created_at DESC;
END;
$$;

ALTER FUNCTION public.mis_pedidos_web() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.mis_pedidos_web() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mis_pedidos_web() TO authenticated;


-- =========================================================
-- 4. DETALLE DE UN PEDIDO PROPIO (CLIENTE WEB)
-- =========================================================

CREATE OR REPLACE FUNCTION public.detalle_mi_pedido_web(
  p_pedido_id bigint
)
RETURNS TABLE (
  producto_id bigint,
  codigo text,
  nombre text,
  cantidad numeric,
  precio_unitario numeric,
  subtotal numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pedidos_en_linea p
    WHERE p.id = p_pedido_id
      AND p.cliente_web_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  RETURN QUERY
  SELECT
    d.producto_id,
    pr.codigo,
    pr.nombre,
    d.cantidad,
    d.precio_unitario,
    d.subtotal
  FROM public.detalle_pedidos_en_linea d
  JOIN public.productos pr
    ON pr.id = d.producto_id
  WHERE d.pedido_id = p_pedido_id
  ORDER BY d.id;
END;
$$;

ALTER FUNCTION public.detalle_mi_pedido_web(bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.detalle_mi_pedido_web(bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.detalle_mi_pedido_web(bigint) TO authenticated;


-- =========================================================
-- 5. CANCELAR UN PEDIDO PROPIO (CLIENTE WEB)
-- Solo mientras no haya sido atendido (estado recibido).
-- =========================================================

CREATE OR REPLACE FUNCTION public.cancelar_mi_pedido_web(
  p_pedido_id bigint,
  p_motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_pedido record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  SELECT p.id, p.numero, p.estado
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id
    AND p.cliente_web_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF v_pedido.estado <> 'recibido' THEN
    RAISE EXCEPTION
      'El pedido % ya está siendo atendido y no puede cancelarse desde la tienda. Comuníquese con Casa Hogar.',
      v_pedido.numero;
  END IF;

  UPDATE public.pedidos_en_linea
  SET
    estado = 'cancelado',
    motivo_estado = COALESCE(
      NULLIF(TRIM(COALESCE(p_motivo, '')), ''),
      'Cancelado por el cliente.'
    ),
    gestionado_por = auth.uid(),
    gestionado_at = now()
  WHERE id = p_pedido_id;
END;
$$;

ALTER FUNCTION public.cancelar_mi_pedido_web(bigint, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.cancelar_mi_pedido_web(bigint, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancelar_mi_pedido_web(bigint, text) TO authenticated;


-- =========================================================
-- 6. CAMBIAR ESTADO DE UN PEDIDO (PERSONAL)
-- =========================================================

CREATE OR REPLACE FUNCTION public.cambiar_estado_pedido_web(
  p_pedido_id bigint,
  p_estado text,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE (
  pedido_id bigint,
  numero text,
  estado text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid;
  v_rol text;
  v_pedido record;
  v_estado text;
  v_motivo text;
  v_faltante record;
BEGIN

  -- ----------------------------------------------------------
  -- USUARIO Y ROL
  -- ----------------------------------------------------------

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'vendedor',
    'marketing_digital'
  ) THEN
    RAISE EXCEPTION 'No tiene permisos para gestionar pedidos en línea.';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR ESTADO SOLICITADO
  -- ----------------------------------------------------------

  v_estado := LOWER(TRIM(COALESCE(p_estado, '')));
  v_motivo := NULLIF(TRIM(COALESCE(p_motivo, '')), '');

  IF v_estado NOT IN (
    'confirmado',
    'preparado',
    'rechazado',
    'cancelado'
  ) THEN
    RAISE EXCEPTION 'Estado de pedido no válido.';
  END IF;

  IF v_estado IN ('rechazado', 'cancelado')
     AND (v_motivo IS NULL OR LENGTH(v_motivo) < 3)
  THEN
    RAISE EXCEPTION 'Debe indicar un motivo válido.';
  END IF;


  -- ----------------------------------------------------------
  -- OBTENER Y BLOQUEAR PEDIDO
  -- ----------------------------------------------------------

  SELECT p.id, p.numero, p.estado
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;


  -- ----------------------------------------------------------
  -- TRANSICIONES PERMITIDAS
  -- ----------------------------------------------------------

  IF NOT (
    (v_pedido.estado = 'recibido'   AND v_estado IN ('confirmado', 'rechazado')) OR
    (v_pedido.estado = 'confirmado' AND v_estado IN ('preparado', 'cancelado')) OR
    (v_pedido.estado = 'preparado'  AND v_estado = 'cancelado')
  ) THEN
    RAISE EXCEPTION
      'El pedido % no puede pasar de % a %.',
      v_pedido.numero,
      v_pedido.estado,
      v_estado;
  END IF;


  -- ----------------------------------------------------------
  -- AL CONFIRMAR: VERIFICAR DISPONIBILIDAD ACTUAL
  -- (el pedido no reserva stock; la salida real ocurre al
  -- convertirlo en venta)
  -- ----------------------------------------------------------

  IF v_estado = 'confirmado' THEN
    SELECT
      pr.nombre,
      SUM(d.cantidad) AS solicitado,
      COALESCE(MAX(e.cantidad), 0) AS disponible
    INTO v_faltante
    FROM public.detalle_pedidos_en_linea d
    JOIN public.productos pr
      ON pr.id = d.producto_id
    LEFT JOIN public.existencias e
      ON e.producto_id = d.producto_id
    WHERE d.pedido_id = p_pedido_id
    GROUP BY d.producto_id, pr.nombre, pr.activo
    HAVING NOT pr.activo
        OR SUM(d.cantidad) > COALESCE(MAX(e.cantidad), 0)
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'No hay existencia suficiente de %. Disponible: %, solicitado: %.',
        v_faltante.nombre,
        v_faltante.disponible,
        v_faltante.solicitado;
    END IF;
  END IF;


  -- ----------------------------------------------------------
  -- ACTUALIZAR
  -- ----------------------------------------------------------

  UPDATE public.pedidos_en_linea
  SET
    estado = v_estado,
    motivo_estado = CASE
      WHEN v_estado IN ('rechazado', 'cancelado') THEN v_motivo
      ELSE motivo_estado
    END,
    gestionado_por = v_usuario,
    gestionado_at = now()
  WHERE id = p_pedido_id;


  RETURN QUERY
  SELECT
    v_pedido.id::bigint,
    v_pedido.numero::text,
    v_estado;
END;
$$;

ALTER FUNCTION public.cambiar_estado_pedido_web(bigint, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.cambiar_estado_pedido_web(bigint, text, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cambiar_estado_pedido_web(bigint, text, text) TO authenticated;


-- =========================================================
-- 7. CONVERTIR PEDIDO EN VENTA (VENDEDOR)
--
-- No duplica lógica: delega en registrar_venta(), que valida
-- rol, stock, unidades enteras, descuenta existencias y
-- registra el Kardex dentro de la misma transacción.
-- =========================================================

CREATE OR REPLACE FUNCTION public.convertir_pedido_web_en_venta(
  p_pedido_id bigint
)
RETURNS TABLE (
  pedido_id bigint,
  venta_id bigint,
  venta_numero text,
  venta_total numeric
)
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
    p.venta_id
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

ALTER FUNCTION public.convertir_pedido_web_en_venta(bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.convertir_pedido_web_en_venta(bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.convertir_pedido_web_en_venta(bigint) TO authenticated;

COMMIT;
