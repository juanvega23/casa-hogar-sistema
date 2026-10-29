-- =========================================================
-- KÁRDEX POR PRODUCTO (COSTO PROMEDIO PONDERADO)
--
-- Solo lectura: arma la tarjeta de un producto a partir de
-- movimientos_inventario, en orden cronológico, con entradas,
-- salidas y saldo en unidades y en córdobas.
--
-- Costo de cada entrada:
--   recepción de compra     → costo unitario de esa compra (detalle_compras)
--   anulación de venta      → costo con que salió en esa venta (detalle_ventas)
--   devolución de venta     → costo con que salió en la venta original
--   inventario inicial, ajuste o entrada manual
--                           → costo promedio vigente; si no hay existencia,
--                             el precio de compra actual del producto
--                             (marcado como costo estimado)
-- Toda salida sale al costo promedio vigente. Cada entrada con costo
-- recalcula el promedio: (valor del saldo + valor de la entrada) /
-- unidades del saldo.
--
-- Las unidades del saldo son las que registró cada movimiento
-- (cantidad_nueva), es decir, la existencia real.
--
-- Roles: los mismos que consultan movimientos_inventario.
-- Afecta: kardex_producto() (función nueva). No cambia tablas.
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.kardex_producto(
  p_producto_id bigint,
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
)
RETURNS TABLE(
  fecha timestamptz,
  documento text,
  detalle text,
  es_saldo_inicial boolean,
  entrada_cantidad numeric,
  entrada_costo numeric,
  entrada_total numeric,
  salida_cantidad numeric,
  salida_costo numeric,
  salida_total numeric,
  saldo_cantidad numeric,
  saldo_costo_promedio numeric,
  saldo_total numeric,
  costo_estimado boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_precio_compra numeric;
  v_cantidad numeric := 0;
  v_valor numeric := 0;
  v_promedio numeric := 0;
  v_costo numeric;
  v_estimado boolean;
  v_es_entrada boolean;
  v_dia date;
  v_inicial_emitido boolean := false;
  m record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') NOT IN (
    'almacen',
    'gerencia',
    'encargado_compras',
    'responsable_compras'
  ) THEN
    RAISE EXCEPTION 'No tiene permisos para consultar el kárdex.';
  END IF;

  IF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_desde > p_hasta THEN
    RAISE EXCEPTION 'La fecha inicial no puede ser posterior a la final.';
  END IF;

  SELECT p.precio_compra
  INTO v_precio_compra
  FROM public.productos p
  WHERE p.id = p_producto_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto indicado no existe.';
  END IF;

  v_precio_compra := COALESCE(v_precio_compra, 0);

  FOR m IN
    SELECT
      mi.*,
      (mi.created_at AT TIME ZONE 'America/Managua')::date AS dia,
      rc.numero AS recepcion_numero,
      c.numero AS compra_numero,
      v.numero AS venta_numero,
      dv.numero AS devolucion_venta_numero,
      dc.numero AS devolucion_compra_numero,
      (
        SELECT d.costo_unitario
        FROM public.detalle_compras d
        WHERE d.compra_id = rc.compra_id
          AND d.producto_id = mi.producto_id
        ORDER BY d.id
        LIMIT 1
      ) AS costo_compra,
      (
        SELECT d.costo_unitario
        FROM public.detalle_ventas d
        WHERE d.venta_id = COALESCE(mi.venta_id, dv.venta_id)
          AND d.producto_id = mi.producto_id
          AND d.costo_unitario IS NOT NULL
        ORDER BY d.id
        LIMIT 1
      ) AS costo_venta
    FROM public.movimientos_inventario mi
    LEFT JOIN public.recepciones_compra rc ON rc.id = mi.recepcion_compra_id
    LEFT JOIN public.compras c ON c.id = rc.compra_id
    LEFT JOIN public.ventas v ON v.id = mi.venta_id
    LEFT JOIN public.devoluciones_venta dv ON dv.id = mi.devolucion_venta_id
    LEFT JOIN public.devoluciones_compra dc ON dc.id = mi.devolucion_compra_id
    WHERE mi.producto_id = p_producto_id
      AND (p_hasta IS NULL OR (mi.created_at AT TIME ZONE 'America/Managua')::date <= p_hasta)
    ORDER BY mi.created_at, mi.id
  LOOP
    v_dia := m.dia;

    -- Saldo inicial: lo acumulado antes del rango pedido.
    IF p_desde IS NOT NULL AND NOT v_inicial_emitido AND v_dia >= p_desde THEN
      v_inicial_emitido := true;
      RETURN QUERY SELECT
        (p_desde::timestamp AT TIME ZONE 'America/Managua'),
        NULL::text, 'Saldo inicial'::text, true,
        NULL::numeric, NULL::numeric, NULL::numeric,
        NULL::numeric, NULL::numeric, NULL::numeric,
        v_cantidad, round(v_promedio, 4), round(v_valor, 2), false;
    END IF;

    v_es_entrada := m.tipo IN ('entrada', 'ajuste_positivo');
    v_estimado := false;

    IF v_es_entrada THEN
      v_costo := CASE
        WHEN m.recepcion_compra_id IS NOT NULL THEN m.costo_compra
        WHEN m.venta_id IS NOT NULL OR m.devolucion_venta_id IS NOT NULL THEN m.costo_venta
      END;

      IF v_costo IS NULL THEN
        IF v_cantidad > 0 THEN
          v_costo := v_promedio;
        ELSE
          v_costo := v_precio_compra;
          v_estimado := true;
        END IF;
      END IF;

      v_valor := v_valor + m.cantidad * v_costo;
      v_cantidad := m.cantidad_nueva;
      v_promedio := CASE WHEN v_cantidad > 0 THEN v_valor / v_cantidad ELSE v_costo END;
    ELSE
      -- Sin existencia previa valorizada, la salida usa el precio de compra.
      IF v_cantidad <= 0 AND v_promedio = 0 THEN
        v_promedio := v_precio_compra;
        v_estimado := true;
      END IF;

      v_costo := v_promedio;
      v_cantidad := m.cantidad_nueva;
      v_valor := CASE WHEN v_cantidad > 0 THEN v_valor - m.cantidad * v_costo ELSE 0 END;

      IF v_valor < 0 THEN
        v_valor := v_cantidad * v_promedio;
      END IF;
    END IF;

    IF p_desde IS NULL OR v_dia >= p_desde THEN
      RETURN QUERY SELECT
        m.created_at,
        COALESCE(
          m.recepcion_numero,
          m.devolucion_venta_numero,
          m.devolucion_compra_numero,
          m.venta_numero,
          NULLIF(m.referencia, '')
        ),
        CASE
          WHEN m.recepcion_compra_id IS NOT NULL THEN
            'Recepción de compra' || COALESCE(' ' || m.compra_numero, '')
          WHEN m.devolucion_venta_id IS NOT NULL THEN
            'Devolución de venta' || COALESCE(' de ' || m.venta_numero, '')
          WHEN m.devolucion_compra_id IS NOT NULL THEN
            'Devolución a proveedor'
          WHEN m.venta_id IS NOT NULL AND v_es_entrada THEN
            'Anulación de venta'
          WHEN m.venta_id IS NOT NULL THEN
            'Venta'
          WHEN m.referencia = 'CARGA-INICIAL' THEN
            'Inventario inicial'
          WHEN m.tipo LIKE 'ajuste%' THEN
            'Ajuste' || COALESCE(': ' || NULLIF(m.motivo, ''), '')
          ELSE
            COALESCE(NULLIF(m.motivo, ''), CASE WHEN v_es_entrada THEN 'Entrada' ELSE 'Salida' END)
        END,
        false,
        CASE WHEN v_es_entrada THEN m.cantidad END,
        CASE WHEN v_es_entrada THEN round(v_costo, 4) END,
        CASE WHEN v_es_entrada THEN round(m.cantidad * v_costo, 2) END,
        CASE WHEN NOT v_es_entrada THEN m.cantidad END,
        CASE WHEN NOT v_es_entrada THEN round(v_costo, 4) END,
        CASE WHEN NOT v_es_entrada THEN round(m.cantidad * v_costo, 2) END,
        v_cantidad,
        round(v_promedio, 4),
        round(v_valor, 2),
        v_estimado;
    END IF;
  END LOOP;

  -- Rango sin movimientos (o todos anteriores): igual se muestra el saldo.
  IF p_desde IS NOT NULL AND NOT v_inicial_emitido THEN
    RETURN QUERY SELECT
      (p_desde::timestamp AT TIME ZONE 'America/Managua'),
      NULL::text, 'Saldo inicial'::text, true,
      NULL::numeric, NULL::numeric, NULL::numeric,
      NULL::numeric, NULL::numeric, NULL::numeric,
      v_cantidad, round(v_promedio, 4), round(v_valor, 2), false;
  END IF;
END;
$$;

ALTER FUNCTION public.kardex_producto(bigint, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.kardex_producto(bigint, date, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.kardex_producto(bigint, date, date) TO authenticated;

COMMIT;
