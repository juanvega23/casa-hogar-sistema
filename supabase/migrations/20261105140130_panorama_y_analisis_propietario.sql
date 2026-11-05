-- =============================================================
-- PANORAMA Y ANÁLISIS DEL PROPIETARIO
--
-- El Propietario ya no ve los reportes operativos de Gerencia:
-- sus pantallas responden preguntas de dueño (si va creciendo,
-- qué deja dinero, cuándo se vende, dónde está el dinero).
--
-- Solo lectura: no crea tablas ni modifica datos. Usa las mismas
-- reglas que alertas_recomendaciones_propietario() para que las
-- cifras coincidan: hora de Managua, ventas no anuladas, mismos
-- días del mes anterior, costo de línea o precio de compra y
-- 60 días sin ventas como inventario sin movimiento.
--
-- reportes_propietario() y dashboard_propietario() no se tocan.
-- =============================================================


-- ---------------------------------------------------------
-- 1. PANORAMA: "¿Cómo va mi negocio?" (Dashboard)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.panorama_propietario()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Managua')::date;
  v_inicio date;
  v_inicio_ant date;
  v_fin_ant date;      -- exclusivo: mismos días del mes anterior
  v_dia integer;
  v_dias_mes integer;
  v_dias_ant integer;

  v_ventas numeric := 0;
  v_ventas_ant numeric := 0;
  v_ventas_ant_total numeric := 0;
  v_operaciones integer := 0;

  v_neto numeric := 0;
  v_costo numeric := 0;
  v_neto_ant numeric := 0;
  v_costo_ant numeric := 0;

  v_por_cobrar numeric := 0;
  v_vencido numeric := 0;
  v_vencido_30 numeric := 0;

  v_activos integer := 0;
  v_agotados integer := 0;
  v_bajos integer := 0;
  v_inventario numeric := 0;
  v_sin_movimiento numeric := 0;

  v_acumulado jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'propietario' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar el panorama del negocio.';
  END IF;

  v_inicio := date_trunc('month', v_hoy)::date;
  v_inicio_ant := (v_inicio - INTERVAL '1 month')::date;
  v_dia := extract(day FROM v_hoy)::integer;
  v_dias_mes := extract(day FROM (v_inicio + INTERVAL '1 month - 1 day'))::integer;
  v_dias_ant := v_inicio - v_inicio_ant;
  v_fin_ant := LEAST(v_inicio_ant + v_dia, v_inicio);


  -- Ventas del mes y del mes anterior
  SELECT
    COALESCE(SUM(v.total) FILTER (WHERE f.dia >= v_inicio), 0),
    COALESCE(SUM(v.total) FILTER (WHERE f.dia >= v_inicio_ant AND f.dia < v_fin_ant), 0),
    COALESCE(SUM(v.total) FILTER (WHERE f.dia >= v_inicio_ant AND f.dia < v_inicio), 0),
    COUNT(*) FILTER (WHERE f.dia >= v_inicio)
  INTO v_ventas, v_ventas_ant, v_ventas_ant_total, v_operaciones
  FROM public.ventas v
  CROSS JOIN LATERAL (
    SELECT (v.created_at AT TIME ZONE 'America/Managua')::date AS dia
  ) f
  WHERE v.estado <> 'anulada'
    AND f.dia >= v_inicio_ant
    AND f.dia <= v_hoy;


  -- Ganancia bruta: neto de cada línea menos su costo
  SELECT
    COALESCE(SUM(d.subtotal) FILTER (WHERE f.dia >= v_inicio), 0),
    COALESCE(SUM(d.cantidad * COALESCE(d.costo_unitario, p.precio_compra, 0)) FILTER (WHERE f.dia >= v_inicio), 0),
    COALESCE(SUM(d.subtotal) FILTER (WHERE f.dia >= v_inicio_ant AND f.dia < v_fin_ant), 0),
    COALESCE(SUM(d.cantidad * COALESCE(d.costo_unitario, p.precio_compra, 0)) FILTER (WHERE f.dia >= v_inicio_ant AND f.dia < v_fin_ant), 0)
  INTO v_neto, v_costo, v_neto_ant, v_costo_ant
  FROM public.detalle_ventas d
  JOIN public.ventas v
    ON v.id = d.venta_id
  JOIN public.productos p
    ON p.id = d.producto_id
  CROSS JOIN LATERAL (
    SELECT (v.created_at AT TIME ZONE 'America/Managua')::date AS dia
  ) f
  WHERE v.estado <> 'anulada'
    AND f.dia >= v_inicio_ant
    AND f.dia <= v_hoy;


  -- Lo que le deben al negocio
  SELECT
    COALESCE(SUM(c.saldo_pendiente), 0),
    COALESCE(SUM(c.saldo_pendiente) FILTER (WHERE c.fecha_vencimiento < v_hoy), 0),
    COALESCE(SUM(c.saldo_pendiente) FILTER (WHERE c.fecha_vencimiento < v_hoy - 30), 0)
  INTO v_por_cobrar, v_vencido, v_vencido_30
  FROM public.cuentas_por_cobrar c
  JOIN public.ventas v
    ON v.id = c.venta_id
  WHERE c.saldo_pendiente > 0
    AND v.estado <> 'anulada';


  -- Inventario: disponibilidad y dinero invertido
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE COALESCE(e.cantidad, 0) <= 0),
    COUNT(*) FILTER (WHERE COALESCE(e.cantidad, 0) > 0 AND e.cantidad <= p.stock_minimo),
    COALESCE(SUM(e.cantidad * p.precio_compra) FILTER (WHERE e.cantidad > 0), 0),
    COALESCE(SUM(e.cantidad * p.precio_compra) FILTER (
      WHERE e.cantidad > 0
        AND NOT EXISTS (
          SELECT 1
          FROM public.detalle_ventas d
          JOIN public.ventas v
            ON v.id = d.venta_id
          WHERE d.producto_id = p.id
            AND v.estado <> 'anulada'
            AND v.created_at >= now() - INTERVAL '60 days'
        )
    ), 0)
  INTO v_activos, v_agotados, v_bajos, v_inventario, v_sin_movimiento
  FROM public.productos p
  LEFT JOIN public.existencias e
    ON e.producto_id = p.id
  WHERE p.activo = true;


  -- Ventas acumuladas día a día: este mes contra el anterior
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'dia', x.dia,
        'actual', CASE WHEN x.dia <= v_dia THEN x.actual END,
        'anterior', CASE WHEN x.dia <= v_dias_ant THEN x.anterior END
      )
      ORDER BY x.dia
    ),
    '[]'::jsonb
  )
  INTO v_acumulado
  FROM (
    SELECT
      n.dia,
      SUM(COALESCE(m.actual, 0)) OVER (ORDER BY n.dia) AS actual,
      SUM(COALESCE(m.anterior, 0)) OVER (ORDER BY n.dia) AS anterior
    FROM generate_series(1, GREATEST(v_dias_mes, v_dias_ant)) AS n(dia)
    LEFT JOIN (
      SELECT
        extract(day FROM f.dia)::integer AS dia,
        SUM(v.total) FILTER (WHERE f.dia >= v_inicio) AS actual,
        SUM(v.total) FILTER (WHERE f.dia < v_inicio) AS anterior
      FROM public.ventas v
      CROSS JOIN LATERAL (
        SELECT (v.created_at AT TIME ZONE 'America/Managua')::date AS dia
      ) f
      WHERE v.estado <> 'anulada'
        AND f.dia >= v_inicio_ant
        AND f.dia <= v_hoy
      GROUP BY 1
    ) m
      ON m.dia = n.dia
  ) x;


  RETURN jsonb_build_object(
    'generado_en', now(),
    'hoy', v_hoy,
    'dia', v_dia,
    'dias_mes', v_dias_mes,
    'ventas', jsonb_build_object(
      'mes', v_ventas,
      'mes_anterior_mismos_dias', v_ventas_ant,
      'mes_anterior_total', v_ventas_ant_total,
      'operaciones', v_operaciones
    ),
    'ganancia', jsonb_build_object(
      'neto', v_neto,
      'costo', v_costo,
      'neto_anterior', v_neto_ant,
      'costo_anterior', v_costo_ant
    ),
    'cobros', jsonb_build_object(
      'por_cobrar', v_por_cobrar,
      'vencido', v_vencido,
      'vencido_30', v_vencido_30
    ),
    'inventario', jsonb_build_object(
      'activos', v_activos,
      'agotados', v_agotados,
      'bajos', v_bajos,
      'valor', v_inventario,
      'sin_movimiento', v_sin_movimiento
    ),
    'acumulado', v_acumulado
  );
END;
$$;

ALTER FUNCTION public.panorama_propietario() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.panorama_propietario() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.panorama_propietario() TO authenticated;


-- ---------------------------------------------------------
-- 2. ANÁLISIS: Reportes y análisis del Propietario
-- p_meses: 3, 6 o 12 meses, contando el mes en curso.
-- El dinero (inventario y cobros) siempre es el de hoy.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.analisis_propietario(p_meses integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Managua')::date;
  v_inicio_mes date;
  v_desde date;

  v_meses jsonb;
  v_departamentos jsonb;
  v_productos jsonb;
  v_horario jsonb;
  v_canales jsonb;
  v_pago jsonb;
  v_clientes jsonb;
  v_dinero jsonb;
  v_activos integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'propietario' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar el análisis del negocio.';
  END IF;

  IF p_meses IS NULL OR p_meses NOT IN (3, 6, 12) THEN
    RAISE EXCEPTION 'El período debe ser de 3, 6 o 12 meses.';
  END IF;

  v_inicio_mes := date_trunc('month', v_hoy)::date;
  v_desde := (v_inicio_mes - make_interval(months => p_meses - 1))::date;


  -- ¿Estoy creciendo? Ventas y ganancia de cada mes
  SELECT jsonb_agg(
    jsonb_build_object(
      'mes', to_char(m.mes, 'YYYY-MM'),
      'ventas', COALESCE(ve.total, 0),
      'operaciones', COALESCE(ve.operaciones, 0),
      'neto', COALESCE(li.neto, 0),
      'costo', COALESCE(li.costo, 0)
    )
    ORDER BY m.mes
  )
  INTO v_meses
  FROM generate_series(v_desde::timestamp, v_inicio_mes::timestamp, INTERVAL '1 month') AS m(mes)
  LEFT JOIN (
    SELECT
      date_trunc('month', v.created_at AT TIME ZONE 'America/Managua')::date AS mes,
      SUM(v.total) AS total,
      COUNT(*) AS operaciones
    FROM public.ventas v
    WHERE v.estado <> 'anulada'
      AND (v.created_at AT TIME ZONE 'America/Managua')::date >= v_desde
    GROUP BY 1
  ) ve
    ON ve.mes = m.mes::date
  LEFT JOIN (
    SELECT
      date_trunc('month', v.created_at AT TIME ZONE 'America/Managua')::date AS mes,
      SUM(d.subtotal) AS neto,
      SUM(d.cantidad * COALESCE(d.costo_unitario, p.precio_compra, 0)) AS costo
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    JOIN public.productos p
      ON p.id = d.producto_id
    WHERE v.estado <> 'anulada'
      AND (v.created_at AT TIME ZONE 'America/Managua')::date >= v_desde
    GROUP BY 1
  ) li
    ON li.mes = m.mes::date;


  -- ¿Qué departamentos dejan más dinero?
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('nombre', x.nombre, 'neto', x.neto, 'costo', x.costo)
      ORDER BY x.neto - x.costo DESC, x.nombre
    ),
    '[]'::jsonb
  )
  INTO v_departamentos
  FROM (
    SELECT
      COALESCE(c.nombre, 'Sin departamento') AS nombre,
      SUM(d.subtotal) AS neto,
      SUM(d.cantidad * COALESCE(d.costo_unitario, p.precio_compra, 0)) AS costo
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    JOIN public.productos p
      ON p.id = d.producto_id
    LEFT JOIN public.categorias c
      ON c.id = p.categoria_id
    WHERE v.estado <> 'anulada'
      AND (v.created_at AT TIME ZONE 'America/Managua')::date >= v_desde
    GROUP BY 1
  ) x;


  -- ¿Qué productos dejan dinero de verdad?
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('nombre', x.nombre, 'neto', x.neto, 'costo', x.costo)
      ORDER BY x.neto - x.costo DESC, x.nombre
    ),
    '[]'::jsonb
  )
  INTO v_productos
  FROM (
    SELECT
      p.nombre,
      SUM(d.subtotal) AS neto,
      SUM(d.cantidad * COALESCE(d.costo_unitario, p.precio_compra, 0)) AS costo
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    JOIN public.productos p
      ON p.id = d.producto_id
    WHERE v.estado <> 'anulada'
      AND (v.created_at AT TIME ZONE 'America/Managua')::date >= v_desde
    GROUP BY p.id, p.nombre
  ) x;

  SELECT COUNT(*)
  INTO v_activos
  FROM public.productos
  WHERE activo = true;


  -- ¿Cuándo se vende más? Por día de la semana y parte del día
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('dia', x.dia, 'franja', x.franja, 'total', x.total, 'operaciones', x.operaciones)),
    '[]'::jsonb
  )
  INTO v_horario
  FROM (
    SELECT
      extract(isodow FROM f.local)::integer AS dia,
      CASE
        WHEN extract(hour FROM f.local) < 12 THEN 'manana'
        WHEN extract(hour FROM f.local) < 17 THEN 'tarde'
        ELSE 'noche'
      END AS franja,
      SUM(v.total) AS total,
      COUNT(*) AS operaciones
    FROM public.ventas v
    CROSS JOIN LATERAL (
      SELECT v.created_at AT TIME ZONE 'America/Managua' AS local
    ) f
    WHERE v.estado <> 'anulada'
      AND f.local::date >= v_desde
    GROUP BY 1, 2
  ) x;


  -- ¿Por dónde entra el dinero?
  SELECT jsonb_build_object(
    'mostrador', COALESCE(SUM(v.total) FILTER (
      WHERE pe.id IS NULL AND COALESCE(v.referencia, '') NOT LIKE 'Orden en tienda%'
    ), 0),
    'orden_tienda', COALESCE(SUM(v.total) FILTER (
      WHERE pe.id IS NULL AND v.referencia LIKE 'Orden en tienda%'
    ), 0),
    'en_linea', COALESCE(SUM(v.total) FILTER (WHERE pe.id IS NOT NULL), 0)
  ),
  jsonb_build_object(
    'contado', COALESCE(SUM(v.total) FILTER (WHERE v.tipo_venta = 'contado'), 0),
    'credito', COALESCE(SUM(v.total) FILTER (WHERE v.tipo_venta = 'credito'), 0)
  )
  INTO v_canales, v_pago
  FROM public.ventas v
  LEFT JOIN public.pedidos_en_linea pe
    ON pe.venta_id = v.id
  WHERE v.estado <> 'anulada'
    AND (v.created_at AT TIME ZONE 'America/Managua')::date >= v_desde;


  -- ¿Vuelven mis clientes? Quien no se identificó no se puede seguir
  SELECT jsonb_build_object(
    'identificados', COUNT(*),
    'recurrentes', COUNT(*) FILTER (WHERE x.compras >= 2),
    'monto_identificado', COALESCE(SUM(x.monto), 0),
    'monto_top5', COALESCE((
      SELECT SUM(t.monto)
      FROM (
        SELECT y.monto
        FROM (
          SELECT SUM(v2.total) AS monto
          FROM public.ventas v2
          WHERE v2.estado <> 'anulada'
            AND (v2.created_at AT TIME ZONE 'America/Managua')::date >= v_desde
            AND COALESCE(
              v2.cliente_id::text,
              NULLIF(lower(btrim(COALESCE(v2.cliente_nombre, ''))), 'cliente general'),
              ''
            ) <> ''
          GROUP BY COALESCE(
            v2.cliente_id::text,
            NULLIF(lower(btrim(COALESCE(v2.cliente_nombre, ''))), 'cliente general')
          )
        ) y
        ORDER BY y.monto DESC
        LIMIT 5
      ) t
    ), 0)
  )
  INTO v_clientes
  FROM (
    SELECT
      SUM(v.total) AS monto,
      COUNT(*) AS compras
    FROM public.ventas v
    WHERE v.estado <> 'anulada'
      AND (v.created_at AT TIME ZONE 'America/Managua')::date >= v_desde
      AND COALESCE(
        v.cliente_id::text,
        NULLIF(lower(btrim(COALESCE(v.cliente_nombre, ''))), 'cliente general'),
        ''
      ) <> ''
    GROUP BY COALESCE(
      v.cliente_id::text,
      NULLIF(lower(btrim(COALESCE(v.cliente_nombre, ''))), 'cliente general')
    )
  ) x;


  -- ¿Dónde está mi dinero hoy?
  SELECT jsonb_build_object(
    'inventario', COALESCE(i.valor, 0),
    'sin_movimiento', COALESCE(i.parado, 0),
    'costo_vendido_90', COALESCE(r.costo, 0),
    'cobro_al_dia', COALESCE(c.al_dia, 0),
    'cobro_1_30', COALESCE(c.d30, 0),
    'cobro_31_60', COALESCE(c.d60, 0),
    'cobro_mas_60', COALESCE(c.mas, 0)
  )
  INTO v_dinero
  FROM (
    SELECT
      SUM(e.cantidad * p.precio_compra) AS valor,
      SUM(e.cantidad * p.precio_compra) FILTER (
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.detalle_ventas d
          JOIN public.ventas v
            ON v.id = d.venta_id
          WHERE d.producto_id = p.id
            AND v.estado <> 'anulada'
            AND v.created_at >= now() - INTERVAL '60 days'
        )
      ) AS parado
    FROM public.productos p
    JOIN public.existencias e
      ON e.producto_id = p.id
    WHERE p.activo = true
      AND e.cantidad > 0
  ) i
  CROSS JOIN (
    SELECT SUM(d.cantidad * COALESCE(d.costo_unitario, p.precio_compra, 0)) AS costo
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    JOIN public.productos p
      ON p.id = d.producto_id
    WHERE v.estado <> 'anulada'
      AND v.created_at >= now() - INTERVAL '90 days'
  ) r
  CROSS JOIN (
    SELECT
      SUM(cc.saldo_pendiente) FILTER (WHERE cc.fecha_vencimiento >= v_hoy) AS al_dia,
      SUM(cc.saldo_pendiente) FILTER (WHERE cc.fecha_vencimiento < v_hoy AND cc.fecha_vencimiento >= v_hoy - 30) AS d30,
      SUM(cc.saldo_pendiente) FILTER (WHERE cc.fecha_vencimiento < v_hoy - 30 AND cc.fecha_vencimiento >= v_hoy - 60) AS d60,
      SUM(cc.saldo_pendiente) FILTER (WHERE cc.fecha_vencimiento < v_hoy - 60) AS mas
    FROM public.cuentas_por_cobrar cc
    JOIN public.ventas v
      ON v.id = cc.venta_id
    WHERE cc.saldo_pendiente > 0
      AND v.estado <> 'anulada'
  ) c;


  RETURN jsonb_build_object(
    'generado_en', now(),
    'desde', v_desde,
    'hoy', v_hoy,
    'meses', v_meses,
    'departamentos', v_departamentos,
    'productos', v_productos,
    'productos_activos', v_activos,
    'horario', v_horario,
    'canales', v_canales,
    'pago', v_pago,
    'clientes', v_clientes,
    'dinero', v_dinero
  );
END;
$$;

ALTER FUNCTION public.analisis_propietario(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.analisis_propietario(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.analisis_propietario(integer) TO authenticated;
