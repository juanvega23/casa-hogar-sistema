-- =========================================================
-- 022 · CAJA · ACCESO A DEVOLUCIONES DE VENTA CONFIRMADAS
--
-- Las funciones aplicar_devolucion_financiera() y
-- reembolsar_devolucion_venta() ya existían y permiten al
-- responsable de caja procesar el efecto financiero de una
-- devolución, pero la RLS de devoluciones_venta no le dejaba
-- consultarlas, por lo que no podía elegir cuál procesar.
--
-- Solo se agrega lectura; toda modificación sigue pasando por
-- las funciones transaccionales existentes.
-- =========================================================

BEGIN;

DROP POLICY IF EXISTS devoluciones_venta_select_caja
ON public.devoluciones_venta;

CREATE POLICY devoluciones_venta_select_caja
ON public.devoluciones_venta
FOR SELECT
TO authenticated
USING (
  public.current_role_code() = 'responsable_caja'
  AND estado = 'confirmada'
);

COMMIT;
