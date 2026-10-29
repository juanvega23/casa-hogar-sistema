-- =========================================================
-- ESTADO DE LA VENTA EN "MIS PEDIDOS"
--
-- Cuando el Vendedor convierte un pedido web en venta, el pedido
-- queda "convertido" y el cliente no sabía si ya estaba pagado.
-- mis_pedidos_web() ahora devuelve también el estado de esa venta
-- (pendiente_cobro, con_saldo, pagada, completada, anulada) para que
-- "Mi cuenta" muestre "Por pagar", "Completado" o "Anulado".
--
-- Afecta:
--   mis_pedidos_web()   (nueva columna venta_estado al final)
-- No cambia tablas ni políticas: el cliente sigue viendo solo sus
-- pedidos y solo el estado de la venta, no la venta completa.
-- =========================================================

BEGIN;

DROP FUNCTION IF EXISTS public.mis_pedidos_web();

CREATE OR REPLACE FUNCTION public.mis_pedidos_web()
RETURNS TABLE(
  id bigint,
  numero text,
  created_at timestamp with time zone,
  modalidad_entrega text,
  total numeric,
  estado text,
  direccion_entrega text,
  observaciones text,
  motivo_estado text,
  metodo_pago text,
  venta_estado text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.numero,
    p.created_at,
    p.modalidad_entrega,
    p.total,
    p.estado,
    p.direccion_entrega,
    p.observaciones,
    p.motivo_estado,
    p.metodo_pago,
    v.estado
  FROM public.pedidos_en_linea p
  LEFT JOIN public.ventas v
    ON v.id = p.venta_id
  WHERE p.cliente_web_id = auth.uid()
  ORDER BY p.created_at DESC;
END;
$$;

ALTER FUNCTION public.mis_pedidos_web() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mis_pedidos_web() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mis_pedidos_web() TO authenticated;

COMMIT;
