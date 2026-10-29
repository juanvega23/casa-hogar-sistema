-- =========================================================
-- PANEL DE SUPERVISIÓN DE GERENCIA Y ALERTAS DEL PROPIETARIO
--
-- Separa las alertas según quién debe actuar:
--
--   Gerencia (operativa): situaciones del día a día que alguien
--   tiene que resolver, una por una, con el módulo donde se ven:
--   productos agotados o bajo el mínimo (y si ya hay compra en
--   camino), compras sin autorizar o sin recibir, ventas sin
--   cobrar, pedidos web sin atender, devoluciones por revisar,
--   cuentas vencidas o por vencer, cajas sin cerrar, arqueos con
--   diferencia y ofertas por terminar.
--
--   Propietario (estratégico): resúmenes y tendencias del mes,
--   sin detalle operativo: ventas frente al mes pasado, margen,
--   descuentos, cobros atrasados, disponibilidad del catálogo,
--   inventario sin movimiento, faltantes de caja, devoluciones y
--   categoría líder.
--
-- Afecta:
--   texto_cantidad(numeric), texto_cordobas(numeric)  (nuevas, internas)
--   reposicion_sugerida()                  (Gerencia también la consulta)
--   alertas_supervision_gerencia()         (nueva)
--   alertas_recomendaciones_propietario()  (reescrita: alertas estratégicas)
-- No cambia tablas ni políticas.
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. FORMATO DE TEXTO (solo para los mensajes de las alertas)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.texto_cantidad(p_valor numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  -- 5.00 → 5 · 2.50 → 2.5
  SELECT rtrim(rtrim(to_char(COALESCE(p_valor, 0), 'FM999999990.00'), '0'), '.');
$$;

CREATE OR REPLACE FUNCTION public.texto_cordobas(p_valor numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT 'C$' || to_char(COALESCE(p_valor, 0), 'FM9,999,999,990.00');
$$;

ALTER FUNCTION public.texto_cantidad(numeric) OWNER TO postgres;
ALTER FUNCTION public.texto_cordobas(numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.texto_cantidad(numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.texto_cordobas(numeric) FROM PUBLIC, anon, authenticated, service_role;


-- ---------------------------------------------------------
-- 2. REPOSICIÓN SUGERIDA: Gerencia también la consulta
-- (misma definición; solo se agrega el rol)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reposicion_sugerida()
RETURNS TABLE (
  producto_id bigint,
  codigo text,
  nombre text,
  categoria text,
  unidad_medida text,
  existencia numeric,
  stock_minimo numeric,
  stock_maximo numeric,
  en_camino numeric,
  ventas_30d numeric,
  cantidad_sugerida numeric,
  costo_referencia numeric,
  proveedor_id bigint,
  proveedor_nombre text,
  proveedor_costo numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(public.current_role_code(), '') NOT IN (
    'encargado_compras',
    'responsable_compras',
    'almacen',
    'gerencia'
  ) THEN
    RAISE EXCEPTION 'No tiene permisos para consultar la reposición sugerida.';
  END IF;

  RETURN QUERY
  WITH ventas_30d AS (
    SELECT
      d.producto_id,
      SUM(d.cantidad) AS unidades
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    WHERE v.estado <> 'anulada'
      AND v.created_at >= now() - INTERVAL '30 days'
    GROUP BY d.producto_id
  ),

  pedidas AS (
    SELECT
      dc.producto_id,
      SUM(dc.cantidad) AS cantidad
    FROM public.detalle_compras dc
    JOIN public.compras c
      ON c.id = dc.compra_id
    WHERE c.estado IN ('registrada', 'autorizada')
    GROUP BY dc.producto_id
  ),

  mejor_proveedor AS (
    SELECT DISTINCT ON (pp.producto_id)
      pp.producto_id,
      pr.id AS proveedor_id,
      pr.nombre AS proveedor_nombre,
      pp.ultimo_costo
    FROM public.proveedor_productos pp
    JOIN public.proveedores pr
      ON pr.id = pp.proveedor_id
    WHERE pp.activo = true
      AND pr.activo = true
    ORDER BY pp.producto_id, pp.ultimo_costo ASC NULLS LAST, pr.nombre
  ),

  base AS (
    SELECT
      p.id,
      p.codigo,
      p.nombre,
      cat.nombre AS categoria,
      p.unidad_medida,
      COALESCE(e.cantidad, 0) AS existencia,
      p.stock_minimo,
      p.stock_maximo,
      COALESCE(pe.cantidad, 0) AS en_camino,
      COALESCE(v30.unidades, 0) AS ventas_30d,
      COALESCE(
        p.stock_maximo,
        GREATEST(
          p.stock_minimo * 2,
          p.stock_minimo + CEIL(COALESCE(v30.unidades, 0) / 2)
        )
      ) AS objetivo,
      p.precio_compra,
      mp.proveedor_id,
      mp.proveedor_nombre,
      mp.ultimo_costo
    FROM public.productos p
    LEFT JOIN public.categorias cat
      ON cat.id = p.categoria_id
    LEFT JOIN public.existencias e
      ON e.producto_id = p.id
    LEFT JOIN pedidas pe
      ON pe.producto_id = p.id
    LEFT JOIN ventas_30d v30
      ON v30.producto_id = p.id
    LEFT JOIN mejor_proveedor mp
      ON mp.producto_id = p.id
    WHERE p.activo = true
      AND COALESCE(e.cantidad, 0) <= p.stock_minimo
  )

  SELECT
    b.id::bigint,
    b.codigo::text,
    b.nombre::text,
    COALESCE(b.categoria, 'Sin categoría')::text,
    b.unidad_medida::text,
    b.existencia::numeric,
    b.stock_minimo::numeric,
    b.stock_maximo::numeric,
    b.en_camino::numeric,
    b.ventas_30d::numeric,
    GREATEST(0, CEIL(b.objetivo - b.existencia - b.en_camino))::numeric,
    b.precio_compra::numeric,
    b.proveedor_id::bigint,
    b.proveedor_nombre::text,
    b.ultimo_costo::numeric
  FROM base b
  ORDER BY
    (b.existencia <= 0) DESC,
    b.existencia - b.stock_minimo ASC,
    b.nombre ASC;
END;
$$;

ALTER FUNCTION public.reposicion_sugerida() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reposicion_sugerida() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reposicion_sugerida() TO authenticated;


-- ---------------------------------------------------------
-- 3. PANEL DE SUPERVISIÓN (GERENCIA)
-- Cada alerta trae el módulo del menú de Gerencia donde se
-- consulta (campo "modulo").
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.alertas_supervision_gerencia()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Managua')::date;
  v_alertas jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'gerencia' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar el panel de supervisión.';
  END IF;

  WITH
  inventario AS (
    SELECT
      'inventario'::text AS area,
      CASE
        WHEN r.existencia <= 0 AND r.en_camino <= 0 THEN 'critica'
        WHEN r.en_camino > 0 AND r.cantidad_sugerida <= 0 THEN 'media'
        ELSE 'alta'
      END AS prioridad,
      now() AS fecha,
      r.codigo AS referencia,
      CASE
        WHEN r.existencia <= 0 THEN 'Producto agotado'
        ELSE 'Stock bajo'
      END AS titulo,
      r.nombre ||
        CASE
          WHEN r.existencia <= 0 THEN ' está agotado'
          ELSE ' tiene ' || public.texto_cantidad(r.existencia) ||
               ' (mínimo ' || public.texto_cantidad(r.stock_minimo) || ')'
        END ||
        CASE
          WHEN r.en_camino > 0 THEN
            '. Hay ' || public.texto_cantidad(r.en_camino) || ' en camino en compras pendientes.'
          ELSE '. No hay ninguna compra en camino.'
        END AS mensaje,
      CASE
        WHEN r.en_camino > 0 AND r.cantidad_sugerida > 0 THEN
          'Lo pedido no alcanza: el Encargado de Compras debería agregar ' ||
          public.texto_cantidad(r.cantidad_sugerida) || ' más.'
        WHEN r.en_camino > 0 THEN
          'Dar seguimiento a la autorización y recepción de esa compra.'
        ELSE
          'Pedir al Encargado de Compras que registre la reposición (sugerido: ' ||
          public.texto_cantidad(r.cantidad_sugerida) || ').'
      END AS accion,
      CASE
        WHEN r.en_camino > 0 THEN 'compras-consulta'
        ELSE 'inventario-consulta'
      END AS modulo
    FROM public.reposicion_sugerida() r
  ),

  compras_por_autorizar AS (
    SELECT
      'compras'::text,
      CASE WHEN c.created_at < now() - INTERVAL '3 days' THEN 'alta' ELSE 'media' END,
      c.created_at,
      c.numero,
      'Compra esperando autorización',
      'La compra ' || c.numero || ' a ' || COALESCE(pv.nombre, 'un proveedor') ||
        ' por ' || public.texto_cordobas(c.total) ||
        ' espera autorización desde el ' ||
        to_char(c.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || '.',
      'Pedir al Responsable de Compras que la autorice o la anule.',
      'compras-consulta'
    FROM public.compras c
    LEFT JOIN public.proveedores pv
      ON pv.id = c.proveedor_id
    WHERE c.estado = 'registrada'
      AND c.created_at < now() - INTERVAL '1 day'
  ),

  compras_por_recibir AS (
    SELECT
      'compras'::text,
      CASE
        WHEN COALESCE(c.autorizada_at, c.created_at) < now() - INTERVAL '5 days' THEN 'alta'
        ELSE 'media'
      END,
      COALESCE(c.autorizada_at, c.created_at),
      c.numero,
      'Compra autorizada sin recibir',
      'La compra ' || c.numero || ' a ' || COALESCE(pv.nombre, 'un proveedor') ||
        ' por ' || public.texto_cordobas(c.total) || ' se autorizó el ' ||
        to_char(COALESCE(c.autorizada_at, c.created_at) AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') ||
        ' y todavía no llega a bodega.',
      'Confirmar con el proveedor la fecha de entrega y avisar a Bodega.',
      'recepciones-consulta'
    FROM public.compras c
    LEFT JOIN public.proveedores pv
      ON pv.id = c.proveedor_id
    WHERE c.estado = 'autorizada'
  ),

  ventas_sin_cobrar AS (
    SELECT
      'ventas'::text,
      'alta'::text,
      v.created_at,
      v.numero,
      'Venta sin cobrar',
      'La venta ' || v.numero || ' a ' || COALESCE(NULLIF(v.cliente_nombre, ''), 'cliente sin nombre') ||
        ' por ' || public.texto_cordobas(v.total) || ' se registró el ' ||
        to_char(v.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') ||
        ' y no se ha cobrado; su mercadería sigue apartada.',
      'Confirmar con el cliente. Si no va a pagar, el Responsable Comercial debe anularla para devolver el stock.',
      'ventas'
    FROM public.ventas v
    WHERE v.estado = 'pendiente_cobro'
      AND v.created_at < now() - INTERVAL '1 day'
  ),

  pedidos_web AS (
    SELECT
      'ventas'::text,
      CASE WHEN p.created_at < now() - INTERVAL '2 days' THEN 'alta' ELSE 'media' END,
      p.created_at,
      p.numero,
      'Pedido en línea sin terminar',
      'El pedido ' || p.numero || ' de ' || COALESCE(NULLIF(p.cliente_nombre, ''), 'un cliente') ||
        ' está "' || replace(p.estado, '_', ' ') || '" desde el ' ||
        to_char(p.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || '.',
      CASE p.estado
        WHEN 'recibido' THEN 'El Vendedor debe confirmarlo o rechazarlo.'
        WHEN 'confirmado' THEN 'Falta prepararlo para el cliente.'
        ELSE 'Ya está preparado: falta convertirlo en venta.'
      END,
      'pedidos-en-linea'
    FROM public.pedidos_en_linea p
    WHERE p.estado IN ('recibido', 'confirmado', 'preparado')
  ),

  devoluciones AS (
    SELECT
      'ventas'::text,
      CASE
        WHEN d.estado = 'registrada' AND d.created_at < now() - INTERVAL '2 days' THEN 'alta'
        ELSE 'media'
      END,
      COALESCE(d.confirmada_at, d.created_at),
      d.numero,
      CASE
        WHEN d.estado = 'registrada' THEN 'Devolución por revisar'
        ELSE 'Reembolso pendiente'
      END,
      CASE
        WHEN d.estado = 'registrada' THEN
          'La devolución ' || d.numero || ' de la venta ' || v.numero ||
          ' por ' || public.texto_cordobas(d.total) || ' espera revisión desde el ' ||
          to_char(d.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || '.'
        ELSE
          'La devolución ' || d.numero || ' está confirmada y falta entregar el reembolso de ' ||
          public.texto_cordobas(d.monto_reembolso) || '.'
      END,
      CASE
        WHEN d.estado = 'registrada' THEN 'El Responsable Comercial debe confirmarla o anularla.'
        ELSE 'El Responsable de Caja debe registrar el reembolso.'
      END,
      'devoluciones-venta'
    FROM public.devoluciones_venta d
    JOIN public.ventas v
      ON v.id = d.venta_id
    WHERE d.estado = 'registrada'
       OR (d.estado = 'confirmada' AND d.estado_financiero = 'pendiente_reembolso')
  ),

  cartera AS (
    SELECT
      'cartera'::text,
      CASE
        WHEN c.fecha_vencimiento < v_hoy - 30 THEN 'critica'
        WHEN c.fecha_vencimiento < v_hoy THEN 'alta'
        ELSE 'media'
      END,
      c.fecha_vencimiento::timestamptz,
      v.numero,
      CASE
        WHEN c.fecha_vencimiento < v_hoy THEN 'Cuenta por cobrar vencida'
        ELSE 'Cuenta por vencer'
      END,
      COALESCE(NULLIF(v.cliente_nombre, ''), 'Un cliente') || ' debe ' ||
        public.texto_cordobas(c.saldo_pendiente) || ' de la venta ' || v.numero ||
        CASE
          WHEN c.fecha_vencimiento < v_hoy THEN
            '; venció el ' || to_char(c.fecha_vencimiento, 'DD/MM/YYYY') ||
            ' (hace ' || (v_hoy - c.fecha_vencimiento) || ' días).'
          ELSE
            '; vence el ' || to_char(c.fecha_vencimiento, 'DD/MM/YYYY') || '.'
        END,
      CASE
        WHEN c.fecha_vencimiento < v_hoy THEN
          'Contactar al cliente para acordar el pago y no darle más crédito hasta que se ponga al día.'
        ELSE 'Recordarle al cliente la fecha de pago.'
      END,
      'cuentas-por-cobrar'
    FROM public.cuentas_por_cobrar c
    JOIN public.ventas v
      ON v.id = c.venta_id
    WHERE c.saldo_pendiente > 0
      AND v.estado <> 'anulada'
      AND c.fecha_vencimiento <= v_hoy + 3
  ),

  cajas_abiertas AS (
    SELECT
      'caja'::text,
      'alta'::text,
      s.fecha_apertura,
      s.numero,
      'Caja sin cerrar',
      'La caja ' || s.numero || ' sigue abierta desde el ' ||
        to_char(s.fecha_apertura AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || '.',
      'El Responsable de Caja debe hacer el arqueo y cerrarla al final de cada jornada.',
      'caja-historial'
    FROM public.sesiones_caja s
    WHERE s.estado = 'abierta'
      AND (s.fecha_apertura AT TIME ZONE 'America/Managua')::date < v_hoy
  ),

  arqueos AS (
    SELECT
      'caja'::text,
      CASE
        WHEN abs(a.diferencia) >= 500 THEN 'critica'
        WHEN a.diferencia < 0 THEN 'alta'
        ELSE 'media'
      END,
      a.created_at,
      s.numero,
      'Arqueo con diferencia',
      'El arqueo de ' || s.numero || ' (' ||
        to_char(a.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || ') tuvo ' ||
        concat_ws(
          ', ',
          CASE
            WHEN a.diferencia < 0 THEN 'un faltante de ' || public.texto_cordobas(-a.diferencia) || ' en efectivo'
            WHEN a.diferencia > 0 THEN 'un sobrante de ' || public.texto_cordobas(a.diferencia) || ' en efectivo'
          END,
          CASE
            WHEN COALESCE(a.tarjeta_contado - a.tarjeta_esperado, 0) <> 0 THEN
              'una diferencia de ' || public.texto_cordobas(abs(a.tarjeta_contado - a.tarjeta_esperado)) || ' en tarjeta'
          END,
          CASE
            WHEN COALESCE(a.transferencia_contado - a.transferencia_esperado, 0) <> 0 THEN
              'una diferencia de ' || public.texto_cordobas(abs(a.transferencia_contado - a.transferencia_esperado)) || ' en transferencias'
          END
        ) || '.' ||
        COALESCE(' Motivo: ' || NULLIF(a.observaciones, ''), ''),
      'Revisar con el Responsable de Caja los cobros y salidas de esa jornada.',
      'caja-historial'
    FROM public.arqueos_caja a
    JOIN public.sesiones_caja s
      ON s.id = a.sesion_caja_id
    WHERE a.created_at >= now() - INTERVAL '30 days'
      AND (
        a.diferencia <> 0
        OR COALESCE(a.tarjeta_contado - a.tarjeta_esperado, 0) <> 0
        OR COALESCE(a.transferencia_contado - a.transferencia_esperado, 0) <> 0
      )
  ),

  ofertas AS (
    SELECT
      'ventas'::text,
      'baja'::text,
      p.descuento_hasta::timestamptz,
      p.codigo,
      'Oferta por terminar',
      'La oferta de ' || p.nombre || ' (−' || public.texto_cantidad(p.descuento_porcentaje) ||
        ' %) termina el ' || to_char(p.descuento_hasta, 'DD/MM/YYYY') || '.',
      'Si conviene extenderla, el Responsable Comercial puede cambiar la fecha.',
      'productos-consulta'
    FROM public.productos p
    WHERE p.activo = true
      AND p.descuento_porcentaje > 0
      AND p.descuento_hasta BETWEEN v_hoy AND v_hoy + 3
  ),

  todas AS (
    SELECT * FROM inventario
    UNION ALL SELECT * FROM compras_por_autorizar
    UNION ALL SELECT * FROM compras_por_recibir
    UNION ALL SELECT * FROM ventas_sin_cobrar
    UNION ALL SELECT * FROM pedidos_web
    UNION ALL SELECT * FROM devoluciones
    UNION ALL SELECT * FROM cartera
    UNION ALL SELECT * FROM cajas_abiertas
    UNION ALL SELECT * FROM arqueos
    UNION ALL SELECT * FROM ofertas
  )

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'area', t.area,
        'prioridad', t.prioridad,
        'fecha', t.fecha,
        'referencia', t.referencia,
        'titulo', t.titulo,
        'mensaje', t.mensaje,
        'accion', t.accion,
        'modulo', t.modulo
      )
      ORDER BY
        CASE t.prioridad
          WHEN 'critica' THEN 1
          WHEN 'alta' THEN 2
          WHEN 'media' THEN 3
          ELSE 4
        END,
        t.fecha ASC
    ),
    '[]'::jsonb
  )
  INTO v_alertas
  FROM todas t;

  RETURN jsonb_build_object(
    'generado_en', now(),
    'resumen', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'criticas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'critica'),
        'altas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'alta'),
        'medias', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'media'),
        'bajas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'baja')
      )
      FROM jsonb_array_elements(v_alertas) x
    ),
    'alertas', v_alertas
  );
END;
$$;

ALTER FUNCTION public.alertas_supervision_gerencia() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.alertas_supervision_gerencia() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.alertas_supervision_gerencia() TO authenticated;


-- ---------------------------------------------------------
-- 4. ALERTAS DEL PROPIETARIO (ESTRATÉGICAS)
-- Mes en curso (hora de Managua) frente a los mismos días del
-- mes anterior. Solo resúmenes: el detalle lo sigue Gerencia.
-- ---------------------------------------------------------

DROP FUNCTION IF EXISTS public.alertas_recomendaciones_propietario();

CREATE OR REPLACE FUNCTION public.alertas_recomendaciones_propietario()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  c_meses CONSTANT text[] := ARRAY[
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  v_hoy date := (now() AT TIME ZONE 'America/Managua')::date;
  v_inicio date;
  v_inicio_ant date;
  v_fin_ant date;   -- exclusivo
  v_periodo text;

  v_ventas numeric := 0;
  v_ventas_ant numeric := 0;
  v_bruto numeric := 0;
  v_descuentos numeric := 0;
  v_neto_lineas numeric := 0;
  v_costo numeric := 0;
  v_pct numeric;

  v_cartera numeric := 0;
  v_cartera_30 numeric := 0;
  v_cartera_cuentas integer := 0;
  v_cartera_clientes integer := 0;

  v_activos integer := 0;
  v_agotados integer := 0;
  v_bajos integer := 0;

  v_sin_rotacion integer := 0;
  v_sin_rotacion_capital numeric := 0;

  v_faltantes integer := 0;
  v_faltantes_monto numeric := 0;

  v_devoluciones numeric := 0;

  v_categoria text;
  v_categoria_monto numeric := 0;

  v_alertas jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'propietario' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar alertas y recomendaciones.';
  END IF;

  v_inicio := date_trunc('month', v_hoy)::date;
  v_inicio_ant := (v_inicio - INTERVAL '1 month')::date;
  v_fin_ant := LEAST(v_inicio_ant + (v_hoy - v_inicio + 1), v_inicio);
  v_periodo := 'Del 1 al ' || extract(day FROM v_hoy) || ' de ' ||
    c_meses[extract(month FROM v_hoy)::int];


  -- ----------------------------------------------------------
  -- VENTAS DEL MES Y DEL MES ANTERIOR (mismos días)
  -- ----------------------------------------------------------
  SELECT
    COALESCE(SUM(v.total) FILTER (WHERE f.dia >= v_inicio), 0),
    COALESCE(SUM(v.total) FILTER (WHERE f.dia >= v_inicio_ant AND f.dia < v_fin_ant), 0),
    COALESCE(SUM(v.subtotal) FILTER (WHERE f.dia >= v_inicio), 0),
    COALESCE(SUM(v.descuento) FILTER (WHERE f.dia >= v_inicio), 0)
  INTO v_ventas, v_ventas_ant, v_bruto, v_descuentos
  FROM public.ventas v
  CROSS JOIN LATERAL (
    SELECT (v.created_at AT TIME ZONE 'America/Managua')::date AS dia
  ) f
  WHERE v.estado <> 'anulada'
    AND f.dia >= v_inicio_ant
    AND f.dia <= v_hoy;

  -- Ganancia bruta del mes: neto de cada línea menos su costo
  SELECT
    COALESCE(SUM(d.subtotal), 0),
    COALESCE(SUM(d.cantidad * COALESCE(d.costo_unitario, p.precio_compra, 0)), 0)
  INTO v_neto_lineas, v_costo
  FROM public.detalle_ventas d
  JOIN public.ventas v
    ON v.id = d.venta_id
  JOIN public.productos p
    ON p.id = d.producto_id
  WHERE v.estado <> 'anulada'
    AND (v.created_at AT TIME ZONE 'America/Managua')::date >= v_inicio;


  -- 1. Tendencia de ventas
  IF v_ventas_ant > 0 THEN
    v_pct := round((v_ventas - v_ventas_ant) / v_ventas_ant * 100, 1);

    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'ventas',
      'prioridad', CASE WHEN v_pct <= -10 THEN 'alta' ELSE 'baja' END,
      'titulo', CASE
        WHEN v_pct <= -10 THEN 'Las ventas van bajando'
        WHEN v_pct >= 10 THEN 'Las ventas van creciendo'
        ELSE 'Ventas estables'
      END,
      'indicador', CASE WHEN v_pct > 0 THEN '+' ELSE '' END || public.texto_cantidad(v_pct) || ' %',
      'mensaje', v_periodo || ' se vendieron ' || public.texto_cordobas(v_ventas) ||
        ' frente a ' || public.texto_cordobas(v_ventas_ant) ||
        ' en los mismos días del mes pasado.',
      'recomendacion', CASE
        WHEN v_pct <= -10 THEN
          'Revisar con Gerencia qué productos dejaron de venderse y si conviene una oferta o más exhibición.'
        WHEN v_pct >= 10 THEN
          'Asegurar inventario de lo que más se vende para no quedarse sin existencias.'
        ELSE 'Sin acción necesaria; conviene seguir comparando cada semana.'
      END
    );
  END IF;


  -- 2. Margen bruto
  IF v_neto_lineas > 0 THEN
    v_pct := round((v_neto_lineas - v_costo) / v_neto_lineas * 100, 1);

    IF v_pct < 20 THEN
      v_alertas := v_alertas || jsonb_build_object(
        'tipo', 'rentabilidad',
        'prioridad', CASE WHEN v_pct < 10 THEN 'alta' ELSE 'media' END,
        'titulo', 'Margen de ganancia bajo',
        'indicador', public.texto_cantidad(v_pct) || ' %',
        'mensaje', 'Este mes, de cada C$100 vendidos quedan ' ||
          public.texto_cordobas(v_pct) || ' de ganancia bruta (ventas ' ||
          public.texto_cordobas(v_neto_lineas) || ', costo ' || public.texto_cordobas(v_costo) || ').',
        'recomendacion', 'Revisar los costos de compra con los proveedores y los descuentos vigentes.'
      );
    END IF;
  END IF;


  -- 3. Descuentos
  IF v_bruto > 0 THEN
    v_pct := round(v_descuentos / v_bruto * 100, 1);

    IF v_pct >= 10 THEN
      v_alertas := v_alertas || jsonb_build_object(
        'tipo', 'rentabilidad',
        'prioridad', 'media',
        'titulo', 'Descuentos altos',
        'indicador', public.texto_cantidad(v_pct) || ' %',
        'mensaje', 'Los descuentos de este mes suman ' || public.texto_cordobas(v_descuentos) ||
          ', el ' || public.texto_cantidad(v_pct) || ' % de lo vendido a precio normal.',
        'recomendacion', 'Confirmar con el Responsable Comercial que las ofertas están trayendo más ventas.'
      );
    END IF;
  END IF;


  -- 4. Cobros atrasados
  SELECT
    COALESCE(SUM(c.saldo_pendiente), 0),
    COALESCE(SUM(c.saldo_pendiente) FILTER (WHERE c.fecha_vencimiento < v_hoy - 30), 0),
    COUNT(*),
    COUNT(DISTINCT COALESCE(v.cliente_id::text, v.cliente_nombre))
  INTO v_cartera, v_cartera_30, v_cartera_cuentas, v_cartera_clientes
  FROM public.cuentas_por_cobrar c
  JOIN public.ventas v
    ON v.id = c.venta_id
  WHERE c.saldo_pendiente > 0
    AND v.estado <> 'anulada'
    AND c.fecha_vencimiento < v_hoy;

  IF v_cartera > 0 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'cartera',
      'prioridad', CASE WHEN v_cartera_30 > 0 THEN 'critica' ELSE 'alta' END,
      'titulo', 'Cobros atrasados',
      'indicador', public.texto_cordobas(v_cartera),
      'mensaje', 'Hay ' || public.texto_cordobas(v_cartera) || ' vencidos sin cobrar en ' ||
        v_cartera_cuentas || CASE WHEN v_cartera_cuentas = 1 THEN ' cuenta' ELSE ' cuentas' END ||
        ' de ' || v_cartera_clientes || CASE WHEN v_cartera_clientes = 1 THEN ' cliente' ELSE ' clientes' END ||
        CASE
          WHEN v_cartera_30 > 0 THEN
            '; ' || public.texto_cordobas(v_cartera_30) || ' tienen más de 30 días.'
          ELSE '.'
        END,
      'recomendacion', 'Gerencia da seguimiento a cada cuenta. Si el monto sigue creciendo, conviene limitar las ventas a crédito.'
    );
  END IF;


  -- 5. Disponibilidad del catálogo
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE COALESCE(e.cantidad, 0) <= 0),
    COUNT(*) FILTER (WHERE COALESCE(e.cantidad, 0) > 0 AND e.cantidad <= p.stock_minimo)
  INTO v_activos, v_agotados, v_bajos
  FROM public.productos p
  LEFT JOIN public.existencias e
    ON e.producto_id = p.id
  WHERE p.activo = true;

  IF v_agotados + v_bajos > 0 THEN
    v_pct := round((v_agotados + v_bajos)::numeric / GREATEST(v_activos, 1) * 100, 1);

    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'inventario',
      'prioridad', CASE WHEN v_pct >= 15 THEN 'alta' ELSE 'media' END,
      'titulo', 'Productos sin existencias suficientes',
      'indicador', public.texto_cantidad(v_pct) || ' % del catálogo',
      'mensaje', concat_ws(
          ' y ',
          CASE
            WHEN v_agotados = 1 THEN '1 producto agotado'
            WHEN v_agotados > 1 THEN v_agotados || ' productos agotados'
          END,
          CASE
            WHEN v_bajos = 1 THEN '1 producto en o bajo el mínimo'
            WHEN v_bajos > 1 THEN v_bajos || ' productos en o bajo el mínimo'
          END
        ) || ', de ' || v_activos || ' productos activos.',
      'recomendacion', 'Gerencia coordina la reposición con Compras. Si se repite cada mes, revisar los mínimos o el presupuesto de compras.'
    );
  END IF;


  -- 6. Inventario sin movimiento (60 días sin ventas)
  SELECT
    COUNT(*),
    COALESCE(SUM(e.cantidad * p.precio_compra), 0)
  INTO v_sin_rotacion, v_sin_rotacion_capital
  FROM public.productos p
  JOIN public.existencias e
    ON e.producto_id = p.id
  WHERE p.activo = true
    AND e.cantidad > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.detalle_ventas d
      JOIN public.ventas v
        ON v.id = d.venta_id
      WHERE d.producto_id = p.id
        AND v.estado <> 'anulada'
        AND v.created_at >= now() - INTERVAL '60 days'
    );

  IF v_sin_rotacion > 0 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'inventario',
      'prioridad', 'media',
      'titulo', 'Inventario sin movimiento',
      'indicador', public.texto_cordobas(v_sin_rotacion_capital),
      'mensaje', v_sin_rotacion ||
        CASE WHEN v_sin_rotacion = 1 THEN ' producto no se vende' ELSE ' productos no se venden' END ||
        ' desde hace 60 días o más; tienen ' || public.texto_cordobas(v_sin_rotacion_capital) ||
        ' invertidos a precio de costo.',
      'recomendacion', 'Evaluar una oferta para sacarlos, cambiar su exhibición o dejar de reponerlos.'
    );
  END IF;


  -- 7. Faltantes de caja del mes
  SELECT
    COUNT(*),
    COALESCE(SUM(-a.diferencia), 0)
  INTO v_faltantes, v_faltantes_monto
  FROM public.arqueos_caja a
  WHERE a.diferencia < 0
    AND (a.created_at AT TIME ZONE 'America/Managua')::date >= v_inicio;

  IF v_faltantes > 0 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'caja',
      'prioridad', CASE WHEN v_faltantes_monto >= 1000 THEN 'critica' ELSE 'alta' END,
      'titulo', 'Faltantes en caja',
      'indicador', public.texto_cordobas(v_faltantes_monto),
      'mensaje', 'Este mes ' ||
        CASE WHEN v_faltantes = 1 THEN 'hubo 1 arqueo' ELSE 'hubo ' || v_faltantes || ' arqueos' END ||
        ' con faltante de efectivo, ' || public.texto_cordobas(v_faltantes_monto) || ' en total.',
      'recomendacion', 'Si se repite, revisar con Gerencia el control del efectivo en caja.'
    );
  END IF;


  -- 8. Devoluciones frente a ventas
  IF v_ventas > 0 THEN
    SELECT COALESCE(SUM(d.total), 0)
    INTO v_devoluciones
    FROM public.devoluciones_venta d
    WHERE d.estado = 'confirmada'
      AND (COALESCE(d.confirmada_at, d.created_at) AT TIME ZONE 'America/Managua')::date >= v_inicio;

    v_pct := round(v_devoluciones / v_ventas * 100, 1);

    IF v_pct >= 5 THEN
      v_alertas := v_alertas || jsonb_build_object(
        'tipo', 'ventas',
        'prioridad', 'media',
        'titulo', 'Devoluciones altas',
        'indicador', public.texto_cantidad(v_pct) || ' %',
        'mensaje', 'Las devoluciones confirmadas este mes suman ' || public.texto_cordobas(v_devoluciones) ||
          ', el ' || public.texto_cantidad(v_pct) || ' % de lo vendido.',
        'recomendacion', 'Revisar qué productos se devuelven y a qué proveedor se compraron.'
      );
    END IF;
  END IF;


  -- 9. Categoría que más vende
  IF v_neto_lineas > 0 THEN
    SELECT
      COALESCE(cat.nombre, 'Sin categoría'),
      SUM(d.subtotal)
    INTO v_categoria, v_categoria_monto
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    JOIN public.productos p
      ON p.id = d.producto_id
    LEFT JOIN public.categorias cat
      ON cat.id = p.categoria_id
    WHERE v.estado <> 'anulada'
      AND (v.created_at AT TIME ZONE 'America/Managua')::date >= v_inicio
    GROUP BY cat.nombre
    ORDER BY SUM(d.subtotal) DESC
    LIMIT 1;

    v_pct := round(v_categoria_monto / v_neto_lineas * 100, 1);

    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'ventas',
      'prioridad', 'baja',
      'titulo', 'Categoría que más vende',
      'indicador', public.texto_cantidad(v_pct) || ' %',
      'mensaje', v_categoria || ' concentra el ' || public.texto_cantidad(v_pct) ||
        ' % de lo vendido este mes (' || public.texto_cordobas(v_categoria_monto) || ').',
      'recomendacion', 'Mantener buen inventario y variedad en esa categoría.'
    );
  END IF;


  -- ----------------------------------------------------------
  -- ORDEN Y RESUMEN
  -- ----------------------------------------------------------
  SELECT COALESCE(
    jsonb_agg(
      x ORDER BY
        CASE x ->> 'prioridad'
          WHEN 'critica' THEN 1
          WHEN 'alta' THEN 2
          WHEN 'media' THEN 3
          ELSE 4
        END
    ),
    '[]'::jsonb
  )
  INTO v_alertas
  FROM jsonb_array_elements(v_alertas) x;

  RETURN jsonb_build_object(
    'generado_en', now(),
    'periodo', v_periodo,
    'resumen', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'criticas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'critica'),
        'altas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'alta'),
        'medias', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'media'),
        'bajas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'baja')
      )
      FROM jsonb_array_elements(v_alertas) x
    ),
    'alertas', v_alertas
  );
END;
$$;

ALTER FUNCTION public.alertas_recomendaciones_propietario() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.alertas_recomendaciones_propietario() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.alertas_recomendaciones_propietario() TO authenticated;

COMMIT;
