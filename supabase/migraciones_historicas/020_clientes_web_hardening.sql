-- =========================================================
-- 020 · CLIENTES WEB · MÍNIMO PRIVILEGIO
--
-- Antes: el cliente podía actualizar cualquier columna de su
-- fila (incluida 'activo' y 'correo'), por lo que un cliente
-- desactivado podía reactivarse desde la consola del navegador.
--
-- Ahora: solo puede editar nombre, teléfono y dirección, y
-- únicamente mientras su cuenta esté activa.
-- =========================================================

BEGIN;

REVOKE UPDATE ON TABLE public.clientes_web FROM authenticated;

GRANT UPDATE (nombre, telefono, direccion)
ON TABLE public.clientes_web
TO authenticated;


DROP POLICY IF EXISTS clientes_web_update_own
ON public.clientes_web;

CREATE POLICY clientes_web_update_own
ON public.clientes_web
FOR UPDATE
TO authenticated
USING (
  id = auth.uid()
  AND activo = true
)
WITH CHECK (
  id = auth.uid()
  AND activo = true
);

COMMIT;
