-- ==========================================================
-- ESTADO DE LA ORDEN EN TIENDA (para el celular del cliente)
--
-- La tienda consulta cómo va el código para quitarlo sola cuando
-- ya se pagó. Solo lectura: no cambia tablas ni columnas y solo
-- devuelve el estado, sin datos del cliente ni de la venta.
--
--   abierta    el código sigue sirviendo
--   en_caja    el Vendedor registró la venta: falta pagar en Caja
--   pagada     Caja la cobró
--   credito    venta a crédito o con saldo
--   anulada    la venta se anuló
--   vencida    pasaron las 24 horas sin usarlo
--   no_existe  el código no corresponde a ninguna orden
-- ==========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.estado_orden_tienda(p_codigo text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  v_orden public.ordenes_tienda%ROWTYPE;
  v_venta text;
BEGIN
  SELECT * INTO v_orden FROM public.ordenes_tienda o WHERE o.codigo = v_codigo;

  IF NOT FOUND THEN
    RETURN 'no_existe';
  END IF;

  IF v_orden.estado <> 'facturada' THEN
    RETURN CASE WHEN v_orden.expira_at < now() THEN 'vencida' ELSE 'abierta' END;
  END IF;

  SELECT v.estado INTO v_venta FROM public.ventas v WHERE v.id = v_orden.venta_id;

  RETURN CASE v_venta
    WHEN 'pendiente_cobro' THEN 'en_caja'
    WHEN 'pagada' THEN 'pagada'
    WHEN 'completada' THEN 'pagada'
    WHEN 'con_saldo' THEN 'credito'
    WHEN 'anulada' THEN 'anulada'
    ELSE 'en_caja'
  END;
END;
$$;

ALTER FUNCTION public.estado_orden_tienda(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.estado_orden_tienda(text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.estado_orden_tienda(text) TO anon;
GRANT EXECUTE ON FUNCTION public.estado_orden_tienda(text) TO authenticated;

COMMIT;
