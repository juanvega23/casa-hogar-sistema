-- =============================================================
-- La tienda muestra la marca de cada producto.
--
-- catalogo_publico() devuelve además la marca. "Genérica" no se
-- expone: al cliente no le aporta, y el producto queda sin marca
-- visible. No cambia ninguna tabla ni otro dato del catálogo.
-- =============================================================

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
  descuento_hasta date,
  marca text
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
    END AS descuento_hasta,
    nullif(m.nombre, 'Genérica') AS marca
  FROM public.productos p
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  LEFT JOIN public.existencias e ON e.producto_id = p.id
  LEFT JOIN public.marcas m ON m.id = p.marca_id
  WHERE p.activo = true
  ORDER BY c.nombre NULLS LAST, p.nombre;
$$;

ALTER FUNCTION public.catalogo_publico() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.catalogo_publico() FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_publico() TO anon;
GRANT EXECUTE ON FUNCTION public.catalogo_publico() TO authenticated;
