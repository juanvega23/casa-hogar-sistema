-- =========================================================
-- REPOSICIÓN SUGERIDA → COMPRA
--
-- Cierra el flujo: alerta de stock bajo → reposición sugerida
-- → compra. Devuelve los productos activos en o bajo su mínimo
-- con la cantidad a comprar, usando la misma regla que las
-- alertas del Propietario (alertas_recomendaciones_propietario):
--
--   objetivo  = stock_maximo, o si no hay máximo,
--               GREATEST(mínimo × 2, mínimo + ventas 30 días / 2)
--   sugerido  = objetivo − existencia − en camino   (≥ 0, entero)
--
-- "En camino" son las cantidades de compras registradas o
-- autorizadas que aún no se reciben, para no pedir dos veces.
-- El proveedor sugerido es el de menor último costo en
-- proveedor_productos.
--
-- Solo lectura. Roles: encargado_compras (arma la compra),
-- responsable_compras y almacen (consultan).
--
-- Afecta: función nueva reposicion_sugerida(). Tablas, políticas
-- y funciones existentes: sin cambios.
-- =========================================================

BEGIN;

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
    'almacen'
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

COMMIT;
