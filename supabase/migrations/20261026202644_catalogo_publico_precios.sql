-- =========================================================
-- CATÁLOGO PÚBLICO · PRECIO REGULAR, DESCUENTO Y UNIDAD
--
-- La tienda rediseñada muestra el precio anterior tachado, la
-- etiqueta de descuento, la unidad de venta y un aviso de
-- "últimas unidades".
--
-- No se publica la existencia exacta: solo si hay pocas
-- unidades (existencia en o por debajo del mínimo), para no
-- exponer el inventario de bodega a cualquier visitante.
--
-- Las columnas nuevas se agregan al final; el frontend actual
-- sigue funcionando porque lee las columnas por nombre.
-- =========================================================

BEGIN;

DROP FUNCTION IF EXISTS public.catalogo_publico();

CREATE FUNCTION public.catalogo_publico()
RETURNS TABLE (
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
  pocas_unidades boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
      (1 - coalesce(p.descuento_porcentaje, 0) / 100),
      2
    ) AS precio,
    coalesce(e.cantidad, 0) > 0 AS disponible,
    p.imagen_url,
    p.precio_venta AS precio_regular,
    coalesce(p.descuento_porcentaje, 0) AS descuento_porcentaje,
    p.unidad_medida,
    coalesce(e.cantidad, 0) > 0
      AND coalesce(e.cantidad, 0) <= p.stock_minimo AS pocas_unidades
  FROM public.productos p
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  LEFT JOIN public.existencias e ON e.producto_id = p.id
  WHERE p.activo = true
  ORDER BY c.nombre NULLS LAST, p.nombre;
$$;

ALTER FUNCTION public.catalogo_publico() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.catalogo_publico() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalogo_publico() TO anon;
GRANT EXECUTE ON FUNCTION public.catalogo_publico() TO authenticated;

COMMIT;
