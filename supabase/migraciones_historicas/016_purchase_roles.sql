-- =========================================================
-- 016_purchase_roles.sql
-- Nuevos roles para el Módulo Compras
-- =========================================================

INSERT INTO public.roles (codigo, nombre)
VALUES
  ('encargado_compras', 'Encargado de Compras'),
  ('responsable_compras', 'Responsable de Compras')
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre;