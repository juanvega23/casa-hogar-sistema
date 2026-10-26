-- =========================================================
-- 024 · IMÁGENES DE PRODUCTOS · COLUMNA Y CATÁLOGO PÚBLICO
--
-- Sistema interno → Producto → Editar → Subir imagen
--   → Supabase Storage (bucket 'productos', ver 025)
--   → productos.imagen_url
--   → catálogo público de la tienda
--
-- Los archivos NO se guardan en PostgreSQL; solo la URL.
--
-- El bucket y sus políticas están en la migración 025, separada
-- a propósito: si Storage no permite crear políticas por SQL en
-- este proyecto, la 025 puede fallar sin revertir esta columna,
-- de la que depende el módulo Productos.
-- =========================================================

BEGIN;


-- =========================================================
-- 1. COLUMNA
-- =========================================================

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS imagen_url text;


-- =========================================================
-- 2. CATÁLOGO PÚBLICO CON IMAGEN
-- Cambia el tipo de retorno: se elimina y se vuelve a crear.
-- =========================================================

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
  imagen_url text
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
    p.imagen_url
  FROM public.productos p
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  LEFT JOIN public.existencias e ON e.producto_id = p.id
  WHERE p.activo = true
  ORDER BY c.nombre NULLS LAST, p.nombre;
$$;

ALTER FUNCTION public.catalogo_publico() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.catalogo_publico() FROM PUBLIC;
GRANT ALL ON FUNCTION public.catalogo_publico() TO anon;
GRANT ALL ON FUNCTION public.catalogo_publico() TO authenticated;

COMMIT;
