-- =========================================================
-- 025 · IMÁGENES DE PRODUCTOS · BUCKET Y POLÍTICAS DE STORAGE
--
-- Requiere la 024 (columna productos.imagen_url).
--
-- Solo el Encargado de Compras (que administra el catálogo)
-- puede subir, listar o eliminar imágenes. La tienda usa la
-- URL pública del bucket, que no necesita política SELECT.
--
-- Si este proyecto no permite crear políticas sobre
-- storage.objects desde SQL, crear el bucket y las tres
-- políticas desde el panel: Storage → Policies, con las mismas
-- condiciones. El resto del sistema sigue funcionando; solo la
-- subida de imágenes quedará deshabilitada hasta entonces.
-- =========================================================

BEGIN;


-- =========================================================
-- 1. BUCKET PÚBLICO
-- =========================================================

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'productos',
  'productos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- =========================================================
-- 2. POLÍTICAS DE STORAGE
-- =========================================================

-- Storage exige SELECT para poder eliminar archivos; por eso
-- se concede solo al encargado y no al público.
DROP POLICY IF EXISTS productos_imagenes_select_encargado_compras
ON storage.objects;

CREATE POLICY productos_imagenes_select_encargado_compras
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'productos'
  AND public.current_role_code() = 'encargado_compras'
);


DROP POLICY IF EXISTS productos_imagenes_insert_encargado_compras
ON storage.objects;

CREATE POLICY productos_imagenes_insert_encargado_compras
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'productos'
  AND public.current_role_code() = 'encargado_compras'
);


DROP POLICY IF EXISTS productos_imagenes_delete_encargado_compras
ON storage.objects;

CREATE POLICY productos_imagenes_delete_encargado_compras
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'productos'
  AND public.current_role_code() = 'encargado_compras'
);

COMMIT;
